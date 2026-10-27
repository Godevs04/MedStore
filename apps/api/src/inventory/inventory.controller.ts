import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  adjustmentCreateSchema,
  adjustmentListQuerySchema,
  adjustmentSummaryQuerySchema,
  allocateBatchesRequestSchema,
  batchCreateSchema,
  batchQuerySchema,
  batchStatusUpdateSchema,
  countCancelSchema,
  countCreateSchema,
  countListQuerySchema,
  countSheetQuerySchema,
  expiryDashboardQuerySchema,
  expiryWriteoffSchema,
  ledgerQuerySchema,
  paginationQuerySchema,
  recallCreateSchema,
  recallListQuerySchema,
  recallResolveSchema,
  stockSummaryQuerySchema,
  transferCancelSchema,
  transferCreateSchema,
  transferListQuerySchema,
  transferReceiveSchema,
} from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { sendCsv } from '../common/csv.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('inventory')
@UseGuards(TenantContextGuard)
@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  // ── Batches ────────────────────────────────────────────────────────────────

  @Post('batches')
  @RequirePermissions('inventory.opening')
  createBatch(
    @Body(new ZodValidationPipe(batchCreateSchema)) dto: z.infer<typeof batchCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.createBatch(req, dto);
  }

  @Get('batches')
  @RequirePermissions('inventory.read')
  async listBatches(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(batchQuerySchema)) filters: z.infer<typeof batchQuerySchema>,
  ) {
    const { total, items } = await this.inventory.listBatches(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      batchId: filters.batchId,
      productId: filters.productId,
      warehouseId: filters.warehouseId,
      status: filters.status,
      search: filters.search,
      expiryAfter: filters.expiryAfter,
      expiryBefore: filters.expiryBefore,
    });
    return {
      items,
      pageInfo: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
        hasNextPage: pagination.page * pagination.pageSize < total,
        hasPreviousPage: pagination.page > 1,
      },
    };
  }

  @Put('batches/:batchId/status')
  @RequirePermissions('inventory.recall')
  setBatchStatus(
    @Param('batchId') batchId: string,
    @Body(new ZodValidationPipe(batchStatusUpdateSchema)) dto: z.infer<typeof batchStatusUpdateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.setBatchStatus(req, batchId, dto.status, dto.reason);
  }

  // ── Allocation (FEFO) ──────────────────────────────────────────────────────

  @Post('allocate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('inventory.read')
  async allocate(
    @Body(new ZodValidationPipe(allocateBatchesRequestSchema)) dto: z.infer<typeof allocateBatchesRequestSchema>,
    @Req() req: TenantRequest,
  ) {
    const allocations = await this.inventory.allocateFEFO(req, {
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      quantity: Number(dto.quantity),
      explicitBatchId: dto.explicitBatchId ?? null,
    });
    return { allocations };
  }

  @Get('stock-summary')
  @RequirePermissions('inventory.read')
  stockSummary(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(stockSummaryQuerySchema)) query: z.infer<typeof stockSummaryQuerySchema>,
  ) {
    return this.inventory.stockSummary(req, query);
  }

  // ── Operations lists ───────────────────────────────────────────────────────

  @Get('transfers')
  @RequirePermissions('inventory.read')
  async listTransfers(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(transferListQuerySchema)) filters: z.infer<typeof transferListQuerySchema>,
  ) {
    const [total, items] = await this.inventory.listTransfers(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      ...filters,
    });
    return { items, pageInfo: listPageInfo(pagination, total) };
  }

  @Get('transfers/:transferId')
  @RequirePermissions('inventory.read')
  getTransfer(@Param('transferId') transferId: string, @Req() req: TenantRequest) {
    return this.inventory.getTransfer(req, transferId);
  }

  @Get('counts/sheet')
  @RequirePermissions('inventory.count')
  countSheet(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(countSheetQuerySchema)) query: z.infer<typeof countSheetQuerySchema>,
  ) {
    return this.inventory.countSheet(req, query);
  }

  @Get('counts')
  @RequirePermissions('inventory.read')
  async listCounts(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(countListQuerySchema)) filters: z.infer<typeof countListQuerySchema>,
  ) {
    const [total, items] = await this.inventory.listCounts(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      ...filters,
    });
    return { items, pageInfo: listPageInfo(pagination, total) };
  }

  @Get('adjustments/summary')
  @RequirePermissions('inventory.read')
  adjustmentSummary(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(adjustmentSummaryQuerySchema)) query: z.infer<typeof adjustmentSummaryQuerySchema>,
  ) {
    return this.inventory.adjustmentSummary(req, query);
  }

  @Get('adjustments')
  @RequirePermissions('inventory.read')
  async listAdjustments(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(adjustmentListQuerySchema)) filters: z.infer<typeof adjustmentListQuerySchema>,
  ) {
    const [total, items] = await this.inventory.listAdjustments(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      ...filters,
    });
    return { items, pageInfo: listPageInfo(pagination, total) };
  }

  @Get('recalls')
  @RequirePermissions('inventory.read')
  async listRecalls(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(recallListQuerySchema)) filters: z.infer<typeof recallListQuerySchema>,
  ) {
    const [total, items] = await this.inventory.listRecalls(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      status: filters.status,
    });
    return { items, pageInfo: listPageInfo(pagination, total) };
  }

  // ── Expiry & ledger ────────────────────────────────────────────────────────

  @Get('expiry-dashboard')
  @RequirePermissions('inventory.read')
  expiryDashboard(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(expiryDashboardQuerySchema)) query: z.infer<typeof expiryDashboardQuerySchema>,
  ) {
    return this.inventory.expiryDashboard(req, { warehouseId: query.warehouseId, customDays: query.customDays });
  }

  @Post('expiry/bulk-writeoff')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('inventory.adjust')
  bulkExpiryWriteoff(
    @Body(new ZodValidationPipe(expiryWriteoffSchema)) dto: z.infer<typeof expiryWriteoffSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.bulkExpiryWriteoff(req, dto);
  }

  @Get('ledger/export')
  @RequirePermissions('inventory.read', 'reports.export')
  async exportLedger(
    @Req() req: TenantRequest,
    @Res() res: Response,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) filters: z.infer<typeof ledgerQuerySchema>,
  ) {
    const { headers, rows } = await this.inventory.exportLedger(req, filters);
    sendCsv(res, `stock-ledger-${filters.from ?? 'all'}-${filters.to ?? 'today'}.csv`, headers, rows);
  }

  @Get('ledger')
  @RequirePermissions('inventory.read')
  async stockLedger(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) filters: z.infer<typeof ledgerQuerySchema>,
  ) {
    const { total, items } = await this.inventory.stockLedger(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      ...filters,
    });
    return {
      items,
      pageInfo: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
        hasNextPage: pagination.page * pagination.pageSize < total,
        hasPreviousPage: pagination.page > 1,
      },
    };
  }

  // ── Adjustments ────────────────────────────────────────────────────────────

  @Post('adjustments')
  @RequirePermissions('inventory.adjust')
  adjustStock(
    @Body(new ZodValidationPipe(adjustmentCreateSchema)) dto: z.infer<typeof adjustmentCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.adjustStock(req, dto);
  }

  // ── Transfers ──────────────────────────────────────────────────────────────

  @Post('transfers')
  @RequirePermissions('inventory.transfer')
  createTransfer(
    @Body(new ZodValidationPipe(transferCreateSchema)) dto: z.infer<typeof transferCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.createTransfer(req, dto);
  }

  @Post('transfers/:transferId/receive')
  @RequirePermissions('inventory.transfer')
  receiveTransfer(
    @Param('transferId') transferId: string,
    @Body(new ZodValidationPipe(transferReceiveSchema)) dto: z.infer<typeof transferReceiveSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.receiveTransfer(req, transferId, dto.lines);
  }

  @Post('transfers/:transferId/cancel')
  @RequirePermissions('inventory.transfer')
  cancelTransfer(
    @Param('transferId') transferId: string,
    @Body(new ZodValidationPipe(transferCancelSchema)) dto: z.infer<typeof transferCancelSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.cancelTransfer(req, transferId, dto.reason);
  }

  // ── Counts ─────────────────────────────────────────────────────────────────

  @Post('counts')
  @RequirePermissions('inventory.count')
  createCount(
    @Body(new ZodValidationPipe(countCreateSchema)) dto: z.infer<typeof countCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.createCount(req, dto);
  }

  @Post('counts/:countId/post')
  @RequirePermissions('inventory.count')
  postCount(@Param('countId') countId: string, @Req() req: TenantRequest) {
    return this.inventory.postCount(req, countId);
  }

  @Post('counts/:countId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('inventory.count')
  cancelCount(
    @Param('countId') countId: string,
    @Body(new ZodValidationPipe(countCancelSchema)) dto: z.infer<typeof countCancelSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.cancelCount(req, countId, dto.reason);
  }

  // ── Recalls ────────────────────────────────────────────────────────────────

  @Post('recalls')
  @RequirePermissions('inventory.recall')
  createRecall(
    @Body(new ZodValidationPipe(recallCreateSchema)) dto: z.infer<typeof recallCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.createRecall(req, dto);
  }

  @Post('recalls/:recallId/resolve')
  @RequirePermissions('inventory.recall')
  resolveRecall(
    @Param('recallId') recallId: string,
    @Body(new ZodValidationPipe(recallResolveSchema)) dto: z.infer<typeof recallResolveSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.inventory.resolveRecall(req, recallId, dto.resolutionNotes);
  }

  // ── Reconciliation ─────────────────────────────────────────────────────────

  @Get('reconcile')
  @RequirePermissions('inventory.read')
  reconcile(@Req() req: TenantRequest, @Query(new ZodValidationPipe(stockSummaryQuerySchema)) query: z.infer<typeof stockSummaryQuerySchema>) {
    return this.inventory.reconcile(req, query.warehouseId);
  }
}

function listPageInfo(
  pagination: { page: number; pageSize: number },
  total: number,
) {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalItems: total,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    hasNextPage: pagination.page * pagination.pageSize < total,
    hasPreviousPage: pagination.page > 1,
  };
}
