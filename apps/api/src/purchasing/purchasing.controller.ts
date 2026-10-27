import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  paginationQuerySchema,
  purchaseDuplicateQuerySchema,
  purchaseListQuerySchema,
  reorderSuggestionsQuerySchema,
} from '@medicore/validation';
import { pageInfo } from '../common/query.js';
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

type Pagination = z.infer<typeof paginationQuerySchema>;
type ListQuery = z.infer<typeof purchaseListQuerySchema>;

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
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: Pagination,
    @Query(new ZodValidationPipe(purchaseListQuerySchema)) filters: ListQuery,
  ) {
    const [total, items] = await this.purchasing.listPOs(req, { ...pagination, ...filters });
    return { items, pageInfo: pageInfo(pagination, total) };
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
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: Pagination,
    @Query(new ZodValidationPipe(purchaseListQuerySchema)) filters: ListQuery,
  ) {
    const [total, items] = await this.purchasing.listGRNs(req, { ...pagination, ...filters });
    return { items, pageInfo: pageInfo(pagination, total) };
  }

  @Post('invoices')
  @RequirePermissions('purchases.receive')
  createPurchaseInvoice(@Body(new ZodValidationPipe(purchaseInvoiceCreateSchema)) dto: z.infer<typeof purchaseInvoiceCreateSchema>, @Req() req: TenantRequest) {
    return this.purchasing.createPurchaseInvoice(req, dto);
  }

  @Get('invoices/check-duplicate')
  @RequirePermissions('purchases.read')
  checkDuplicateInvoice(@Query(new ZodValidationPipe(purchaseDuplicateQuerySchema)) q: z.infer<typeof purchaseDuplicateQuerySchema>, @Req() req: TenantRequest) {
    return this.purchasing.checkDuplicateInvoice(req, q.vendorId, q.invoiceNumber);
  }

  @Get('invoices')
  @RequirePermissions('purchases.read')
  async listInvoices(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: Pagination,
    @Query(new ZodValidationPipe(purchaseListQuerySchema)) filters: ListQuery,
  ) {
    const [total, items] = await this.purchasing.listInvoices(req, { ...pagination, ...filters });
    return { items, pageInfo: pageInfo(pagination, total) };
  }

  @Get('summary')
  @RequirePermissions('purchases.read')
  summary(@Req() req: TenantRequest) {
    return this.purchasing.summary(req);
  }

  @Get('reorder-suggestions')
  @RequirePermissions('purchases.read')
  reorderSuggestions(@Query(new ZodValidationPipe(reorderSuggestionsQuerySchema)) q: z.infer<typeof reorderSuggestionsQuerySchema>, @Req() req: TenantRequest) {
    return this.purchasing.reorderSuggestions(req, q);
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
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: Pagination,
    @Query(new ZodValidationPipe(purchaseListQuerySchema)) filters: ListQuery,
  ) {
    const [total, items] = await this.purchasing.listPayments(req, { ...pagination, ...filters });
    return { items, pageInfo: pageInfo(pagination, total) };
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
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: Pagination,
    @Query(new ZodValidationPipe(purchaseListQuerySchema)) filters: ListQuery,
  ) {
    const [total, items] = await this.purchasing.listReturns(req, { ...pagination, ...filters });
    return { items, pageInfo: pageInfo(pagination, total) };
  }
}
