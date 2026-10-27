import { Injectable } from '@nestjs/common';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { NotFound } from '../common/app-exception.js';
import { subscriptionAccess } from '../common/subscription-policy.js';

/**
 * Platform administration (spec §23): tenant listing, subscription overview,
 * usage metering, suspension. Superadmins cannot read tenant business
 * records (prescriptions, invoices) through these endpoints — minimum
 * necessary access.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listTenants(
    request: AuthenticatedRequest,
    params: { page: number; pageSize: number; search?: string; status?: PrismaNamespace.EnumSubscriptionStatusFilter['equals']; planKey?: string; suspended?: boolean },
  ) {
    const where: PrismaNamespace.OrganizationWhereInput = {};
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { slug: { contains: params.search, mode: 'insensitive' } },
        { gstin: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.status || params.planKey) {
      where.subscription = { ...(params.status ? { status: params.status } : {}), ...(params.planKey ? { plan: { key: params.planKey } } : {}) };
    }
    if (params.suspended !== undefined) {
      const suspendedIds = (
        await this.prisma.organizationSettings.findMany({ where: { settings: { path: ['suspended'], equals: true } }, select: { organizationId: true } })
      ).map((s) => s.organizationId);
      where.id = params.suspended ? { in: suspendedIds } : { notIn: suspendedIds };
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        include: {
          subscription: { include: { plan: { select: { key: true, name: true } } } },
          settings: { select: { settings: true } },
          _count: { select: { memberships: true, branches: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    const invoiceCounts = await this.prisma.salesInvoice.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: items.map((o) => o.id) } },
      _count: true,
    });
    const invoicesOf = new Map(invoiceCounts.map((c) => [c.organizationId, c._count]));
    return {
      items: items.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        createdAt: o.createdAt,
        setupCompletedAt: o.setupCompletedAt,
        memberships: o._count.memberships,
        branches: o._count.branches,
        invoices: invoicesOf.get(o.id) ?? 0,
        suspended: (o.settings?.settings as Record<string, unknown> | null)?.suspended === true,
        subscription: o.subscription
          ? {
              status: o.subscription.status,
              planKey: o.subscription.plan.key,
              plan: o.subscription.plan.name,
              currentPeriodEnd: o.subscription.currentPeriodEnd,
              ...subscriptionAccess(o.subscription),
            }
          : null,
      })),
      pageInfo: {
        page: params.page,
        pageSize: params.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
        hasNextPage: params.page * params.pageSize < total,
        hasPreviousPage: params.page > 1,
      },
    };
  }

  async setTenantStatus(request: AuthenticatedRequest, organizationId: string, suspended: boolean) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw NotFound('Organization not found');
    // Suspension revokes all tenant sessions (access revocation, spec §28).
    if (suspended) {
      const memberships = await this.prisma.organizationMembership.findMany({
        where: { organizationId },
        select: { userId: true },
      });
      for (const m of memberships) {
        await this.prisma.session.updateMany({
          where: { userId: m.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    }
    const existing = await this.prisma.organizationSettings.findUnique({ where: { organizationId } });
    const merged = { ...((existing?.settings as Record<string, unknown> | null) ?? {}), suspended };
    await this.prisma.organizationSettings.upsert({
      where: { organizationId },
      create: { organizationId, settings: merged },
      update: { settings: merged },
    });
    await this.audit.record({
      event: 'SETTINGS_UPDATED',
      organizationId,
      actorUserId: request.principal.userId,
      entityType: 'Platform',
      entityId: organizationId,
      details: { event: suspended ? 'TENANT_SUSPENDED' : 'TENANT_REACTIVATED', by: request.principal.email },
    });
    return { organizationId, suspended };
  }

  async tenantUsage(request: AuthenticatedRequest, organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!org) throw NotFound('Organization not found');
    const usage = await this.prisma.usageRecord.findMany({
      where: { organizationId },
      orderBy: { periodStart: 'desc' },
      take: 12,
    });
    const storage = await this.prisma.auditLog.count({ where: { organizationId } });
    return {
      organization: { id: org.id, name: org.name },
      plan: org.subscription?.plan.name ?? null,
      subscriptionStatus: org.subscription?.status ?? null,
      usage: usage.map((u) => ({ metric: u.metric, periodStart: u.periodStart, value: u.value })),
      auditEvents: storage,
    };
  }

  async updatePlanLimits(request: AuthenticatedRequest, planKey: string, limits: Record<string, unknown>) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { key: planKey } });
    if (!plan) throw NotFound('Plan not found');
    await this.audit.record({
      event: 'SETTINGS_UPDATED',
      actorUserId: request.principal.userId,
      entityType: 'SubscriptionPlan',
      entityId: plan.id,
      details: { event: 'PLAN_LIMITS_UPDATED', planKey },
    });
    return this.prisma.subscriptionPlan.update({ where: { key: planKey }, data: { limits: limits as PrismaNamespace.InputJsonValue } });
  }

  async overview() {
    const monthStart = new Date(`${new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7)}-01T00:00:00+05:30`);
    const [tenants, newThisMonth, users, invoicesThisMonth, byStatus, byPlan, suspendedRows] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.user.count(),
      this.prisma.salesInvoice.count({ where: { invoiceDate: { gte: monthStart } } }),
      this.prisma.subscription.groupBy({ by: ['status'], _count: true }),
      this.prisma.subscription.groupBy({ by: ['planId'], _count: true }),
      this.prisma.organizationSettings.findMany({ select: { settings: true } }),
    ]);
    const plans = await this.prisma.subscriptionPlan.findMany({ select: { id: true, key: true, name: true } });
    return {
      tenants,
      newThisMonth,
      users,
      invoicesThisMonth,
      suspended: suspendedRows.filter((r) => (r.settings as Record<string, unknown> | null)?.suspended === true).length,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byPlan: byPlan.map((p) => ({ plan: plans.find((x) => x.id === p.planId)?.name ?? p.planId, count: p._count })),
    };
  }

  listPlans() {
    return this.prisma.subscriptionPlan.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** Assigns a plan and billing period (manual billing — no payment gateway is connected). */
  async assignSubscription(
    request: AuthenticatedRequest,
    organizationId: string,
    data: { planKey: string; status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'GRACE' | 'CANCELLED' | 'EXPIRED'; periodDays: number; notes?: string | null },
  ) {
    const [org, plan, current] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.subscriptionPlan.findUnique({ where: { key: data.planKey } }),
      this.prisma.subscription.findUnique({ where: { organizationId } }),
    ]);
    if (!org) throw NotFound('Organization not found');
    if (!plan) throw NotFound('Plan not found');
    const now = new Date();
    const periodEnd = new Date(now.getTime() + data.periodDays * 86_400_000);
    const fields = {
      planId: plan.id,
      status: data.status,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      trialEndsAt: data.status === 'TRIALING' ? periodEnd : null,
      graceEndsAt: null,
      cancelledAt: data.status === 'CANCELLED' ? now : null,
    };
    const subscription = await this.prisma.$transaction(async (tx) => {
      const sub = current
        ? await tx.subscription.update({ where: { organizationId }, data: fields })
        : await tx.subscription.create({ data: { organizationId, ...fields } });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          eventType: current && current.planId !== plan.id ? 'PLAN_CHANGED' : 'PERIOD_UPDATED',
          fromPlanId: current?.planId ?? null,
          toPlanId: plan.id,
          actorUserId: request.principal.userId,
          notes: data.notes ?? null,
        },
      });
      return sub;
    });
    await this.audit.record({
      event: 'SETTINGS_UPDATED',
      organizationId,
      actorUserId: request.principal.userId,
      entityType: 'Subscription',
      entityId: subscription.id,
      details: { event: 'SUBSCRIPTION_ASSIGNED', planKey: plan.key, status: data.status, periodDays: data.periodDays, by: request.principal.email },
    });
    return { organizationId, planKey: plan.key, status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd };
  }
}
