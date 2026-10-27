import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { calendarDateSchema, paginationQuerySchema } from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { sendCsv } from '../common/csv.js';
import { pageInfo } from '../common/query.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { AuditService } from './audit.service.js';

const auditQuerySchema = z.object({
  event: z.string().trim().max(64).optional(),
  actorUserId: z.string().uuid().optional(),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  search: z.string().trim().max(120).optional(),
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
});

@ApiTags('audit')
@UseGuards(TenantContextGuard)
@Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  async list(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(auditQuerySchema)) filters: z.infer<typeof auditQuerySchema>,
  ) {
    const [total, items] = await this.audit.listForOrganization(req.tenantContext.organizationId, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      ...filters,
    });
    return { items, pageInfo: pageInfo(pagination, total) };
  }

  @Get('filters')
  @RequirePermissions('audit.read')
  filterOptions(@Req() req: TenantRequest) {
    return this.audit.filterOptions(req.tenantContext.organizationId);
  }

  @Get('export')
  @RequirePermissions('audit.read', 'reports.export')
  async export(
    @Req() req: TenantRequest,
    @Res() res: Response,
    @Query(new ZodValidationPipe(auditQuerySchema)) filters: z.infer<typeof auditQuerySchema>,
  ) {
    const orgId = req.tenantContext.organizationId;
    const { headers, rows } = await this.audit.exportForOrganization(orgId, filters);
    await this.audit.record({
      event: 'EXPORT_GENERATED',
      organizationId: orgId,
      actorUserId: req.principal.userId,
      actorEmail: req.principal.email,
      entityType: 'AuditLog',
      details: { rows: rows.length, ...filters },
    });
    sendCsv(res, `audit-log-${filters.from ?? 'all'}-${filters.to ?? 'today'}.csv`, headers, rows);
  }
}
