import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SYSTEM_ROLE_PERMISSIONS, TENANT_PERMISSIONS } from '../rbac/permission-catalog.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { GSTIN_REQUIRED_FOR, gstinIssues, type FieldIssue } from '@medicore/validation';
import { Conflict, Forbidden, NotFound, ValidationFailed } from '../common/app-exception.js';
import { AuthService } from '../auth/auth.service.js';
import { limitOf, subscriptionAccess } from '../common/subscription-policy.js';

export interface PaginationParams {
  page: number;
  pageSize: number;
}

/**
 * Organization administration: profile, settings, branches, warehouses,
 * members, roles, onboarding checklist. Every method is tenant-scoped via
 * TenantContextGuard-established context (spec §5).
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
  ) {}

  async getOrganization(request: TenantRequest) {
    const org = await this.prisma.organization.findUnique({
      where: { id: request.tenantContext.organizationId },
      include: {
        branches: { where: { isActive: true }, orderBy: { createdAt: 'asc' } },
        settings: true,
        subscription: { include: { plan: true } },
      },
    });
    if (!org) throw NotFound('Organization not found');
    const { settings, subscription, ...rest } = org;
    return {
      ...rest,
      settings: settings?.settings ?? {},
      subscription: subscription
        ? {
            status: subscription.status,
            planKey: subscription.plan.key,
            planName: subscription.plan.name,
            currentPeriodEnd: subscription.currentPeriodEnd,
            trialEndsAt: subscription.trialEndsAt,
          }
        : null,
    };
  }

  /** Subscription, entitlements and metered usage against plan limits. */
  async getSubscription(request: TenantRequest) {
    const orgId = request.tenantContext.organizationId;
    const monthStart = new Date(`${new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7)}-01T00:00:00+05:30`);
    const [subscription, settings, branches, users, warehouses, invoices, plans] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { organizationId: orgId }, include: { plan: true } }),
      this.prisma.organizationSettings.findUnique({ where: { organizationId: orgId }, select: { settings: true } }),
      this.prisma.branch.count({ where: { organizationId: orgId, isActive: true } }),
      this.prisma.organizationMembership.count({ where: { organizationId: orgId, status: { not: 'SUSPENDED' } } }),
      this.prisma.warehouse.count({ where: { organizationId: orgId } }),
      this.prisma.salesInvoice.count({ where: { organizationId: orgId, invoiceDate: { gte: monthStart } } }),
      this.prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const limits = (subscription?.plan.limits ?? {}) as Record<string, unknown>;
    const meter = (used: number, key: string) => ({ used, limit: limitOf(limits, key) });
    const access = subscription ? subscriptionAccess(subscription) : null;
    return {
      suspended: (settings?.settings as Record<string, unknown> | null)?.suspended === true,
      subscription: subscription
        ? {
            status: subscription.status,
            planKey: subscription.plan.key,
            planName: subscription.plan.name,
            planDescription: subscription.plan.description,
            trialEndsAt: subscription.trialEndsAt,
            currentPeriodEnd: subscription.currentPeriodEnd,
            endsAt: access!.endsAt,
            daysLeft: access!.daysLeft,
            lapsed: access!.lapsed,
            modules: Array.isArray(limits.modules) ? limits.modules : [],
          }
        : null,
      usage: {
        branches: meter(branches, 'maxBranches'),
        users: meter(users, 'maxUsers'),
        warehouses: meter(warehouses, 'maxWarehouses'),
        invoicesThisMonth: meter(invoices, 'monthlyInvoiceLimit'),
      },
      plans: plans.map((p) => ({ key: p.key, name: p.name, description: p.description, limits: p.limits })),
    };
  }

  /** Plan changes and renewals recorded against this organization's subscription. */
  async subscriptionEvents(request: TenantRequest) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId: request.tenantContext.organizationId },
      select: { id: true },
    });
    if (!subscription) return [];
    const [events, plans] = await Promise.all([
      this.prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.subscriptionPlan.findMany({ select: { id: true, key: true, name: true } }),
    ]);
    const planOf = new Map(plans.map((p) => [p.id, p]));
    return events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      fromPlan: e.fromPlanId ? (planOf.get(e.fromPlanId)?.name ?? null) : null,
      toPlan: e.toPlanId ? (planOf.get(e.toPlanId)?.name ?? null) : null,
      notes: e.notes,
      createdAt: e.createdAt,
    }));
  }

  async updateOrganization(
    request: TenantRequest,
    data: Partial<{
      name: string;
      legalEntityName: string | null;
      gstRegistrationStatus: string;
      gstin: string | null;
      pan: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      stateCode: string | null;
      pinCode: string | null;
      contactPhone: string | null;
      contactEmail: string | null;
      financialYearStartMonth: number;
    }>,
  ) {
    const orgId = request.tenantContext.organizationId;
    const existing = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const pick = <K extends 'gstin' | 'pan' | 'stateCode'>(key: K) => (key in data ? data[key] : existing[key]);
    const issues: FieldIssue[] = gstinIssues({ gstin: pick('gstin'), pan: pick('pan'), stateCode: pick('stateCode') });
    if ('gstRegistrationStatus' in data || 'gstin' in data) {
      const status = data.gstRegistrationStatus ?? existing.gstRegistrationStatus;
      if ((GSTIN_REQUIRED_FOR as readonly string[]).includes(status) && !pick('gstin')) {
        issues.push({ field: 'gstin', message: 'GSTIN is required for regular and composition taxpayers' });
      }
    }
    if (issues.length > 0) throw ValidationFailed(issues);
    const updated = await this.prisma.organization.update({ where: { id: orgId }, data });
    await this.audit.record({
      event: 'ORGANIZATION_UPDATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      actorEmail: request.principal.email,
      entityType: 'Organization',
      entityId: orgId,
      details: { fields: Object.keys(data) },
    });
    return updated;
  }

  async updateSettings(request: TenantRequest, patch: Record<string, unknown>) {
    const orgId = request.tenantContext.organizationId;
    const existing = await this.prisma.organizationSettings.findUnique({ where: { organizationId: orgId } });
    const current = (existing?.settings as Record<string, unknown> | null) ?? {};
    const { suspended: _ignored, ...tenantPatch } = patch;
    // `suspended` is platform-controlled and can never be set by the tenant.
    const settings = { ...current, ...tenantPatch, suspended: current.suspended === true } as Prisma.InputJsonValue;
    await this.prisma.organizationSettings.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, settings },
      update: { settings },
    });
    await this.audit.record({
      event: 'SETTINGS_UPDATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      actorEmail: request.principal.email,
      entityType: 'OrganizationSettings',
      entityId: orgId,
    });
    return settings;
  }

  /** Setup completeness checklist (spec §6). Posting is gated until complete. */
  async getSetupChecklist(request: TenantRequest) {
    const orgId = request.tenantContext.organizationId;
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: { branches: true, settings: true, subscription: true },
    });
    if (!org) throw NotFound('Organization not found');

    const steps = [
      {
        key: 'business_profile',
        label: 'Business profile',
        complete: Boolean(org.addressLine1 && org.city && org.stateCode),
      },
      {
        key: 'gst',
        label: 'GST registration',
        complete: !(GSTIN_REQUIRED_FOR as readonly string[]).includes(org.gstRegistrationStatus) || Boolean(org.gstin),
      },
      { key: 'branch', label: 'At least one branch', complete: org.branches.length > 0 },
      {
        key: 'warehouse',
        label: 'At least one warehouse',
        complete: (await this.prisma.warehouse.count({ where: { organizationId: orgId } })) > 0,
      },
      {
        key: 'users',
        label: 'Users configured',
        complete:
          (await this.prisma.organizationMembership.count({ where: { organizationId: orgId, status: 'ACTIVE' } })) > 0,
      },
      {
        key: 'tax_rates',
        label: 'GST tax rates configured',
        // Recommended: sales for an HSN without an effective rate are rejected at posting time.
        required: false,
        complete: (await this.prisma.taxRateVersion.count({ where: { organizationId: orgId, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] } })) > 0,
      },
    ];
    return {
      steps,
      allComplete: steps.every((s) => s.complete || ('required' in s && s.required === false)),
      setupCompletedAt: org.setupCompletedAt,
    };
  }

  async completeSetup(request: TenantRequest) {
    const orgId = request.tenantContext.organizationId;
    const checklist = await this.getSetupChecklist(request);
    if (!checklist.allComplete) {
      throw Conflict('STATE_TRANSITION_INVALID', 'Complete all setup steps before finishing onboarding');
    }
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { setupCompletedAt: new Date() },
    });
    await this.audit.record({
      event: 'SETTINGS_UPDATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'OrganizationSetup',
      entityId: orgId,
      details: { completed: true },
    });
    return { setupCompleted: true };
  }

  // ── Branches & warehouses ──────────────────────────────────────────────────

  async listBranches(request: TenantRequest) {
    return this.prisma.branch.findMany({
      where: { organizationId: request.tenantContext.organizationId },
      include: {
        warehouses: true,
        billingCounters: { orderBy: { createdAt: 'asc' } },
        _count: { select: { assignments: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** A branch GSTIN must belong to the branch's state; an org GSTIN with the same PAN is expected. */
  private async assertBranchGstin(orgId: string, gstin: string | null | undefined, stateCode: string | null | undefined) {
    if (!gstin) return;
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { pan: true } });
    const issues = gstinIssues({ gstin, stateCode, pan: org.pan });
    if (issues.length > 0) throw ValidationFailed(issues);
  }

  private async assertUniqueBranchCode(orgId: string, code: string | null | undefined, exceptId?: string) {
    if (!code) return;
    const clash = await this.prisma.branch.findFirst({ where: { organizationId: orgId, code: { equals: code, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined } });
    if (clash) throw Conflict('DUPLICATE_ENTITY', `Branch code "${code}" is already used by ${clash.name}`);
  }

  async createBranch(
    request: TenantRequest,
    data: {
      name: string;
      code?: string | null;
      addressLine1?: string | null;
      city?: string | null;
      stateCode?: string | null;
      pinCode?: string | null;
      phone?: string | null;
      gstin?: string | null;
      isBillingEnabled?: boolean;
    },
  ) {
    const orgId = request.tenantContext.organizationId;
    await this.assertWithinPlanLimit(orgId, 'maxBranches', async () =>
      this.prisma.branch.count({ where: { organizationId: orgId } }),
      'Branch limit for your plan has been reached',
    );
    await this.assertUniqueBranchCode(orgId, data.code);
    await this.assertBranchGstin(orgId, data.gstin, data.stateCode);

    const branch = await this.prisma.branch.create({
      data: {
        organizationId: orgId,
        name: data.name,
        code: data.code ?? null,
        addressLine1: data.addressLine1 ?? null,
        city: data.city ?? null,
        stateCode: data.stateCode ?? null,
        pinCode: data.pinCode ?? null,
        phone: data.phone ?? null,
        gstin: data.gstin ?? null,
        isBillingEnabled: data.isBillingEnabled ?? true,
      },
    });
    await this.audit.record({
      event: 'BRANCH_CREATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Branch',
      entityId: branch.id,
      details: { name: branch.name },
    });
    return branch;
  }

  async updateBranch(
    request: TenantRequest,
    branchId: string,
    data: Partial<{
      name: string;
      code: string | null;
      addressLine1: string | null;
      city: string | null;
      stateCode: string | null;
      pinCode: string | null;
      phone: string | null;
      gstin: string | null;
      isBillingEnabled: boolean;
      isActive: boolean;
      isDefault: true;
    }>,
  ) {
    const orgId = request.tenantContext.organizationId;
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId: orgId } });
    if (!branch) throw NotFound('Branch not found');
    if ('code' in data) await this.assertUniqueBranchCode(orgId, data.code, branchId);
    if ('gstin' in data || 'stateCode' in data) {
      await this.assertBranchGstin(orgId, 'gstin' in data ? data.gstin : branch.gstin, 'stateCode' in data ? data.stateCode : branch.stateCode);
    }
    if (data.isActive === false) {
      if (branch.isDefault) throw Conflict('STATE_TRANSITION_INVALID', 'Make another branch the default before deactivating this one');
      const active = await this.prisma.branch.count({ where: { organizationId: orgId, isActive: true } });
      if (active <= 1) throw Conflict('STATE_TRANSITION_INVALID', 'At least one branch must stay active');
    }
    if (data.isDefault && !(data.isActive ?? branch.isActive)) {
      throw Conflict('STATE_TRANSITION_INVALID', 'An inactive branch cannot be the default');
    }
    const changed = (Object.keys(data) as Array<keyof typeof data>).filter((k) => data[k] !== undefined && data[k] !== branch[k]);
    if (changed.length === 0) return branch;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (data.isDefault) await tx.branch.updateMany({ where: { organizationId: orgId, isDefault: true, NOT: { id: branchId } }, data: { isDefault: false } });
      return tx.branch.update({ where: { id: branchId }, data });
    });
    await this.audit.record({
      event: 'BRANCH_UPDATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Branch',
      entityId: branchId,
      details: { fields: changed },
    });
    return updated;
  }

  async createCounter(request: TenantRequest, branchId: string, name: string) {
    await this.assertBranch(request, branchId);
    const clash = await this.prisma.billingCounter.findFirst({ where: { branchId, name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw Conflict('DUPLICATE_ENTITY', `This branch already has a counter called "${clash.name}"`);
    const counter = await this.prisma.billingCounter.create({ data: { branchId, name } });
    await this.audit.record({
      event: 'BRANCH_UPDATED',
      organizationId: request.tenantContext.organizationId,
      actorUserId: request.principal.userId,
      entityType: 'BillingCounter',
      entityId: counter.id,
      details: { action: 'COUNTER_CREATED', branchId, name },
    });
    return counter;
  }

  async updateCounter(request: TenantRequest, counterId: string, data: { name?: string; isActive?: boolean }) {
    const counter = await this.prisma.billingCounter.findFirst({
      where: { id: counterId, branch: { organizationId: request.tenantContext.organizationId } },
    });
    if (!counter) throw NotFound('Billing counter not found');
    if (data.name && data.name.toLowerCase() !== counter.name.toLowerCase()) {
      const clash = await this.prisma.billingCounter.findFirst({ where: { branchId: counter.branchId, name: { equals: data.name, mode: 'insensitive' } } });
      if (clash) throw Conflict('DUPLICATE_ENTITY', `This branch already has a counter called "${clash.name}"`);
    }
    const updated = await this.prisma.billingCounter.update({ where: { id: counterId }, data });
    await this.audit.record({
      event: 'BRANCH_UPDATED',
      organizationId: request.tenantContext.organizationId,
      actorUserId: request.principal.userId,
      entityType: 'BillingCounter',
      entityId: counterId,
      details: { action: 'COUNTER_UPDATED', ...data },
    });
    return updated;
  }

  async createWarehouse(
    request: TenantRequest,
    branchId: string,
    data: { name: string; code?: string | null; isDefault?: boolean },
  ) {
    await this.assertBranch(request, branchId);
    const orgId = request.tenantContext.organizationId;
    await this.assertWithinPlanLimit(orgId, 'maxWarehouses', async () => this.prisma.warehouse.count({ where: { organizationId: orgId } }), 'Warehouse limit for your plan has been reached');
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.warehouse.updateMany({ where: { organizationId: orgId, branchId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.warehouse.create({
        data: {
          organizationId: orgId,
          branchId,
          name: data.name,
          code: data.code || null,
          isDefault: data.isDefault ?? false,
        },
      });
    });
  }

  /** Verifies the tenant context covers this branch; throws otherwise. */
  async assertBranch(request: TenantRequest, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId: request.tenantContext.organizationId },
    });
    if (!branch) throw NotFound('Branch not found');
  }

  /** Plan limit enforcement (spec §5): compares a current count to a plan limit. */
  private async assertWithinPlanLimit(
    organizationId: string,
    limitKey: string,
    currentCount: () => Promise<number>,
    message: string,
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
    if (!subscription) return; // Organizations without a subscription row (platform-internal) bypass limits.
    const limits = subscription.plan.limits as Record<string, unknown>;
    const limit = limits[limitKey];
    if (typeof limit === 'number' && limit >= 0 && (await currentCount()) >= limit) {
      throw Conflict('PLAN_LIMIT_REACHED', message);
    }
  }

  // ── Members & roles ────────────────────────────────────────────────────────

  async listMembers(
    request: TenantRequest,
    params: PaginationParams & { search?: string; status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED'; roleId?: string; branchId?: string },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.OrganizationMembershipWhereInput = { organizationId: orgId };
    if (params.status) where.status = params.status;
    if (params.roleId) where.roleId = params.roleId;
    if (params.branchId) where.branchAssignments = { some: { branchId: params.branchId } };
    if (params.search) {
      where.user = {
        OR: [
          { fullName: { contains: params.search, mode: 'insensitive' } },
          { email: { contains: params.search, mode: 'insensitive' } },
        ],
      };
    }
    const [total, byStatus, items] = await this.prisma.$transaction([
      this.prisma.organizationMembership.count({ where }),
      this.prisma.organizationMembership.groupBy({ by: ['status'], where: { organizationId: orgId }, _count: { _all: true }, orderBy: { status: 'asc' } }),
      this.prisma.organizationMembership.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, fullName: true, status: true, lastLoginAt: true } },
          role: { select: { id: true, name: true, key: true } },
          branchAssignments: { include: { branch: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    const counts = { ACTIVE: 0, INVITED: 0, SUSPENDED: 0 } as Record<string, number>;
    for (const row of byStatus) counts[row.status] = (row._count as { _all: number })._all;
    return { total, counts, items };
  }

  private async findMembership(request: TenantRequest, membershipId: string) {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId: request.tenantContext.organizationId },
      include: { user: { select: { email: true, fullName: true } } },
    });
    if (!membership) throw NotFound('Membership not found');
    return membership;
  }

  /** Replaces the branches a member may work in; owners always see every branch. */
  async setMemberBranches(request: TenantRequest, membershipId: string, branchIds: string[]) {
    const orgId = request.tenantContext.organizationId;
    const membership = await this.findMembership(request, membershipId);
    const unique = [...new Set(branchIds)];
    const found = await this.prisma.branch.count({ where: { organizationId: orgId, id: { in: unique } } });
    if (found !== unique.length) throw NotFound('One or more branches were not found');
    await this.prisma.$transaction([
      this.prisma.userBranchAssignment.deleteMany({ where: { membershipId, branchId: { notIn: unique } } }),
      ...unique.map((branchId) =>
        this.prisma.userBranchAssignment.upsert({
          where: { membershipId_branchId: { membershipId, branchId } },
          create: { membershipId, branchId },
          update: {},
        }),
      ),
    ]);
    await this.audit.record({
      event: 'PERMISSIONS_UPDATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'OrganizationMembership',
      entityId: membershipId,
      details: { branchIds: unique, member: membership.user.email },
    });
    return this.prisma.organizationMembership.findUnique({
      where: { id: membershipId },
      include: { branchAssignments: { include: { branch: { select: { id: true, name: true } } } } },
    });
  }

  async resendInvite(request: TenantRequest, membershipId: string) {
    const membership = await this.findMembership(request, membershipId);
    if (membership.status !== 'INVITED') throw Conflict('STATE_TRANSITION_INVALID', 'Only pending invitations can be resent');
    return this.authService.reissueInvitation({
      organizationId: request.tenantContext.organizationId,
      membershipId,
      userId: membership.userId,
      email: membership.user.email,
      actorUserId: request.principal.userId,
      actorEmail: request.principal.email,
    });
  }

  /** Cancels a pending invitation: tokens are burnt and the membership removed. */
  async revokeInvite(request: TenantRequest, membershipId: string): Promise<void> {
    const orgId = request.tenantContext.organizationId;
    const membership = await this.findMembership(request, membershipId);
    if (membership.status !== 'INVITED') throw Conflict('STATE_TRANSITION_INVALID', 'Only pending invitations can be revoked — suspend active members instead');
    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({ where: { membershipId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.userBranchAssignment.deleteMany({ where: { membershipId } }),
      this.prisma.organizationMembership.delete({ where: { id: membershipId } }),
    ]);
    await this.audit.record({
      event: 'USER_SUSPENDED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      actorEmail: request.principal.email,
      entityType: 'OrganizationMembership',
      entityId: membershipId,
      details: { action: 'INVITATION_REVOKED', invitedEmail: membership.user.email },
    });
  }

  async listRoles(request: TenantRequest) {
    return this.prisma.role.findMany({
      where: { organizationId: request.tenantContext.organizationId },
      include: { permissions: { include: { permission: true } }, _count: { select: { memberships: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  async createRole(request: TenantRequest, data: { name: string; description?: string | null; permissionKeys: string[] }) {
    const orgId = request.tenantContext.organizationId;
    this.validatePermissionKeys(data.permissionKeys);
    const clash = await this.prisma.role.findFirst({ where: { organizationId: orgId, name: { equals: data.name, mode: 'insensitive' } } });
    if (clash) throw Conflict('DUPLICATE_ENTITY', `A role called "${clash.name}" already exists`);

    const role = await this.prisma.role.create({
      data: {
        organizationId: orgId,
        name: data.name,
        description: data.description ?? null,
        isSystem: false,
        permissions: {
          create: data.permissionKeys.map((key) => ({ permission: { connect: { key } } })),
        },
      },
      include: { permissions: { include: { permission: true } } },
    });
    await this.audit.record({
      event: 'ROLE_CREATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Role',
      entityId: role.id,
      details: { name: role.name, permissions: data.permissionKeys },
    });
    return role;
  }

  async updateRolePermissions(request: TenantRequest, roleId: string, permissionKeys: string[]) {
    const orgId = request.tenantContext.organizationId;
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId: orgId } });
    if (!role) throw NotFound('Role not found');
    if (role.isSystem) throw Forbidden('System roles cannot be modified');
    this.validatePermissionKeys(permissionKeys);

    await this.prisma.$transaction(async (tx) => {
      const permissionRows = await tx.permission.findMany({
        where: { key: { in: permissionKeys } },
        select: { id: true },
      });
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: permissionRows.map((p) => ({ roleId, permissionId: p.id })),
      });
    });

    await this.audit.record({
      event: 'PERMISSIONS_UPDATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Role',
      entityId: roleId,
      details: { permissions: permissionKeys },
    });
    return this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async deleteRole(request: TenantRequest, roleId: string): Promise<void> {
    const orgId = request.tenantContext.organizationId;
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId: orgId } });
    if (!role) throw NotFound('Role not found');
    if (role.isSystem) throw Forbidden('System roles cannot be deleted');
    const inUse = await this.prisma.organizationMembership.count({ where: { roleId } });
    if (inUse > 0) throw Conflict('STATE_TRANSITION_INVALID', 'Role is assigned to one or more members');
    await this.prisma.role.delete({ where: { id: roleId } });
    await this.audit.record({
      event: 'ROLE_DELETED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Role',
      entityId: roleId,
      details: { name: role.name },
    });
  }

  private validatePermissionKeys(keys: string[]): void {
    const validKeys = new Set(TENANT_PERMISSIONS.map((p) => p.key));
    const invalid = keys.filter((k) => !validKeys.has(k));
    if (invalid.length > 0) throw Forbidden(`Unknown permissions: ${invalid.join(', ')}`);
  }

  async setMemberRole(request: TenantRequest, membershipId: string, roleId: string | null) {
    const orgId = request.tenantContext.organizationId;
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId: orgId },
    });
    if (!membership) throw NotFound('Membership not found');
    if (roleId !== null) {
      const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId: orgId } });
      if (!role) throw NotFound('Role not found');
    }
    const updated = await this.prisma.organizationMembership.update({
      where: { id: membershipId },
      data: { roleId },
    });
    await this.audit.record({
      event: 'PERMISSIONS_UPDATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'OrganizationMembership',
      entityId: membershipId,
      details: { roleId },
    });
    return updated;
  }

  async setMemberStatus(request: TenantRequest, membershipId: string, status: 'ACTIVE' | 'SUSPENDED') {
    const orgId = request.tenantContext.organizationId;
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId: orgId },
    });
    if (!membership) throw NotFound('Membership not found');
    if (membership.isOwner) throw Forbidden('The organization owner cannot be suspended');

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.organizationMembership.update({
        where: { id: membershipId },
        data: { status },
      });
      if (status === 'SUSPENDED') {
        await tx.session.updateMany({
          where: { userId: membership.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return row;
    });

    await this.audit.record({
      event: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'OrganizationMembership',
      entityId: membershipId,
    });
    return updated;
  }

  async inviteMember(
    request: TenantRequest,
    data: { email: string; fullName: string; roleId: string | null; branchIds: string[] },
  ) {
    const orgId = request.tenantContext.organizationId;
    await this.assertWithinPlanLimit(
      orgId,
      'maxUsers',
      async () => this.prisma.organizationMembership.count({ where: { organizationId: orgId } }),
      'User limit for your plan has been reached',
    );
    if (data.roleId !== null) {
      const role = await this.prisma.role.findFirst({ where: { id: data.roleId, organizationId: orgId } });
      if (!role) throw NotFound('Role not found');
    }
    for (const branchId of data.branchIds) {
      await this.assertBranch(request, branchId);
    }
    return this.authService.inviteMember({
      organizationId: orgId,
      actorUserId: request.principal.userId,
      actorEmail: request.principal.email,
      email: data.email,
      fullName: data.fullName,
      roleId: data.roleId,
      branchIds: data.branchIds,
    });
  }

  /** Permission catalog for role editing UI. */
  listPermissionCatalog() {
    return TENANT_PERMISSIONS;
  }

  /** System role template permission sets shown when creating custom roles. */
  systemRoleTemplates() {
    return Object.entries(SYSTEM_ROLE_PERMISSIONS)
      .filter(([, permissions]) => permissions.length > 0)
      .map(([key, permissions]) => ({ key, permissions }));
  }
}
