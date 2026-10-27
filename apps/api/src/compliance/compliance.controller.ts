import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { paginationQuerySchema } from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { sendCsv } from '../common/csv.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { ComplianceService, LICENCE_TYPES } from './compliance.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

const integrationUpsertSchema = z.object({
  provider: z.enum(['GST_EINVOICE', 'EWAY_BILL', 'WHATSAPP', 'SMS', 'EMAIL_SMTP', 'PAYMENT_GATEWAY']),
  config: z.record(z.string().max(200)).optional(),
});

const licenceSchema = z.object({
  licenceType: z.enum(LICENCE_TYPES),
  licenceNumber: z.string().trim().min(2).max(80),
  issuingAuthority: z.string().trim().max(160).nullish(),
  issueDate: isoDate.nullish(),
  expiryDate: isoDate,
  branchId: z.string().uuid().nullish(),
});

@ApiTags('compliance')
@UseGuards(TenantContextGuard)
@Controller({ path: 'compliance', version: '1' })
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('h1-register')
  @RequirePermissions('compliance.read')
  h1Register(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return this.compliance.h1Register(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      from: optionalDate(from),
      to: optionalDate(to),
      search: search?.trim() || undefined,
    });
  }

  @Get('h1-register/export')
  @RequirePermissions('compliance.read', 'reports.export')
  async h1RegisterExport(@Req() req: TenantRequest, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const { headers, rows } = await this.compliance.h1RegisterExport(req, { from: optionalDate(from), to: optionalDate(to) });
    sendCsv(res, `h1-register-${optionalDate(from) ?? 'all'}-${optionalDate(to) ?? 'today'}.csv`, headers, rows);
  }

  @Get('licences')
  @RequirePermissions('compliance.read')
  listLicences(@Req() req: TenantRequest) {
    return this.compliance.listLicences(req);
  }

  @Post('licences')
  @RequirePermissions('compliance.manage')
  createLicence(@Body(new ZodValidationPipe(licenceSchema)) dto: z.infer<typeof licenceSchema>, @Req() req: TenantRequest) {
    return this.compliance.upsertLicence(req, null, dto);
  }

  @Patch('licences/:licenceId')
  @RequirePermissions('compliance.manage')
  updateLicence(@Param('licenceId') licenceId: string, @Body(new ZodValidationPipe(licenceSchema)) dto: z.infer<typeof licenceSchema>, @Req() req: TenantRequest) {
    return this.compliance.upsertLicence(req, licenceId, dto);
  }

  @Get('licence-alerts')
  @RequirePermissions('compliance.read')
  licenceAlerts(@Req() req: TenantRequest) {
    return this.compliance.licenceAlerts(req);
  }

  @Get('gst/sales-summary')
  @RequirePermissions('compliance.read')
  gstSalesSummary(@Req() req: TenantRequest, @Query('from') from?: string, @Query('to') to?: string) {
    return this.compliance.gstSalesSummary(req, optionalDate(from), optionalDate(to));
  }

  @Get('gst/sales-summary/export')
  @RequirePermissions('compliance.read', 'reports.export')
  async gstSalesExport(@Req() req: TenantRequest, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const s = await this.compliance.gstSalesSummary(req, optionalDate(from), optionalDate(to));
    sendCsv(
      res,
      `gst-hsn-summary-${optionalDate(from) ?? 'all'}-${optionalDate(to) ?? 'today'}.csv`,
      ['HSN', 'Rate %', 'Lines', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess', 'Total tax'],
      s.rows.map((r) => [r.hsnCode, r.rate, r.count, r.taxable, r.cgst, r.sgst, r.igst, r.cess, r.totalTax]),
    );
  }

  @Get('gst/purchase-summary')
  @RequirePermissions('compliance.read')
  gstPurchaseSummary(@Req() req: TenantRequest, @Query('from') from?: string, @Query('to') to?: string) {
    return this.compliance.gstPurchaseSummary(req, optionalDate(from), optionalDate(to));
  }

  @Get('integrations')
  @RequirePermissions('compliance.read')
  listIntegrations(@Req() req: TenantRequest) {
    return this.compliance.listIntegrations(req);
  }

  @Post('integrations')
  @RequirePermissions('organization.settings.manage')
  upsertIntegration(@Body(new ZodValidationPipe(integrationUpsertSchema)) dto: z.infer<typeof integrationUpsertSchema>, @Req() req: TenantRequest) {
    return this.compliance.upsertIntegration(req, dto.provider, { config: dto.config });
  }
}
