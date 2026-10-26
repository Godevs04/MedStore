import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { paginationQuerySchema } from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { AuditService } from './audit.service.js';
import { UsePipes } from '@nestjs/common';

@ApiTags('audit')
@UseGuards(TenantContextGuard)
@Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @UsePipes(new ZodValidationPipe(paginationQuerySchema))
  @RequirePermissions('audit.read')
  async list(
    @Req() req: TenantRequest,
    @Query() query: { page: number; pageSize: number },
  ) {
    const [total, items] = await this.audit.listForOrganization(req.tenantContext.organizationId, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items,
      pageInfo: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        hasNextPage: query.page * query.pageSize < total,
        hasPreviousPage: query.page > 1,
      },
    };
  }
}
