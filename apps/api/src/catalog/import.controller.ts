import { Body, Controller, ForbiddenException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { ImportService, type ImportType } from './import.service.js';

const importPreviewSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
});

const importCommitSchema = z.object({
  validatedRows: z.array(z.record(z.string(), z.unknown())).min(0).max(5000),
});

const IMPORT_TYPES = new Set<ImportType>(['products', 'vendors', 'customers']);

const PERMISSION_FOR_TYPE: Record<ImportType, string> = {
  products: 'products.import',
  vendors: 'vendors.import',
  customers: 'customers.import',
};

function assertImportType(type: string): asserts type is ImportType {
  if (!IMPORT_TYPES.has(type as ImportType)) {
    throw new ForbiddenException(`Unknown import type: ${type}`);
  }
}

/**
 * Import endpoints (spec §29): preview validates every row server-side and
 * returns row-level errors; commit only accepts rows re-validated at commit
 * time. Retry-safe: duplicate keys are counted as skipped, never duplicated.
 */
@ApiTags('imports')
@UseGuards(TenantContextGuard)
@Controller({ path: 'imports', version: '1' })
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  private assertPermission(req: TenantRequest, type: ImportType): void {
    if (!req.tenantContext.permissions.has(PERMISSION_FOR_TYPE[type])) {
      throw new ForbiddenException(`Missing required permission(s): ${PERMISSION_FOR_TYPE[type]}`);
    }
  }

  @Post(':type/preview')
  async preview(
    @Param('type') type: string,
    @Body(new ZodValidationPipe(importPreviewSchema)) dto: z.infer<typeof importPreviewSchema>,
    @Req() req: TenantRequest,
  ) {
    assertImportType(type);
    this.assertPermission(req, type);
    return this.imports.preview(req, type, dto.rows);
  }

  @Post(':type/commit')
  async commit(
    @Param('type') type: string,
    @Body(new ZodValidationPipe(importCommitSchema)) dto: z.infer<typeof importCommitSchema>,
    @Req() req: TenantRequest,
  ) {
    assertImportType(type);
    this.assertPermission(req, type);
    return this.imports.commit(req, type, dto.validatedRows);
  }
}
