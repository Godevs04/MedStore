import { Injectable } from '@nestjs/common';
import type { MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { batchDateIssues, priceLadderIssues } from '@medicore/validation';
import { AppException, Conflict, NotFound, ValidationFailed } from '../common/app-exception.js';
import { dateRangeFilter } from '../common/query.js';
import type { TenantPrisma } from './tenant-prisma.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { amountPaise, major } from '../common/money.js';

export interface AllocationLine {
  batchId: string;
  quantity: number;
  expiryDate: Date;
  batchNumber: string;
}

/**
 * Batch-level inventory engine (spec §8, §26.D):
 *  - append-only movement ledger is the source of truth;
 *  - balances are maintained in the same transaction under row lock;
 *  - FEFO allocation among eligible batches (SALEABLE, not expired — Drugs
 *    Rules 65(17) expired-stock blocking);
 *  - overselling is impossible (balance checked under lock);
 *  - posted movements are never rewritten — corrections are compensating.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounting: AccountingService,
  ) {}

  /**
   * Books a stock value change at batch carrying cost (spec §17 inventory ↔ GL):
   * positive = Dr Inventory / Cr counter account; negative = Dr counter / Cr Inventory.
   */
  private async postStockValue(
    tx: TenantPrisma,
    request: { principal: { userId: string } },
    organizationId: string,
    valuePaise: bigint,
    params: { inKey: string; outKey: string; memo: string; sourceType: string; sourceId?: string },
  ): Promise<void> {
    if (valuePaise === 0n) return;
    const abs = valuePaise > 0n ? valuePaise : -valuePaise;
    await this.accounting.postJournalEntry(
      request,
      organizationId,
      {
        date: new Date(),
        memo: params.memo,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        lines:
          valuePaise > 0n
            ? [{ systemKey: 'INVENTORY', debit: major(abs) }, { systemKey: params.inKey, credit: major(abs) }]
            : [{ systemKey: params.outKey, debit: major(abs) }, { systemKey: 'INVENTORY', credit: major(abs) }],
      },
      tx,
    );
  }

  /**
   * Locks and updates a (batch, warehouse) balance inside the caller's
   * transaction. Uses SELECT ... FOR UPDATE to serialize concurrent
   * deductions (spec §31 concurrency tests rely on this).
   */
  private async applyBalanceDelta(
    tx: TenantPrisma,
    params: {
      organizationId: string;
      batchId: string;
      warehouseId: string;
      delta: number;
      actorUserId: string;
      movementType: MovementType;
      reason?: string;
      sourceDocument?: string;
      sourceDocumentId?: string;
    },
  ): Promise<void> {
    const { organizationId, batchId, warehouseId, delta, actorUserId } = params;
    if (!Number.isFinite(delta) || delta === 0) {
      throw new AppException('VALIDATION_ERROR', 'Movement quantity must be non-zero', 400);
    }

    // Row lock: serialize concurrent balance updates for this batch+warehouse.
    await tx.$queryRaw`SELECT id FROM "InventoryBalance" WHERE "batchId" = ${batchId} AND "warehouseId" = ${warehouseId} FOR UPDATE`;

    const existing = await tx.inventoryBalance.findUnique({
      where: { batchId_warehouseId: { batchId, warehouseId } },
    });
    const current = existing ? Number(existing.quantity) : 0;
    const next = current + delta;

    if (delta < 0 && next < 0) {
      throw new AppException(
        'INSUFFICIENT_STOCK',
        `Insufficient stock: available ${current}, attempted ${Math.abs(delta)}`,
        422,
      );
    }

    await tx.inventoryBalance.upsert({
      where: { batchId_warehouseId: { batchId, warehouseId } },
      create: {
        organizationId,
        batchId,
        warehouseId,
        quantity: next.toFixed(3),
      },
      update: { quantity: next.toFixed(3) },
    });

    await tx.inventoryMovement.create({
      data: {
        organizationId,
        batchId,
        warehouseId,
        movementType: params.movementType,
        quantity: delta.toFixed(3),
        reason: params.reason,
        sourceDocument: params.sourceDocument,
        sourceDocumentId: params.sourceDocumentId,
        actorUserId,
      },
    });
  }

  /**
   * Public stock-delta primitive for other modules (purchasing receipts,
   * sales postings, returns) to use INSIDE their own transactions.
   */
  async applyStockDelta(
    tx: TenantPrisma,
    params: {
      organizationId: string;
      batchId: string;
      warehouseId: string;
      delta: number;
      actorUserId: string;
      movementType: MovementType;
      reason?: string;
      sourceDocument?: string;
      sourceDocumentId?: string;
    },
  ): Promise<void> {
    return this.applyBalanceDelta(tx, params);
  }

  /** Upserts a batch inside a caller-owned transaction (GRN path). */
  async upsertBatchInTx(
    tx: TenantPrisma,
    params: {
      organizationId: string;
      productId: string;
      warehouseId: string;
      batchNumber: string;
      expiryDate: Date;
      purchaseRate: string;
      mrp: string;
      supplierId?: string | null;
      sourceDocument?: string;
      actorUserId: string;
    },
  ) {
    const existing = await tx.inventoryBatch.findUnique({
      where: {
        organizationId_productId_warehouseId_batchNumber_expiryDate: {
          organizationId: params.organizationId,
          productId: params.productId,
          warehouseId: params.warehouseId,
          batchNumber: params.batchNumber,
          expiryDate: params.expiryDate,
        },
      },
    });
    if (existing) {
      await tx.inventoryBatch.update({
        where: { id: existing.id },
        data: { purchaseRate: params.purchaseRate, mrp: params.mrp },
      });
      return existing;
    }
    return tx.inventoryBatch.create({
      data: {
        organizationId: params.organizationId,
        productId: params.productId,
        warehouseId: params.warehouseId,
        batchNumber: params.batchNumber,
        expiryDate: params.expiryDate,
        purchaseRate: params.purchaseRate,
        mrp: params.mrp,
        supplierId: params.supplierId ?? null,
        sourceDocument: params.sourceDocument ?? 'GOODS_RECEIPT',
        createdByUserId: params.actorUserId,
      },
    });
  }

  // ── Batch creation (opening stock) ─────────────────────────────────────────

  async createBatch(
    request: TenantRequest,
    data: {
      productId: string;
      warehouseId: string;
      batchNumber: string;
      expiryDate: string;
      manufacturingDate?: string | null;
      quantity: string;
      freeQuantity?: string;
      purchaseRate: string;
      mrp: string;
      supplierId?: string | null;
      sourceDocument?: string;
    },
  ) {
    const orgId = request.tenantContext.organizationId;
    const product = await this.prisma.product.findFirst({
      where: { id: data.productId, organizationId: orgId },
    });
    if (!product) throw NotFound('Product not found');
    await this.assertWarehouse(orgId, data.warehouseId);

    const expiry = new Date(`${data.expiryDate}T00:00:00Z`);
    const totalQty = Number(data.quantity) + Number(data.freeQuantity ?? '0');
    if (totalQty <= 0) throw new AppException('VALIDATION_ERROR', 'Quantity must be positive', 400);
    const ruleIssues = [
      ...batchDateIssues({ expiryDate: data.expiryDate, manufacturingDate: data.manufacturingDate }),
      ...priceLadderIssues({ mrp: data.mrp, purchasePrice: data.purchaseRate }).map((i) =>
        i.field === 'purchasePrice' ? { ...i, field: 'purchaseRate' } : i,
      ),
    ];
    if (ruleIssues.length > 0) throw ValidationFailed(ruleIssues);

    // Merge into existing batch when (product, batchNumber, expiry) matches.
    const existing = await this.prisma.inventoryBatch.findUnique({
      where: {
        organizationId_productId_warehouseId_batchNumber_expiryDate: {
          organizationId: orgId,
          productId: data.productId,
          warehouseId: data.warehouseId,
          batchNumber: data.batchNumber,
          expiryDate: expiry,
        },
      },
    });

    return this.prisma.$transaction(async (tx) => {
      let batchId: string;
      if (existing) {
        batchId = existing.id;
        // Same lot received again: update cost basis info, keep status.
        await tx.inventoryBatch.update({
          where: { id: batchId },
          data: { purchaseRate: data.purchaseRate, mrp: data.mrp },
        });
      } else {
        const batch = await tx.inventoryBatch.create({
          data: {
            organizationId: orgId,
            productId: data.productId,
            warehouseId: data.warehouseId,
            batchNumber: data.batchNumber,
            expiryDate: expiry,
            manufacturingDate: data.manufacturingDate ? new Date(`${data.manufacturingDate}T00:00:00Z`) : null,
            supplierId: data.supplierId ?? null,
            purchaseRate: data.purchaseRate,
            mrp: data.mrp,
            sourceDocument: data.sourceDocument ?? 'OPENING_STOCK',
            createdByUserId: request.principal.userId,
          },
        });
        batchId = batch.id;
      }

      await this.applyBalanceDelta(tx, {
        organizationId: orgId,
        batchId,
        warehouseId: data.warehouseId,
        delta: totalQty,
        actorUserId: request.principal.userId,
        movementType: 'OPENING_STOCK',
        reason: data.sourceDocument ?? 'Opening stock entry',
        sourceDocument: data.sourceDocument,
      });
      await this.postStockValue(tx, request, orgId, amountPaise(data.purchaseRate, totalQty.toFixed(3)), {
        inKey: 'OPENING_BALANCE',
        outKey: 'OPENING_BALANCE',
        memo: `Opening stock ${product.name} batch ${data.batchNumber}`,
        sourceType: 'OPENING_STOCK',
        sourceId: batchId,
      });

      const batch = await tx.inventoryBatch.findUniqueOrThrow({
        where: { id: batchId },
        include: { balances: { where: { warehouseId: data.warehouseId } } },
      });
      return batch;
    });
  }

  /** Verifies warehouse belongs to the organization. */
  async assertWarehouse(organizationId: string, warehouseId: string): Promise<void> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId },
    });
    if (!warehouse) throw NotFound('Warehouse not found');
  }

  // ── FEFO allocation ────────────────────────────────────────────────────────

  /**
   * Allocates quantity across eligible batches, FEFO first (earliest expiry).
   * Eligible = SALEABLE status and expiry not passed (expired stock is
   * blocked from sale per Drugs Rules 65(17)).
   */
  async allocateFEFO(
    request: TenantRequest,
    params: { productId: string; warehouseId: string; quantity: number; explicitBatchId?: string | null },
  ): Promise<AllocationLine[]> {
    const orgId = request.tenantContext.organizationId;
    await this.assertWarehouse(orgId, params.warehouseId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const eligible = await this.prisma.inventoryBatch.findMany({
      where: {
        organizationId: orgId,
        productId: params.productId,
        warehouseId: params.warehouseId,
        status: 'SALEABLE',
        expiryDate: { gte: today },
      },
      include: { balances: { where: { warehouseId: params.warehouseId } } },
      orderBy: { expiryDate: 'asc' },
    });

    const availableById = new Map<string, number>();
    for (const batch of eligible) {
      const balance = batch.balances[0];
      availableById.set(batch.id, balance ? Number(balance.quantity) : 0);
    }

    // Explicit batch override: authorized user picks a specific batch (audited).
    if (params.explicitBatchId) {
      const explicit = eligible.find((b) => b.id === params.explicitBatchId);
      if (!explicit) {
        throw new AppException(
          'BATCH_INELIGIBLE',
          'Selected batch is not eligible for sale (wrong status or expired)',
          422,
        );
      }
      const available = availableById.get(explicit.id) ?? 0;
      if (available < params.quantity) {
        throw new AppException(
          'OVERSELL_BLOCKED',
          `Requested ${params.quantity} exceeds available ${available} in the selected batch`,
          422,
        );
      }
      await this.audit.record({
        event: 'INVENTORY_LEDGER_OVERRIDE',
        organizationId: orgId,
        actorUserId: request.principal.userId,
        entityType: 'InventoryBatch',
        entityId: explicit.id,
        details: { quantity: params.quantity, batchNumber: explicit.batchNumber },
      });
      return [
        {
          batchId: explicit.id,
          quantity: params.quantity,
          expiryDate: explicit.expiryDate,
          batchNumber: explicit.batchNumber,
        },
      ];
    }

    // FEFO: earliest expiry first, skipping ineligible/empty batches.
    const allocations: AllocationLine[] = [];
    let remaining = params.quantity;
    for (const batch of eligible) {
      if (remaining <= 0) break;
      const available = availableById.get(batch.id) ?? 0;
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      allocations.push({
        batchId: batch.id,
        quantity: take,
        expiryDate: batch.expiryDate,
        batchNumber: batch.batchNumber,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new AppException(
        'INSUFFICIENT_STOCK',
        `Cannot allocate ${params.quantity}: short by ${remaining} after FEFO across eligible batches`,
        422,
      );
    }
    return allocations;
  }

  /** Commits stock OUT movements for an allocation (sale path; Phase 5 uses this). */
  async commitAllocation(
    request: TenantRequest,
    allocations: AllocationLine[],
    params: { warehouseId: string; movementType: MovementType; sourceDocument: string; sourceDocumentId?: string; reason?: string },
  ): Promise<void> {
    const orgId = request.tenantContext.organizationId;
    await this.prisma.$transaction(async (tx) => {
      for (const line of allocations) {
        await this.applyBalanceDelta(tx, {
          organizationId: orgId,
          batchId: line.batchId,
          warehouseId: params.warehouseId,
          delta: -line.quantity,
          actorUserId: request.principal.userId,
          movementType: params.movementType,
          reason: params.reason,
          sourceDocument: params.sourceDocument,
          sourceDocumentId: params.sourceDocumentId,
        });
      }
    });
  }

  // ── Lists for operations UI ────────────────────────────────────────────────

  listTransfers(request: TenantRequest, params: { page: number; pageSize: number; status?: string; warehouseId?: string }) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.StockTransferWhereInput = { organizationId: orgId };
    if (params.status) where.status = params.status as Prisma.StockTransferWhereInput['status'];
    if (params.warehouseId) where.OR = [{ sourceWarehouseId: params.warehouseId }, { destinationWarehouseId: params.warehouseId }];
    return this.prisma.$transaction([
      this.prisma.stockTransfer.count({ where }),
      this.prisma.stockTransfer.findMany({
        where,
        include: {
          lines: { include: { batch: { include: { product: { select: { name: true, sku: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  listCounts(request: TenantRequest, params: { page: number; pageSize: number; status?: string; warehouseId?: string }) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.StockCountWhereInput = { organizationId: orgId };
    if (params.status) where.status = params.status as Prisma.StockCountWhereInput['status'];
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    return this.prisma.$transaction([
      this.prisma.stockCount.count({ where }),
      this.prisma.stockCount.findMany({
        where,
        include: {
          lines: { include: { batch: { include: { product: { select: { name: true, sku: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  async listAdjustments(
    request: TenantRequest,
    params: { page: number; pageSize: number; reason?: string; direction?: string; warehouseId?: string; from?: string; to?: string },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.StockAdjustmentWhereInput = { organizationId: orgId };
    if (params.reason) where.reason = params.reason;
    if (params.direction) where.direction = params.direction;
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    const createdAt = dateRangeFilter(params.from, params.to);
    if (createdAt) where.createdAt = createdAt;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.stockAdjustment.count({ where }),
      this.prisma.stockAdjustment.findMany({
        where,
        include: { batch: { include: { product: { select: { name: true, sku: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    const names = await this.userNames(items.map((i) => i.actorUserId));
    return [total, items.map((i) => ({ ...i, actorName: names.get(i.actorUserId) ?? null }))] as const;
  }

  listRecalls(request: TenantRequest, params: { page: number; pageSize: number; status?: string }) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.RecallRecordWhereInput = { organizationId: orgId };
    if (params.status) where.status = params.status;
    return this.prisma.$transaction([
      this.prisma.recallRecord.count({ where }),
      this.prisma.recallRecord.findMany({
        where,
        include: { batch: { include: { product: { select: { name: true, sku: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  // ── Availability & views ───────────────────────────────────────────────────

  async listBatches(
    request: TenantRequest,
    params: {
      page: number;
      pageSize: number;
      batchId?: string;
      productId?: string;
      warehouseId?: string;
      status?: string;
      search?: string;
      expiryAfter?: string;
      expiryBefore?: string;
    },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.InventoryBatchWhereInput = { organizationId: orgId };
    if (params.batchId) where.id = params.batchId;
    if (params.productId) where.productId = params.productId;
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.status) where.status = params.status as Prisma.EnumBatchStatusFilter['equals'];
    if (params.search) {
      where.OR = [
        { batchNumber: { contains: params.search, mode: 'insensitive' } },
        { product: { name: { contains: params.search, mode: 'insensitive' } } },
        { product: { sku: { contains: params.search, mode: 'insensitive' } } },
      ];
    }
    if (params.expiryAfter || params.expiryBefore) {
      where.expiryDate = {
        ...(params.expiryAfter ? { gte: new Date(`${params.expiryAfter}T00:00:00Z`) } : {}),
        ...(params.expiryBefore ? { lte: new Date(`${params.expiryBefore}T00:00:00Z`) } : {}),
      };
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.inventoryBatch.count({ where }),
      this.prisma.inventoryBatch.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, genericName: true, rackLocation: true, requiresRefrigeration: true } },
          balances: { where: params.warehouseId ? { warehouseId: params.warehouseId } : undefined },
        },
        orderBy: { expiryDate: 'asc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    return { total, items };
  }

  /** Expiry buckets: EXPIRED / 30 / 60 / 90 / custom / OK (spec §8). */
  async expiryDashboard(request: TenantRequest, params: { warehouseId?: string; customDays?: number }) {
    const orgId = request.tenantContext.organizationId;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const customDays = params.customDays ?? 90;

    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        organizationId: orgId,
        ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      },
      include: {
        product: { select: { name: true, sku: true } },
        balances: true,
      },
      orderBy: { expiryDate: 'asc' },
    });

    const buckets = { EXPIRED: 0, DAYS_30: 0, DAYS_60: 0, DAYS_90: 0, CUSTOM: 0, OK: 0 } as Record<string, number>;
    const costByBucket: Record<string, bigint> = {};
    const mrpByBucket: Record<string, bigint> = {};
    const rows = batches
      .map((b) => {
        const qty = b.balances.reduce((sum, bal) => sum + Number(bal.quantity), 0);
        if (qty <= 0) return null;
        const days = Math.ceil((b.expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
        let bucket: string;
        if (days < 0) bucket = 'EXPIRED';
        else if (days <= 30) bucket = 'DAYS_30';
        else if (days <= 60) bucket = 'DAYS_60';
        else if (days <= 90) bucket = 'DAYS_90';
        else if (days <= customDays) bucket = 'CUSTOM';
        else bucket = 'OK';
        buckets[bucket] = (buckets[bucket] ?? 0) + 1;
        const cost = amountPaise(b.purchaseRate, qty.toFixed(3));
        const atMrp = amountPaise(b.mrp, qty.toFixed(3));
        costByBucket[bucket] = (costByBucket[bucket] ?? 0n) + cost;
        mrpByBucket[bucket] = (mrpByBucket[bucket] ?? 0n) + atMrp;
        return {
          batchId: b.id,
          productId: b.productId,
          productName: b.product.name,
          sku: b.product.sku,
          batchNumber: b.batchNumber,
          warehouseId: b.warehouseId,
          expiryDate: b.expiryDate,
          daysToExpiry: days,
          bucket,
          quantity: qty,
          status: b.status,
          purchaseRate: b.purchaseRate,
          mrp: b.mrp,
          valueAtCost: major(cost),
          valueAtMrp: major(atMrp),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const bucketValues = Object.fromEntries(
      Object.keys(buckets).map((k) => [k, { cost: major(costByBucket[k] ?? 0n), mrp: major(mrpByBucket[k] ?? 0n) }]),
    );
    const atRisk = ['EXPIRED', 'DAYS_30', 'DAYS_60', 'DAYS_90'].reduce(
      (acc, k) => ({ cost: acc.cost + (costByBucket[k] ?? 0n), mrp: acc.mrp + (mrpByBucket[k] ?? 0n) }),
      { cost: 0n, mrp: 0n },
    );
    return { buckets, bucketValues, valueAtRisk: { cost: major(atRisk.cost), mrp: major(atRisk.mrp) }, customDays, rows };
  }

  /**
   * Writes off expired or blocked stock (destruction under Drugs Rules 65(17)):
   * every positive balance becomes an EXPIRY_WRITEOFF adjustment and the
   * batch is blocked from sale. Saleable batches more than 30 days from
   * expiry are refused.
   */
  async bulkExpiryWriteoff(request: TenantRequest, data: { batchIds: string[]; warehouseId?: string; notes: string }) {
    const orgId = request.tenantContext.organizationId;
    if (data.warehouseId) await this.assertWarehouse(orgId, data.warehouseId);
    const batches = await this.prisma.inventoryBatch.findMany({
      where: { id: { in: data.batchIds }, organizationId: orgId },
      include: { balances: { where: { quantity: { gt: 0 }, ...(data.warehouseId ? { warehouseId: data.warehouseId } : {}) } } },
    });
    if (batches.length !== data.batchIds.length) throw NotFound('One or more batches were not found');
    const cutoff = startOfTodayUtc();
    cutoff.setUTCDate(cutoff.getUTCDate() + 30);
    const ineligible = batches.filter((b) => b.status === 'SALEABLE' && b.expiryDate > cutoff);
    if (ineligible.length > 0) {
      throw ValidationFailed(
        ineligible.map((b) => ({
          field: 'batchIds',
          message: `Batch ${b.batchNumber} is saleable and more than 30 days from expiry; block or return it instead`,
        })),
      );
    }
    const empty = batches.filter((b) => b.balances.length === 0);
    if (empty.length === batches.length) {
      throw new AppException('INSUFFICIENT_STOCK', 'The selected batches have no stock to write off', 422);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let lines = 0;
      let quantity = 0;
      let valuePaise = 0n;
      for (const batch of batches) {
        for (const bal of batch.balances) {
          const qty = Number(bal.quantity);
          await this.writeAdjustment(tx, request, batch, {
            warehouseId: bal.warehouseId,
            direction: 'OUT',
            quantity: qty,
            reason: 'EXPIRY_WRITEOFF',
            notes: data.notes,
          });
          lines += 1;
          quantity += qty;
          valuePaise += amountPaise(batch.purchaseRate, qty.toFixed(3));
        }
        if (batch.status === 'SALEABLE' || batch.status === 'QUARANTINED') {
          await tx.inventoryBatch.update({ where: { id: batch.id }, data: { status: 'EXPIRED_BLOCKED' } });
        }
      }
      return { lines, quantity, value: major(valuePaise) };
    });

    await this.audit.record({
      event: 'EXPIRY_WRITTEN_OFF',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'InventoryBatch',
      details: { batches: batches.map((b) => b.batchNumber), ...result, notes: data.notes },
    });
    return { batches: batches.length, skipped: empty.map((b) => b.batchNumber), ...result };
  }

  /** Stock position for KPI tiles: product counts, batch status split and value at cost/MRP. */
  async stockSummary(request: TenantRequest, params: { warehouseId?: string }) {
    const orgId = request.tenantContext.organizationId;
    const today = startOfTodayUtc();
    const in30 = new Date(today.getTime() + 30 * 86_400_000);
    const [products, balances] = await Promise.all([
      this.prisma.product.findMany({ where: { organizationId: orgId }, select: { id: true, status: true, reorderLevel: true } }),
      this.prisma.inventoryBalance.findMany({
        where: { organizationId: orgId, quantity: { gt: 0 }, ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}) },
        select: { quantity: true, batch: { select: { id: true, productId: true, status: true, expiryDate: true, purchaseRate: true, mrp: true } } },
      }),
    ]);
    const saleableByProduct = new Map<string, number>();
    const statusAgg = new Map<string, { batches: Set<string>; quantity: number; cost: bigint }>();
    let cost = 0n;
    let atMrp = 0n;
    const expired = { batches: new Set<string>(), cost: 0n };
    const expiring = { batches: new Set<string>(), cost: 0n };
    for (const bal of balances) {
      const b = bal.batch;
      const q = bal.quantity.toFixed(3);
      const c = amountPaise(b.purchaseRate, q);
      cost += c;
      atMrp += amountPaise(b.mrp, q);
      const agg = statusAgg.get(b.status) ?? { batches: new Set<string>(), quantity: 0, cost: 0n };
      agg.batches.add(b.id);
      agg.quantity += Number(bal.quantity);
      agg.cost += c;
      statusAgg.set(b.status, agg);
      if (b.expiryDate < today) {
        expired.batches.add(b.id);
        expired.cost += c;
      } else if (b.expiryDate <= in30) {
        expiring.batches.add(b.id);
        expiring.cost += c;
      }
      if (b.status === 'SALEABLE' && b.expiryDate >= today) {
        saleableByProduct.set(b.productId, (saleableByProduct.get(b.productId) ?? 0) + Number(bal.quantity));
      }
    }
    const active = products.filter((p) => p.status === 'ACTIVE');
    return {
      products: {
        total: products.length,
        active: active.length,
        inactive: products.length - active.length,
        inStock: active.filter((p) => (saleableByProduct.get(p.id) ?? 0) > 0).length,
        outOfStock: active.filter((p) => (saleableByProduct.get(p.id) ?? 0) <= 0).length,
        belowReorder: active.filter((p) => (p.reorderLevel ?? 0) > 0 && (saleableByProduct.get(p.id) ?? 0) <= (p.reorderLevel ?? 0)).length,
      },
      value: { cost: major(cost), mrp: major(atMrp), potentialMargin: major(atMrp - cost) },
      batches: Object.fromEntries(
        [...statusAgg.entries()].map(([status, a]) => [status, { batches: a.batches.size, quantity: Number(a.quantity.toFixed(3)), cost: major(a.cost) }]),
      ),
      expired: { batches: expired.batches.size, cost: major(expired.cost) },
      expiring30: { batches: expiring.batches.size, cost: major(expiring.cost) },
    };
  }

  async stockLedger(
    request: TenantRequest,
    params: {
      page: number;
      pageSize: number;
      batchId?: string;
      warehouseId?: string;
      productId?: string;
      movementType?: string;
      direction?: 'IN' | 'OUT';
      actorUserId?: string;
      search?: string;
      from?: string;
      to?: string;
    },
  ) {
    const where = this.ledgerWhere(request.tenantContext.organizationId, params);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          batch: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    const names = await this.userNames(items.map((i) => i.actorUserId));
    return { total, items: items.map((i) => ({ ...i, actorName: names.get(i.actorUserId) ?? null })) };
  }

  async exportLedger(request: TenantRequest, params: Parameters<InventoryService['ledgerWhere']>[1]) {
    const orgId = request.tenantContext.organizationId;
    const items = await this.prisma.inventoryMovement.findMany({
      where: this.ledgerWhere(orgId, params),
      include: { batch: { include: { product: { select: { name: true, sku: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    const [names, warehouses] = await Promise.all([
      this.userNames(items.map((i) => i.actorUserId)),
      this.prisma.warehouse.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    ]);
    const wh = new Map(warehouses.map((w) => [w.id, w.name]));
    await this.audit.record({
      event: 'EXPORT_GENERATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'InventoryMovement',
      details: { report: 'stock-ledger', rows: items.length, ...params },
    });
    return {
      headers: ['Date', 'Product', 'SKU', 'Batch', 'Expiry', 'Warehouse', 'Movement', 'Quantity', 'Reason', 'Document', 'Document ID', 'User'],
      rows: items.map((i) => [
        i.createdAt.toISOString(),
        i.batch.product.name,
        i.batch.product.sku,
        i.batch.batchNumber,
        i.batch.expiryDate,
        wh.get(i.warehouseId) ?? i.warehouseId,
        i.movementType,
        i.quantity.toFixed(3),
        i.reason,
        i.sourceDocument,
        i.sourceDocumentId,
        names.get(i.actorUserId) ?? i.actorUserId,
      ]),
    };
  }

  private ledgerWhere(
    orgId: string,
    params: { batchId?: string; warehouseId?: string; productId?: string; movementType?: string; direction?: 'IN' | 'OUT'; actorUserId?: string; search?: string; from?: string; to?: string },
  ): Prisma.InventoryMovementWhereInput {
    const where: Prisma.InventoryMovementWhereInput = { organizationId: orgId };
    if (params.batchId) where.batchId = params.batchId;
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.actorUserId) where.actorUserId = params.actorUserId;
    const batch: Prisma.InventoryBatchWhereInput = {};
    if (params.productId) batch.productId = params.productId;
    if (params.search) {
      batch.OR = [
        { batchNumber: { contains: params.search, mode: 'insensitive' } },
        { product: { name: { contains: params.search, mode: 'insensitive' } } },
        { product: { sku: { contains: params.search, mode: 'insensitive' } } },
      ];
    }
    if (Object.keys(batch).length > 0) where.batch = batch;
    if (params.movementType) where.movementType = params.movementType as Prisma.InventoryMovementWhereInput['movementType'];
    if (params.direction) where.quantity = params.direction === 'IN' ? { gt: 0 } : { lt: 0 };
    const createdAt = dateRangeFilter(params.from, params.to);
    if (createdAt) where.createdAt = createdAt;
    return where;
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  // ── Adjustments ────────────────────────────────────────────────────────────

  async adjustStock(
    request: TenantRequest,
    data: { batchId: string; warehouseId: string; direction: 'IN' | 'OUT'; quantity: string; reason: string; notes?: string | null },
  ) {
    const orgId = request.tenantContext.organizationId;
    const batch = await this.prisma.inventoryBatch.findFirst({
      where: { id: data.batchId, organizationId: orgId },
    });
    if (!batch) throw NotFound('Batch not found');
    await this.assertWarehouse(orgId, data.warehouseId);

    const qty = Number(data.quantity);
    if (qty <= 0) throw new AppException('VALIDATION_ERROR', 'Adjustment quantity must be positive', 400);

    const adjustment = await this.prisma.$transaction((tx) =>
      this.writeAdjustment(tx, request, { id: batch.id, batchNumber: batch.batchNumber, purchaseRate: batch.purchaseRate }, {
        warehouseId: data.warehouseId,
        direction: data.direction,
        quantity: qty,
        reason: data.reason,
        notes: data.notes ?? null,
      }),
    );

    await this.audit.record({
      event: 'STOCK_ADJUSTED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'StockAdjustment',
      entityId: adjustment.id,
      details: { batchId: batch.id, direction: data.direction, quantity: qty, reason: data.reason },
    });
    return adjustment;
  }

  /** Moves stock, books its value and records the adjustment, inside the caller's transaction. */
  private async writeAdjustment(
    tx: TenantPrisma,
    request: TenantRequest,
    batch: { id: string; batchNumber: string; purchaseRate: Prisma.Decimal },
    data: { warehouseId: string; direction: 'IN' | 'OUT'; quantity: number; reason: string; notes: string | null },
  ) {
    const orgId = request.tenantContext.organizationId;
    const qty = data.quantity;
    await this.applyBalanceDelta(tx, {
      organizationId: orgId,
      batchId: batch.id,
      warehouseId: data.warehouseId,
      delta: data.direction === 'IN' ? qty : -qty,
      actorUserId: request.principal.userId,
      movementType: data.direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
      reason: data.reason,
      sourceDocument: 'STOCK_ADJUSTMENT',
    });
    const value = amountPaise(batch.purchaseRate, qty.toFixed(3));
    await this.postStockValue(tx, request, orgId, data.direction === 'IN' ? value : -value, {
      inKey: 'INVENTORY_GAIN',
      outKey: 'INVENTORY_LOSS',
      memo: `Stock adjustment ${data.direction} ${qty} of batch ${batch.batchNumber} (${data.reason})`,
      sourceType: 'STOCK_ADJUSTMENT',
      sourceId: batch.id,
    });
    return tx.stockAdjustment.create({
      data: {
        organizationId: orgId,
        batchId: batch.id,
        warehouseId: data.warehouseId,
        direction: data.direction,
        quantity: qty.toFixed(3),
        reason: data.reason,
        notes: data.notes,
        movementId: 'linked-via-ledger',
        actorUserId: request.principal.userId,
      },
    });
  }

  /** Adjustment totals by reason and direction, valued at batch cost. */
  async adjustmentSummary(request: TenantRequest, params: { direction?: string; warehouseId?: string; from?: string; to?: string }) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.StockAdjustmentWhereInput = { organizationId: orgId };
    if (params.direction) where.direction = params.direction;
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    const createdAt = dateRangeFilter(params.from, params.to);
    if (createdAt) where.createdAt = createdAt;
    const rows = await this.prisma.stockAdjustment.findMany({
      where,
      select: { reason: true, direction: true, quantity: true, batch: { select: { purchaseRate: true } } },
    });
    const byReason = new Map<string, { reason: string; count: number; inQty: number; outQty: number; inValue: bigint; outValue: bigint }>();
    let inValue = 0n;
    let outValue = 0n;
    for (const r of rows) {
      const entry = byReason.get(r.reason) ?? { reason: r.reason, count: 0, inQty: 0, outQty: 0, inValue: 0n, outValue: 0n };
      const value = amountPaise(r.batch.purchaseRate, r.quantity.toFixed(3));
      entry.count += 1;
      if (r.direction === 'IN') {
        entry.inQty += Number(r.quantity);
        entry.inValue += value;
        inValue += value;
      } else {
        entry.outQty += Number(r.quantity);
        entry.outValue += value;
        outValue += value;
      }
      byReason.set(r.reason, entry);
    }
    return {
      count: rows.length,
      inValue: major(inValue),
      outValue: major(outValue),
      netValue: major(inValue - outValue),
      byReason: [...byReason.values()]
        .sort((a, b) => Number(b.outValue + b.inValue - (a.outValue + a.inValue)))
        .map((e) => ({ ...e, inValue: major(e.inValue), outValue: major(e.outValue) })),
    };
  }

  // ── Transfers ──────────────────────────────────────────────────────────────

  async getTransfer(request: TenantRequest, transferId: string) {
    const orgId = request.tenantContext.organizationId;
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id: transferId, organizationId: orgId },
      include: {
        lines: { include: { batch: { include: { product: { select: { id: true, name: true, sku: true } } } } } },
      },
    });
    if (!transfer) throw NotFound('Transfer not found');
    const [warehouses, creator, movements] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { id: { in: [transfer.sourceWarehouseId, transfer.destinationWarehouseId] } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findUnique({ where: { id: transfer.createdById }, select: { fullName: true } }),
      this.prisma.inventoryMovement.findMany({
        where: { organizationId: orgId, sourceDocument: 'STOCK_TRANSFER', sourceDocumentId: transfer.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, movementType: true, quantity: true, warehouseId: true, reason: true, createdAt: true, batchId: true },
      }),
    ]);
    const nameOf = (id: string) => warehouses.find((w) => w.id === id)?.name ?? null;
    return {
      ...transfer,
      sourceWarehouseName: nameOf(transfer.sourceWarehouseId),
      destinationWarehouseName: nameOf(transfer.destinationWarehouseId),
      createdByName: creator?.fullName ?? null,
      movements,
    };
  }

  async createTransfer(
    request: TenantRequest,
    data: {
      sourceWarehouseId: string;
      destinationWarehouseId: string;
      notes?: string | null;
      lines: Array<{ productId: string; batchId: string; quantity: string }>;
    },
  ) {
    const orgId = request.tenantContext.organizationId;
    if (data.sourceWarehouseId === data.destinationWarehouseId) {
      throw new AppException('VALIDATION_ERROR', 'Source and destination warehouses must differ', 400);
    }
    await this.assertWarehouse(orgId, data.sourceWarehouseId);
    await this.assertWarehouse(orgId, data.destinationWarehouseId);

    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId: orgId,
          sourceWarehouseId: data.sourceWarehouseId,
          destinationWarehouseId: data.destinationWarehouseId,
          notes: data.notes ?? null,
          status: 'DISPATCHED',
          dispatchedAt: new Date(),
          createdById: request.principal.userId,
        },
      });

      for (const line of data.lines) {
        const qty = Number(line.quantity);
        if (qty <= 0) throw new AppException('VALIDATION_ERROR', 'Transfer quantities must be positive', 400);
        const batch = await tx.inventoryBatch.findFirst({
          where: { id: line.batchId, organizationId: orgId, warehouseId: data.sourceWarehouseId },
        });
        if (!batch) {
          throw new AppException('BATCH_INELIGIBLE', 'Batch not found in source warehouse', 422);
        }
        if (batch.expiryDate < startOfTodayUtc()) {
          throw new AppException(
            'BATCH_INELIGIBLE',
            `Batch ${batch.batchNumber} has expired; expired stock must stay segregated for destruction (Drugs Rules 65(17))`,
            422,
          );
        }
        await tx.stockTransferLine.create({
          data: {
            transferId: transfer.id,
            productId: line.productId,
            batchId: line.batchId,
            quantity: qty.toFixed(3),
          },
        });
        // Dispatch deducts immediately; stock is tracked as in-transit by the
        // transfer document until receipt (spec §19 — no phantom duplication).
        await this.applyBalanceDelta(tx, {
          organizationId: orgId,
          batchId: line.batchId,
          warehouseId: data.sourceWarehouseId,
          delta: -qty,
          actorUserId: request.principal.userId,
          movementType: 'TRANSFER_OUT',
          reason: `Transfer ${transfer.id} dispatch`,
          sourceDocument: 'STOCK_TRANSFER',
          sourceDocumentId: transfer.id,
        });
      }
      return tx.stockTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
        include: { lines: true },
      });
    });
  }

  async receiveTransfer(
    request: TenantRequest,
    transferId: string,
    lines: Array<{ transferLineId: string; receivedQty: string }>,
  ) {
    const orgId = request.tenantContext.organizationId;
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id: transferId, organizationId: orgId },
      include: { lines: true },
    });
    if (!transfer) throw NotFound('Transfer not found');
    if (transfer.status !== 'DISPATCHED' && transfer.status !== 'PARTIALLY_RECEIVED') {
      throw Conflict('STATE_TRANSITION_INVALID', `Transfer cannot be received in status ${transfer.status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      let allReceived = true;
      for (const line of transfer.lines) {
        const receipt = lines.find((l) => l.transferLineId === line.id);
        const receivedQty = receipt ? Number(receipt.receivedQty) : 0;
        const totalReceived = Number(line.receivedQty) + receivedQty;
        // Over-receipt prevention (spec §19): cannot receive more than was
        // dispatched unless an authorized discrepancy workflow applies.
        if (totalReceived > Number(line.quantity)) {
          throw new AppException(
            'TRANSFER_QUANTITY_INVALID',
            `Line ${line.id}: received ${totalReceived} exceeds dispatched ${Number(line.quantity)}`,
            422,
          );
        }
        if (totalReceived < Number(line.quantity)) allReceived = false;

        if (receivedQty > 0) {
          // Find/create the same batch at the destination warehouse.
          const sourceBatch = await tx.inventoryBatch.findUniqueOrThrow({ where: { id: line.batchId } });
          const destBatch = await tx.inventoryBatch.upsert({
            where: {
              organizationId_productId_warehouseId_batchNumber_expiryDate: {
                organizationId: orgId,
                productId: sourceBatch.productId,
                warehouseId: transfer.destinationWarehouseId,
                batchNumber: sourceBatch.batchNumber,
                expiryDate: sourceBatch.expiryDate,
              },
            },
            create: {
              organizationId: orgId,
              productId: sourceBatch.productId,
              warehouseId: transfer.destinationWarehouseId,
              batchNumber: sourceBatch.batchNumber,
              expiryDate: sourceBatch.expiryDate,
              manufacturingDate: sourceBatch.manufacturingDate,
              supplierId: sourceBatch.supplierId,
              purchaseRate: sourceBatch.purchaseRate,
              mrp: sourceBatch.mrp,
              status: sourceBatch.status,
              sourceDocument: 'STOCK_TRANSFER',
              createdByUserId: request.principal.userId,
            },
            update: {},
          });
          await this.applyBalanceDelta(tx, {
            organizationId: orgId,
            batchId: destBatch.id,
            warehouseId: transfer.destinationWarehouseId,
            delta: receivedQty,
            actorUserId: request.principal.userId,
            movementType: 'TRANSFER_IN',
            reason: `Transfer ${transfer.id} receipt`,
            sourceDocument: 'STOCK_TRANSFER',
            sourceDocumentId: transfer.id,
          });
          await tx.stockTransferLine.update({
            where: { id: line.id },
            data: { receivedQty: totalReceived.toFixed(3) },
          });
        }
      }

      const nextStatus = allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: nextStatus, receivedAt: allReceived ? new Date() : null },
      });
      return tx.stockTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
        include: { lines: true },
      });
    });
  }

  async cancelTransfer(request: TenantRequest, transferId: string, reason: string) {
    const orgId = request.tenantContext.organizationId;
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id: transferId, organizationId: orgId },
      include: { lines: true },
    });
    if (!transfer) throw NotFound('Transfer not found');
    if (transfer.status === 'RECEIVED' || transfer.status === 'CANCELLED') {
      throw Conflict('STATE_TRANSITION_INVALID', `Transfer cannot be cancelled in status ${transfer.status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Return undelivered quantities to the source warehouse.
      for (const line of transfer.lines) {
        const undelivered = Number(line.quantity) - Number(line.receivedQty);
        if (undelivered > 0) {
          await this.applyBalanceDelta(tx, {
            organizationId: orgId,
            batchId: line.batchId,
            warehouseId: transfer.sourceWarehouseId,
            delta: undelivered,
            actorUserId: request.principal.userId,
            movementType: 'TRANSFER_IN',
            reason: `Transfer ${transfer.id} cancellation return: ${reason}`,
            sourceDocument: 'STOCK_TRANSFER',
            sourceDocumentId: transfer.id,
          });
        }
      }
      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: 'CANCELLED' },
      });
      return tx.stockTransfer.findUniqueOrThrow({ where: { id: transfer.id }, include: { lines: true } });
    });
  }

  // ── Stock counts ───────────────────────────────────────────────────────────

  async createCount(
    request: TenantRequest,
    data: { warehouseId: string; notes?: string | null; lines: Array<{ productId: string; batchId: string; countedQty: string }> },
  ) {
    const orgId = request.tenantContext.organizationId;
    await this.assertWarehouse(orgId, data.warehouseId);

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.create({
        data: {
          organizationId: orgId,
          warehouseId: data.warehouseId,
          notes: data.notes ?? null,
          status: 'COMPLETED',
          createdByUserId: request.principal.userId,
        },
      });
      for (const line of data.lines) {
        const balance = await tx.inventoryBalance.findUnique({
          where: { batchId_warehouseId: { batchId: line.batchId, warehouseId: data.warehouseId } },
        });
        const systemQty = balance ? Number(balance.quantity) : 0;
        const countedQty = Number(line.countedQty);
        await tx.stockCountLine.create({
          data: {
            countId: count.id,
            batchId: line.batchId,
            countedQty: countedQty.toFixed(3),
            systemQty: systemQty.toFixed(3),
            variance: (countedQty - systemQty).toFixed(3),
          },
        });
      }
      return tx.stockCount.findUniqueOrThrow({ where: { id: count.id }, include: { lines: true } });
    });
  }

  /** Posts a completed count: variances become compensating movements. */
  async postCount(request: TenantRequest, countId: string) {
    const orgId = request.tenantContext.organizationId;
    const count = await this.prisma.stockCount.findFirst({
      where: { id: countId, organizationId: orgId },
      include: { lines: true },
    });
    if (!count) throw NotFound('Count not found');
    if (count.status !== 'COMPLETED') {
      throw Conflict('STATE_TRANSITION_INVALID', `Count cannot be posted from status ${count.status}`);
    }

    await this.prisma.$transaction(async (tx) => {
      let valuePaise = 0n;
      for (const line of count.lines) {
        const variance = Number(line.variance);
        if (variance === 0) continue;
        const batch = await tx.inventoryBatch.findUniqueOrThrow({ where: { id: line.batchId }, select: { purchaseRate: true } });
        const v = amountPaise(batch.purchaseRate, Math.abs(variance).toFixed(3));
        valuePaise += variance > 0 ? v : -v;
        await this.applyBalanceDelta(tx, {
          organizationId: orgId,
          batchId: line.batchId,
          warehouseId: count.warehouseId,
          delta: variance,
          actorUserId: request.principal.userId,
          movementType: variance > 0 ? 'COUNT_VARIANCE_IN' : 'COUNT_VARIANCE_OUT',
          reason: `Stock count ${count.id}`,
          sourceDocument: 'STOCK_COUNT',
          sourceDocumentId: count.id,
        });
      }
      await this.postStockValue(tx, request, orgId, valuePaise, {
        inKey: 'INVENTORY_GAIN',
        outKey: 'INVENTORY_LOSS',
        memo: `Stock count variance ${count.id.slice(0, 8)}`,
        sourceType: 'STOCK_COUNT',
        sourceId: count.id,
      });
      await tx.stockCount.update({
        where: { id: count.id },
        data: { status: 'POSTED', postedAt: new Date() },
      });
    });

    await this.audit.record({
      event: 'STOCK_COUNT_POSTED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'StockCount',
      entityId: count.id,
      details: { lines: count.lines.length },
    });
    return this.prisma.stockCount.findUniqueOrThrow({ where: { id: count.id }, include: { lines: true } });
  }

  async cancelCount(request: TenantRequest, countId: string, reason: string) {
    const orgId = request.tenantContext.organizationId;
    const count = await this.prisma.stockCount.findFirst({ where: { id: countId, organizationId: orgId } });
    if (!count) throw NotFound('Count not found');
    if (count.status === 'POSTED' || count.status === 'CANCELLED') {
      throw Conflict('STATE_TRANSITION_INVALID', `Count cannot be cancelled in status ${count.status}`);
    }
    const updated = await this.prisma.stockCount.update({
      where: { id: count.id },
      data: { status: 'CANCELLED', notes: [count.notes, `Cancelled: ${reason}`].filter(Boolean).join(' · ') },
    });
    await this.audit.record({
      event: 'STOCK_COUNT_CANCELLED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'StockCount',
      entityId: count.id,
      details: { reason },
    });
    return updated;
  }

  /** Every batch in a warehouse with its system quantity, ordered by rack then product, for a full count. */
  async countSheet(request: TenantRequest, params: { warehouseId: string; search?: string; includeZero?: boolean }) {
    const orgId = request.tenantContext.organizationId;
    await this.assertWarehouse(orgId, params.warehouseId);
    const where: Prisma.InventoryBatchWhereInput = { organizationId: orgId, warehouseId: params.warehouseId };
    if (params.search) {
      where.OR = [
        { batchNumber: { contains: params.search, mode: 'insensitive' } },
        { product: { name: { contains: params.search, mode: 'insensitive' } } },
        { product: { sku: { contains: params.search, mode: 'insensitive' } } },
      ];
    }
    if (!params.includeZero) where.balances = { some: { warehouseId: params.warehouseId, quantity: { gt: 0 } } };
    const batches = await this.prisma.inventoryBatch.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, rackLocation: true } },
        balances: { where: { warehouseId: params.warehouseId } },
      },
      take: 2000,
    });
    const items = batches
      .map((b) => ({
        batchId: b.id,
        productId: b.productId,
        productName: b.product.name,
        sku: b.product.sku,
        rackLocation: b.product.rackLocation,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate,
        status: b.status,
        purchaseRate: b.purchaseRate,
        systemQty: Number(b.balances[0]?.quantity ?? 0),
      }))
      .sort((a, b) => (a.rackLocation ?? '\uffff').localeCompare(b.rackLocation ?? '\uffff') || a.productName.localeCompare(b.productName));
    return { warehouseId: params.warehouseId, items, truncated: batches.length === 2000 };
  }

  // ── Recalls & batch status ─────────────────────────────────────────────────

  async createRecall(request: TenantRequest, data: { batchId: string; reason: string; notes?: string | null }) {
    const orgId = request.tenantContext.organizationId;
    const batch = await this.prisma.inventoryBatch.findFirst({
      where: { id: data.batchId, organizationId: orgId },
    });
    if (!batch) throw NotFound('Batch not found');

    const recall = await this.prisma.$transaction(async (tx) => {
      const record = await tx.recallRecord.create({
        data: {
          organizationId: orgId,
          batchId: batch.id,
          reason: data.reason,
          notes: data.notes ?? null,
          createdById: request.principal.userId,
        },
      });
      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: { status: 'RECALLED' },
      });
      return record;
    });

    await this.audit.record({
      event: 'RECALL_CREATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'RecallRecord',
      entityId: recall.id,
      details: { batchId: batch.id, reason: data.reason },
    });
    return recall;
  }

  async resolveRecall(request: TenantRequest, recallId: string, resolutionNotes: string) {
    const orgId = request.tenantContext.organizationId;
    const recall = await this.prisma.recallRecord.findFirst({
      where: { id: recallId, organizationId: orgId },
    });
    if (!recall) throw NotFound('Recall not found');
    if (recall.status !== 'OPEN') throw Conflict('STATE_TRANSITION_INVALID', 'Recall already resolved');

    const updated = await this.prisma.recallRecord.update({
      where: { id: recallId },
      data: { status: 'RESOLVED', resolutionNotes, resolvedAt: new Date() },
    });
    await this.audit.record({
      event: 'RECALL_RESOLVED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'RecallRecord',
      entityId: recallId,
    });
    return updated;
  }

  async setBatchStatus(request: TenantRequest, batchId: string, status: string, reason: string) {
    const orgId = request.tenantContext.organizationId;
    const batch = await this.prisma.inventoryBatch.findFirst({
      where: { id: batchId, organizationId: orgId },
    });
    if (!batch) throw NotFound('Batch not found');
    const allowed = ['SALEABLE', 'QUARANTINED', 'DAMAGED', 'EXPIRED_BLOCKED'] as const;
    if (!allowed.includes(status as (typeof allowed)[number])) {
      throw Conflict('STATE_TRANSITION_INVALID', `Status ${status} is managed via dedicated workflows`);
    }
    const updated = await this.prisma.inventoryBatch.update({
      where: { id: batchId },
      data: { status: status as never },
    });
    await this.audit.record({
      event: 'BATCH_STATUS_CHANGED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'InventoryBatch',
      entityId: batchId,
      details: { from: batch.status, to: status, reason },
    });
    return updated;
  }

  /** Ledger↔balance reconciliation (spec §26.D). Used by tests and admin. */
  async reconcile(request: TenantRequest, warehouseId?: string) {
    const orgId = request.tenantContext.organizationId;
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId: orgId, ...(warehouseId ? { warehouseId } : {}) },
    });
    const mismatches: Array<{ batchId: string; warehouseId: string; balance: number; ledger: number }> = [];
    for (const balance of balances) {
      const agg = await this.prisma.inventoryMovement.aggregate({
        where: { batchId: balance.batchId, warehouseId: balance.warehouseId },
        _sum: { quantity: true },
      });
      const ledger = Number(agg._sum.quantity ?? 0);
      if (Math.abs(ledger - Number(balance.quantity)) > 0.0001) {
        mismatches.push({
          batchId: balance.batchId,
          warehouseId: balance.warehouseId,
          balance: Number(balance.quantity),
          ledger,
        });
      }
    }
    return { checked: balances.length, mismatches, consistent: mismatches.length === 0 };
  }
}

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
