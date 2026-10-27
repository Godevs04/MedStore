import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditEvent } from '@medicore/shared-types';
import { PrismaService } from '../prisma/prisma.module.js';

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

  async listForOrganization(organizationId: string, params: { page: number; pageSize: number }) {
    const { page, pageSize } = params;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where: { organizationId } }),
      this.prisma.auditLog.findMany({
        where: { organizationId },
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
