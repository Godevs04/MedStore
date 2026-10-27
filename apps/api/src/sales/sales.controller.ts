import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { sendCsv } from '../common/csv.js';
import type { z } from 'zod';
import {
  customerReceiptSchema,
  heldBillCreateSchema,
  invoiceCancelSchema,
  invoiceListQuerySchema,
  returnListQuerySchema,
  saleCreateSchema,
  saleReturnCreateSchema,
} from '@medicore/validation';
import { pageInfo } from '../common/query.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { RequireModule } from '../common/subscription-policy.js';
import { SalesService } from './sales.service.js';

@ApiTags('sales')
@UseGuards(TenantContextGuard)
@RequireModule('pos')
@Controller({ path: 'sales', version: '1' })
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** POS posting — idempotency-key guarded, FEFO, tax, register, accounting. */
  @Post('invoices')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('sales.create')
  createInvoice(@Body(new ZodValidationPipe(saleCreateSchema)) dto: z.infer<typeof saleCreateSchema>, @Req() req: TenantRequest) {
    return this.sales.createInvoice(req, dto);
  }

  @Get('invoices')
  @RequirePermissions('sales.read')
  async listInvoices(@Req() req: TenantRequest, @Query(new ZodValidationPipe(invoiceListQuerySchema)) query: z.infer<typeof invoiceListQuerySchema>) {
    const [total, items] = await this.sales.listInvoices(req, query);
    return { items, pageInfo: pageInfo(query, total) };
  }

  @Get('invoices/export')
  @RequirePermissions('sales.read', 'reports.export')
  async exportInvoices(
    @Req() req: TenantRequest,
    @Res() res: Response,
    @Query(new ZodValidationPipe(invoiceListQuerySchema)) query: z.infer<typeof invoiceListQuerySchema>,
  ) {
    const { headers, rows } = await this.sales.exportInvoices(req, query);
    sendCsv(res, `sales-invoices-${query.from ?? 'all'}-${query.to ?? 'today'}.csv`, headers, rows);
  }

  @Get('invoices/summary')
  @RequirePermissions('sales.read')
  invoiceSummary(@Req() req: TenantRequest, @Query(new ZodValidationPipe(invoiceListQuerySchema)) query: z.infer<typeof invoiceListQuerySchema>) {
    return this.sales.invoiceSummary(req, query);
  }

  @Get('invoices/:invoiceId')
  @RequirePermissions('sales.read')
  getInvoice(@Param('invoiceId') invoiceId: string, @Req() req: TenantRequest) {
    return this.sales.getInvoice(req, invoiceId);
  }

  @Post('invoices/:invoiceId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales.void')
  cancelInvoice(
    @Param('invoiceId') invoiceId: string,
    @Body(new ZodValidationPipe(invoiceCancelSchema)) dto: z.infer<typeof invoiceCancelSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.sales.cancelInvoice(req, invoiceId, dto.reason);
  }

  @Get('held-bills')
  @RequirePermissions('sales.create')
  listHeldBills(@Req() req: TenantRequest) {
    return this.sales.listHeldBills(req);
  }

  @Post('held-bills')
  @RequirePermissions('sales.create')
  holdBill(@Body(new ZodValidationPipe(heldBillCreateSchema)) dto: z.infer<typeof heldBillCreateSchema>, @Req() req: TenantRequest) {
    return this.sales.holdBill(req, dto);
  }

  @Delete('held-bills/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('sales.create')
  async deleteHeldBill(@Param('id') id: string, @Req() req: TenantRequest) {
    await this.sales.deleteHeldBill(req, id);
  }

  @RequireModule('returns')
  @Post('returns')
  @RequirePermissions('returns.create')
  createReturn(@Body(new ZodValidationPipe(saleReturnCreateSchema)) dto: z.infer<typeof saleReturnCreateSchema>, @Req() req: TenantRequest) {
    return this.sales.createSalesReturn(req, dto);
  }

  @RequireModule('returns')
  @Get('returns')
  @RequirePermissions('returns.read')
  async listReturns(@Req() req: TenantRequest, @Query(new ZodValidationPipe(returnListQuerySchema)) query: z.infer<typeof returnListQuerySchema>) {
    const [total, items] = await this.sales.listReturns(req, query);
    return { items, pageInfo: pageInfo(query, total) };
  }

  @RequireModule('returns')
  @Get('returns/export')
  @RequirePermissions('returns.read', 'reports.export')
  async exportReturns(
    @Req() req: TenantRequest,
    @Res() res: Response,
    @Query(new ZodValidationPipe(returnListQuerySchema)) query: z.infer<typeof returnListQuerySchema>,
  ) {
    const { headers, rows } = await this.sales.exportReturns(req, query);
    sendCsv(res, `sales-returns-${query.from ?? 'all'}-${query.to ?? 'today'}.csv`, headers, rows);
  }

  @Post('receipts')
  @RequirePermissions('sales.receipts')
  recordReceipt(@Body(new ZodValidationPipe(customerReceiptSchema)) dto: z.infer<typeof customerReceiptSchema>, @Req() req: TenantRequest) {
    return this.sales.recordCustomerReceipt(req, dto);
  }

  @Get('customers/:customerId/outstanding')
  @RequirePermissions('customers.read')
  customerOutstanding(@Param('customerId') customerId: string, @Req() req: TenantRequest) {
    return this.sales.customerOutstanding(req, customerId);
  }

  @Get('customers/:customerId/statement')
  @RequirePermissions('customers.read')
  customerStatement(@Param('customerId') customerId: string, @Req() req: TenantRequest) {
    return this.sales.customerStatement(req, customerId);
  }
}
