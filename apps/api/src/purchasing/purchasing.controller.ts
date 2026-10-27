import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { paginationQuerySchema } from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { RequireModule } from '../common/subscription-policy.js';
import { PurchasingService } from './purchasing.service.js';

const poCreateSchema = z.object({
  vendorId: z.string().uuid(),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  notes: z.string().max(500).nullish(),
  lines: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.string().regex(/^\d+(\.\d{1,3})?$/), unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/) }))
    .min(1)
    .max(200),
});

const poActionSchema = z.object({ action: z.enum(['send', 'confirm', 'cancel']) });

const grnCreateSchema = z.object({
  vendorId: z.string().uuid(),
  poId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid(),
  notes: z.string().max(500).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        poLineId: z.string().uuid().nullish(),
        batchNumber: z.string().trim().min(1).max(64),
        expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        manufacturingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
        freeQuantity: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
        purchaseRate: z.string().regex(/^\d+(\.\d{1,4})?$/),
        mrp: z.string().regex(/^\d+(\.\d{1,4})?$/),
      }),
    )
    .min(1)
    .max(500),
});

const purchaseInvoiceCreateSchema = z.object({
  vendorId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1).max(64),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  grnId: z.string().uuid().nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
        freeQty: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
        unitCost: z.string().regex(/^\d+(\.\d{1,4})?$/),
      }),
    )
    .min(1)
    .max(500),
});

const supplierPaymentCreateSchema = z.object({
  vendorId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  method: z.enum(['CASH', 'BANK', 'UPI']),
  reference: z.string().max(120).nullish(),
  allocations: z
    .array(z.object({ invoiceId: z.string().uuid(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/) }))
    .min(1)
    .max(100),
});

const purchaseReturnCreateSchema = z.object({
  vendorId: z.string().uuid(),
  invoiceId: z.string().uuid().nullish(),
  reason: z.string().trim().min(3).max(500),
  lines: z
    .array(
      z.object({
        batchId: z.string().uuid(),
        quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
        rate: z.string().regex(/^\d+(\.\d{1,4})?$/),
      }),
    )
    .min(1)
    .max(200),
});

@ApiTags('purchasing')
@UseGuards(TenantContextGuard)
@RequireModule('purchases')
@Controller({ path: 'purchasing', version: '1' })
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Post('purchase-orders')
  @RequirePermissions('purchases.create')
  createPO(@Body(new ZodValidationPipe(poCreateSchema)) dto: z.infer<typeof poCreateSchema>, @Req() req: TenantRequest) {
    return this.purchasing.createPO(req, dto);
  }

  @Get('purchase-orders')
  @RequirePermissions('purchases.read')
  async listPOs(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
  ) {
    const [total, items] = await this.purchasing.listPOs(req, { page: pagination.page, pageSize: pagination.pageSize, status, vendorId });
    return { items, pageInfo: { page: pagination.page, pageSize: pagination.pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)), hasNextPage: pagination.page * pagination.pageSize < total, hasPreviousPage: pagination.page > 1 } };
  }

  @Post('purchase-orders/:poId/action')
  @RequirePermissions('purchases.approve')
  @HttpCode(HttpStatus.OK)
  setPOStatus(
    @Param('poId') poId: string,
    @Body(new ZodValidationPipe(poActionSchema)) dto: z.infer<typeof poActionSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.purchasing.setPOStatus(req, poId, dto.action);
  }

  @Post('goods-receipts')
  @RequirePermissions('purchases.receive')
  createGRN(@Body(new ZodValidationPipe(grnCreateSchema)) dto: z.infer<typeof grnCreateSchema>, @Req() req: TenantRequest) {
    return this.purchasing.createGRN(req, dto);
  }

  @Get('goods-receipts')
  @RequirePermissions('purchases.read')
  async listGRNs(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query('vendorId') vendorId?: string,
    @Query('uninvoiced') uninvoiced?: string,
  ) {
    const [total, items] = await this.purchasing.listGRNs(req, { page: pagination.page, pageSize: pagination.pageSize, vendorId, uninvoiced: uninvoiced === 'true' });
    return { items, pageInfo: { page: pagination.page, pageSize: pagination.pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)), hasNextPage: pagination.page * pagination.pageSize < total, hasPreviousPage: pagination.page > 1 } };
  }

  @Post('invoices')
  @RequirePermissions('purchases.receive')
  createPurchaseInvoice(@Body(new ZodValidationPipe(purchaseInvoiceCreateSchema)) dto: z.infer<typeof purchaseInvoiceCreateSchema>, @Req() req: TenantRequest) {
    return this.purchasing.createPurchaseInvoice(req, dto);
  }

  @Get('invoices')
  @RequirePermissions('purchases.read')
  async listInvoices(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
  ) {
    const [total, items] = await this.purchasing.listInvoices(req, { page: pagination.page, pageSize: pagination.pageSize, status, vendorId });
    return { items, pageInfo: { page: pagination.page, pageSize: pagination.pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)), hasNextPage: pagination.page * pagination.pageSize < total, hasPreviousPage: pagination.page > 1 } };
  }

  @Post('payments')
  @RequirePermissions('purchases.pay')
  recordPayment(@Body(new ZodValidationPipe(supplierPaymentCreateSchema)) dto: z.infer<typeof supplierPaymentCreateSchema>, @Req() req: TenantRequest) {
    return this.purchasing.recordPayment(req, dto);
  }

  @Get('payments')
  @RequirePermissions('purchases.read')
  async listPayments(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
  ) {
    const [total, items] = await this.purchasing.listPayments(req, { page: pagination.page, pageSize: pagination.pageSize });
    return { items, pageInfo: { page: pagination.page, pageSize: pagination.pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)), hasNextPage: pagination.page * pagination.pageSize < total, hasPreviousPage: pagination.page > 1 } };
  }

  @Get('vendors/:vendorId/ledger')
  @RequirePermissions('purchases.read')
  vendorLedger(@Param('vendorId') vendorId: string, @Req() req: TenantRequest) {
    return this.purchasing.vendorLedger(req, vendorId);
  }

  @Post('purchase-returns')
  @RequirePermissions('purchases.pay')
  createPurchaseReturn(@Body(new ZodValidationPipe(purchaseReturnCreateSchema)) dto: z.infer<typeof purchaseReturnCreateSchema>, @Req() req: TenantRequest) {
    return this.purchasing.createPurchaseReturn(req, dto);
  }

  @Get('purchase-returns')
  @RequirePermissions('purchases.read')
  async listReturns(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
  ) {
    const [total, items] = await this.purchasing.listReturns(req, { page: pagination.page, pageSize: pagination.pageSize });
    return { items, pageInfo: { page: pagination.page, pageSize: pagination.pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)), hasNextPage: pagination.page * pagination.pageSize < total, hasPreviousPage: pagination.page > 1 } };
  }
}
