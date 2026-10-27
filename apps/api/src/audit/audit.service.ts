import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditEvent } from '@medicore/shared-types';
import { PrismaService } from '../prisma/prisma.module.js';
import { dateRangeFilter } from '../common/query.js';

export interface AuditFilters {
  event?: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface AuditEntry {
  event: AuditEvent;
  organizationId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  entityType?: string;
  entityId?: string;
  details?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Append-only audit logging (spec §1.20, §28). Never throws into the request
 * path — a failed audit write is logged loudly instead of failing the business
 * operation (the operation itself is transactional; audit is fire-and-forget
 * with persistence best-effort in Phase 1; moves to outbox with BullMQ).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      let actorEmail = entry.actorEmail ?? null;
      if (!actorEmail && entry.actorUserId) {
        actorEmail = (await this.prisma.user.findUnique({ where: { id: entry.actorUserId }, select: { email: true } }))?.email ?? null;
      }
      await this.prisma.auditLog.create({
        data: {
          event: entry.event,
          organizationId: entry.organizationId ?? null,
          actorUserId: entry.actorUserId ?? null,
          actorEmail,
          entityType: entry.entityType,
          entityId: entry.entityId,
          details: entry.details,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
        },
      });
    } catch (error) {
      this.logger.error(
        `AUDIT WRITE FAILED for event=${entry.event} entity=${entry.entityType ?? '?'}/${entry.entityId ?? '?'}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private whereFor(organizationId: string, filters: AuditFilters): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { organizationId };
    if (filters.event) where.event = filters.event;
    if (filters.actorUserId) where.actorUserId = filters.actorUserId;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    const createdAt = dateRangeFilter(filters.from, filters.to);
    if (createdAt) where.createdAt = createdAt;
    if (filters.search) {
      where.OR = [
        { event: { contains: filters.search, mode: 'insensitive' } },
        { actorEmail: { contains: filters.search, mode: 'insensitive' } },
        { entityType: { contains: filters.search, mode: 'insensitive' } },
        { entityId: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  /** Distinct events and actors seen in this organization, for filter pickers. */
  async filterOptions(organizationId: string) {
    const [events, entityTypes, actors] = await Promise.all([
      this.prisma.auditLog.findMany({ where: { organizationId }, distinct: ['event'], select: { event: true }, orderBy: { event: 'asc' } }),
      this.prisma.auditLog.findMany({
        where: { organizationId, entityType: { not: null } },
        distinct: ['entityType'],
        select: { entityType: true },
        orderBy: { entityType: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        where: { organizationId, actorUserId: { not: null } },
        distinct: ['actorUserId'],
        select: { actorUserId: true, actorEmail: true },
      }),
    ]);
    return {
      events: events.map((e) => e.event),
      entityTypes: entityTypes.map((e) => e.entityType as string),
      actors: actors.map((a) => ({ userId: a.actorUserId as string, email: a.actorEmail })),
    };
  }

  async exportForOrganization(organizationId: string, filters: AuditFilters) {
    const rows = await this.prisma.auditLog.findMany({
      where: this.whereFor(organizationId, filters),
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    return {
      headers: ['When', 'Event', 'Actor', 'Entity type', 'Entity id', 'IP address', 'Details'],
      rows: rows.map((r) => [
        r.createdAt.toISOString(),
        r.event,
        r.actorEmail ?? r.actorUserId ?? 'system',
        r.entityType ?? '',
        r.entityId ?? '',
        r.ipAddress ?? '',
        r.details ? JSON.stringify(r.details) : '',
      ]),
    };
  }

  async listForOrganization(organizationId: string, params: { page: number; pageSize: number } & AuditFilters) {
    const { page, pageSize } = params;
    const where = this.whereFor(organizationId, params);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    // Rows are immutable; resolve actor emails missing from older entries at read time.
    const missing = [...new Set(rows.filter((r) => !r.actorEmail && r.actorUserId).map((r) => r.actorUserId as string))];
    if (missing.length === 0) return [total, rows] as const;
    const users = await this.prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, email: true } });
    const emailOf = new Map(users.map((u) => [u.id, u.email]));
    return [total, rows.map((r) => (r.actorEmail || !r.actorUserId ? r : { ...r, actorEmail: emailOf.get(r.actorUserId) ?? null }))] as const;
  }
}
