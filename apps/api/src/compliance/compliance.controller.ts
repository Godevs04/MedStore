import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { dateRangeQuerySchema, h1RegisterQuerySchema, licenceUpsertSchema, paginationQuerySchema, returnPeriodQuerySchema } from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { sendCsv } from '../common/csv.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { ComplianceService } from './compliance.service.js';

const integrationUpsertSchema = z.object({
  provider: z.enum(['GST_EINVOICE', 'EWAY_BILL', 'WHATSAPP', 'SMS', 'EMAIL_SMTP', 'PAYMENT_GATEWAY']),
  config: z.record(z.string().max(200)).optional(),
});

type DateRange = z.infer<typeof dateRangeQuerySchema>;

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
    @Query(new ZodValidationPipe(h1RegisterQuerySchema)) query: z.infer<typeof h1RegisterQuerySchema>,
  ) {
    return this.compliance.h1Register(req, { page: pagination.page, pageSize: pagination.pageSize, from: query.from, to: query.to, search: query.search || undefined });
  }

  @Get('h1-register/export')
  @RequirePermissions('compliance.read', 'reports.export')
  async h1RegisterExport(@Req() req: TenantRequest, @Res() res: Response, @Query(new ZodValidationPipe(dateRangeQuerySchema)) q: DateRange) {
    const { headers, rows } = await this.compliance.h1RegisterExport(req, q);
    sendCsv(res, `h1-register-${q.from ?? 'all'}-${q.to ?? 'today'}.csv`, headers, rows);
  }

  @Get('licences')
  @RequirePermissions('compliance.read')
  listLicences(@Req() req: TenantRequest) {
    return this.compliance.listLicences(req);
  }

  @Get('licences/overview')
  @RequirePermissions('compliance.read')
  licenceOverview(@Req() req: TenantRequest) {
    return this.compliance.licenceOverview(req);
  }

  @Post('licences')
  @RequirePermissions('compliance.manage')
  createLicence(@Body(new ZodValidationPipe(licenceUpsertSchema)) dto: z.infer<typeof licenceUpsertSchema>, @Req() req: TenantRequest) {
    return this.compliance.upsertLicence(req, null, dto);
  }

  @Patch('licences/:licenceId')
  @RequirePermissions('compliance.manage')
  updateLicence(@Param('licenceId') licenceId: string, @Body(new ZodValidationPipe(licenceUpsertSchema)) dto: z.infer<typeof licenceUpsertSchema>, @Req() req: TenantRequest) {
    return this.compliance.upsertLicence(req, licenceId, dto);
  }

  @Get('licence-alerts')
  @RequirePermissions('compliance.read')
  licenceAlerts(@Req() req: TenantRequest) {
    return this.compliance.licenceAlerts(req);
  }

  @Get('gst/sales-summary')
  @RequirePermissions('compliance.read')
  gstSalesSummary(@Req() req: TenantRequest, @Query(new ZodValidationPipe(dateRangeQuerySchema)) q: DateRange) {
    return this.compliance.gstSalesSummary(req, q.from, q.to);
  }

  @Get('gst/sales-summary/export')
  @RequirePermissions('compliance.read', 'reports.export')
  async gstSalesExport(@Req() req: TenantRequest, @Res() res: Response, @Query(new ZodValidationPipe(dateRangeQuerySchema)) q: DateRange) {
    const s = await this.compliance.gstSalesSummary(req, q.from, q.to);
    sendCsv(
      res,
      `gst-hsn-summary-${q.from ?? 'all'}-${q.to ?? 'today'}.csv`,
      ['HSN', 'Rate %', 'Lines', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess', 'Total tax'],
      s.rows.map((r) => [r.hsnCode, r.rate, r.count, r.taxable, r.cgst, r.sgst, r.igst, r.cess, r.totalTax]),
    );
  }

  @Get('gst/purchase-summary')
  @RequirePermissions('compliance.read')
  gstPurchaseSummary(@Req() req: TenantRequest, @Query(new ZodValidationPipe(dateRangeQuerySchema)) q: DateRange) {
    return this.compliance.gstPurchaseSummary(req, q.from, q.to);
  }

  @Get('gst/gstr1/export')
  @RequirePermissions('compliance.read', 'reports.export')
  gstr1Export(@Req() req: TenantRequest, @Query(new ZodValidationPipe(returnPeriodQuerySchema)) q: z.infer<typeof returnPeriodQuerySchema>) {
    return this.compliance.gstr1(req, q.period);
  }

  @Get('gst/gstr3b')
  @RequirePermissions('compliance.read')
  gstr3b(@Req() req: TenantRequest, @Query(new ZodValidationPipe(returnPeriodQuerySchema)) q: z.infer<typeof returnPeriodQuerySchema>) {
    return this.compliance.gstr3b(req, q.period);
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
