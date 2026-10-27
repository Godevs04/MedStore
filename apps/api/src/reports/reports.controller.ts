import { BadRequestException, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { dateRangeQuerySchema, deadStockQuerySchema, paginationQuerySchema } from '@medicore/validation';
import { z } from 'zod';
import { sendCsv } from '../common/csv.js';
import { AuditService } from '../audit/audit.service.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { ReportsService } from './reports.service.js';

const optionalDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

const trendQuerySchema = z.object({ days: z.coerce.number().int().min(7).max(90).default(14) });

@ApiTags('reports')
@UseGuards(TenantContextGuard)
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('organization.read')
  dashboard(@Req() req: TenantRequest) {
    return this.reports.dashboard(req);
  }

  @Get('dashboard/trend')
  @RequirePermissions('organization.read')
  dashboardTrend(@Req() req: TenantRequest, @Query(new ZodValidationPipe(trendQuerySchema)) query: z.infer<typeof trendQuerySchema>) {
    return this.reports.dashboardTrend(req, query.days);
  }

  @Get('payment-mix')
  @RequirePermissions('reports.read')
  paymentMix(@Req() req: TenantRequest, @Query(new ZodValidationPipe(dateRangeQuerySchema)) query: z.infer<typeof dateRangeQuerySchema>) {
    return this.reports.paymentMix(req, query.from, query.to);
  }

  @Get('expiry-value')
  @RequirePermissions('reports.read')
  expiryValue(@Req() req: TenantRequest) {
    return this.reports.expiryValue(req);
  }

  @Get('sales-summary')
  @RequirePermissions('reports.read')
  salesSummary(@Req() req: TenantRequest, @Query(new ZodValidationPipe(dateRangeQuerySchema)) q: z.infer<typeof dateRangeQuerySchema>) {
    return this.reports.salesSummary(req, q.from, q.to);
  }

  @Get('dead-stock')
  @RequirePermissions('reports.read')
  deadStock(@Req() req: TenantRequest, @Query(new ZodValidationPipe(deadStockQuerySchema)) q: z.infer<typeof deadStockQuerySchema>) {
    return this.reports.deadStock(req, q);
  }

  @Get('stock-valuation')
  @RequirePermissions('reports.read')
  stockValuation(@Req() req: TenantRequest) {
    return this.reports.stockValuation(req);
  }

  @Get('aging')
  @RequirePermissions('reports.read')
  aging(@Req() req: TenantRequest) {
    return this.reports.aging(req);
  }

  /** CSV exports of report rows (spec §29), permission-gated and audited. */
  @Get('export/:report')
  @RequirePermissions('reports.read', 'reports.export')
  async export(@Param('report') report: string, @Req() req: TenantRequest, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const f = optionalDate(from);
    const t = optionalDate(to);
    let headers: string[];
    let rows: unknown[][];
    if (report === 'sales-by-product') {
      const s = await this.reports.salesSummary(req, f, t);
      headers = ['Product', 'Quantity', 'Taxable revenue', 'Margin'];
      rows = s.byProduct.map((p) => [p.product, p.quantity, p.revenue, p.margin]);
    } else if (report === 'sales-by-day') {
      const s = await this.reports.salesSummary(req, f, t);
      headers = ['Date', 'Invoices', 'Revenue'];
      rows = s.byDay.map((d) => [d.date, d.invoices, d.revenue]);
    } else if (report === 'stock-valuation') {
      const v = await this.reports.stockValuation(req);
      headers = ['Product', 'SKU', 'Batch', 'Expiry', 'Status', 'Quantity', 'Purchase rate', 'MRP', 'Value'];
      rows = v.rows.map((r) => [r.product, r.sku, r.batchNumber, r.expiryDate, r.status, r.quantity, r.purchaseRate, r.mrp, r.value]);
    } else if (report === 'dead-stock') {
      const d = await this.reports.deadStock(req, { days: 90 });
      headers = ['Product', 'SKU', 'Rack', 'Class', 'On hand', 'Value at cost', 'Sold in 90 days', 'Last sold', 'Days of cover', 'Nearest expiry'];
      rows = d.items.map((r) => [r.name, r.sku, r.rackLocation, r.classification, r.onHand, r.value, r.soldQty, r.lastSoldAt, r.coverDays, r.nearestExpiry]);
    } else if (report === 'receivables' || report === 'payables') {
      const a = await this.reports.aging(req);
      headers = ['Party', 'Document', 'Outstanding', 'Days overdue', 'Bucket'];
      rows = a[report].rows.map((r) => [r.party, r.doc, r.outstanding, r.daysOverdue, r.bucket]);
    } else {
      throw new BadRequestException(`Unknown report ${report}`);
    }
    await this.audit.record({
      event: 'EXPORT_GENERATED',
      organizationId: req.tenantContext.organizationId,
      actorUserId: req.principal.userId,
      entityType: 'Report',
      details: { report, rows: rows.length, from: f ?? null, to: t ?? null },
    });
    sendCsv(res, `${report}-${f ?? 'all'}-${t ?? 'today'}.csv`, headers, rows);
  }

  @Post('notifications/generate')
  @RequirePermissions('reports.read')
  generateNotifications(@Req() req: TenantRequest) {
    return this.reports.generateNotifications(req);
  }

  @Get('notifications')
  @RequirePermissions('reports.read')
  async listNotifications(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const [total, items] = await this.reports.listNotifications(req, { page: pagination.page, pageSize: pagination.pageSize, unreadOnly: unreadOnly === 'true' });
    return { items, pageInfo: { page: pagination.page, pageSize: pagination.pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)), hasNextPage: pagination.page * pagination.pageSize < total, hasPreviousPage: pagination.page > 1 } };
  }

  @Post('notifications/read-all')
  @RequirePermissions('reports.read')
  markAllRead(@Req() req: TenantRequest) {
    return this.reports.markAllNotificationsRead(req);
  }

  @Post('notifications/:id/read')
  @RequirePermissions('reports.read')
  markRead(@Param('id') id: string, @Req() req: TenantRequest) {
    return this.reports.markNotificationRead(req, id);
  }
}
