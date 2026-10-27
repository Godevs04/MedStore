import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { paginationQuerySchema } from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { RequireModule } from '../common/subscription-policy.js';
import { SalesService } from './sales.service.js';

const saleLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/),
  discountAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  explicitBatchId: z.string().uuid().nullish(),
});

const saleCreateSchema = z.object({
  customerId: z.string().uuid().nullish(),
  walkInName: z.string().trim().max(120).nullish(),
  warehouseId: z.string().uuid(),
  lines: z.array(saleLineSchema).min(1).max(100),
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'UPI', 'CARD', 'CREDIT', 'BANK']),
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        reference: z.string().max(120).nullish(),
      }),
    )
    .min(1)
    .max(10),
  idempotencyKey: z.string().min(8).max(64).nullish(),
  prescription: z
    .object({
      patientName: z.string().trim().min(1).max(160),
      prescriberName: z.string().trim().min(1).max(160),
      prescriberAddress: z.string().trim().min(3).max(300),
    })
    .nullish(),
});

const saleReturnCreateSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  refundMethod: z.enum(['CASH', 'UPI', 'CARD', 'BANK']).optional(),
  lines: z
    .array(
      z.object({
        invoiceLineId: z.string().uuid(),
        quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
        restock: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
});

const customerReceiptSchema = z.object({
  customerId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']),
  reference: z.string().max(120).nullish(),
});

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
  async listInvoices(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    const [total, items] = await this.sales.listInvoices(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      customerId,
      search,
      from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined,
      to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : undefined,
      status: status && ['POSTED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED'].includes(status) ? status : undefined,
    });
    return { items, pageInfo: { page: pagination.page, pageSize: pagination.pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)), hasNextPage: pagination.page * pagination.pageSize < total, hasPreviousPage: pagination.page > 1 } };
  }

  @Get('invoices/:invoiceId')
  @RequirePermissions('sales.read')
  getInvoice(@Param('invoiceId') invoiceId: string, @Req() req: TenantRequest) {
    return this.sales.getInvoice(req, invoiceId);
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
  async listReturns(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
  ) {
    const [total, items] = await this.sales.listReturns(req, { page: pagination.page, pageSize: pagination.pageSize });
    return { items, pageInfo: { page: pagination.page, pageSize: pagination.pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)), hasNextPage: pagination.page * pagination.pageSize < total, hasPreviousPage: pagination.page > 1 } };
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
