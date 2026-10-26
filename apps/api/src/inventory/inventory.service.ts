import { Injectable } from '@nestjs/common';
import type { MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { AppException, Conflict, NotFound } from '../common/app-exception.js';
import type { TenantPrisma } from './tenant-prisma.js';

const OUT_TYPES = new Set<string>([
  'SALE',
  'PURCHASE_RETURN_OUT',
  'EXPIRY_RETURN_OUT',
  'DAMAGE_OUT',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'COUNT_VARIANCE_OUT',
  'RECALL_OUT',
  'QUARANTINE_IN',
]);

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
  ) {}

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

  listTransfers(request: TenantRequest, params: { page: number; pageSize: number }) {
    const orgId = request.tenantContext.organizationId;
    return this.prisma.$transaction([
      this.prisma.stockTransfer.count({ where: { organizationId: orgId } }),
      this.prisma.stockTransfer.findMany({
        where: { organizationId: orgId },
        include: {
          lines: { include: { batch: { include: { product: { select: { name: true, sku: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  listCounts(request: TenantRequest, params: { page: number; pageSize: number }) {
    const orgId = request.tenantContext.organizationId;
    return this.prisma.$transaction([
      this.prisma.stockCount.count({ where: { organizationId: orgId } }),
      this.prisma.stockCount.findMany({
        where: { organizationId: orgId },
        include: {
          lines: { include: { batch: { include: { product: { select: { name: true, sku: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  listAdjustments(request: TenantRequest, params: { page: number; pageSize: number }) {
    const orgId = request.tenantContext.organizationId;
    return this.prisma.$transaction([
      this.prisma.stockAdjustment.count({ where: { organizationId: orgId } }),
      this.prisma.stockAdjustment.findMany({
        where: { organizationId: orgId },
        include: { batch: { include: { product: { select: { name: true, sku: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  listRecalls(request: TenantRequest, params: { page: number; pageSize: number }) {
    const orgId = request.tenantContext.organizationId;
    return this.prisma.$transaction([
      this.prisma.recallRecord.count({ where: { organizationId: orgId } }),
      this.prisma.recallRecord.findMany({
        where: { organizationId: orgId },
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
    params: { page: number; pageSize: number; productId?: string; warehouseId?: string; status?: string; search?: string },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.InventoryBatchWhereInput = { organizationId: orgId };
    if (params.productId) where.productId = params.productId;
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.status) where.status = params.status as Prisma.EnumBatchStatusFilter['equals'];
    if (params.search) where.batchNumber = { contains: params.search, mode: 'insensitive' };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.inventoryBatch.count({ where }),
      this.prisma.inventoryBatch.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, genericName: true } },
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
        return {
          batchId: b.id,
          productName: b.product.name,
          sku: b.product.sku,
          batchNumber: b.batchNumber,
          expiryDate: b.expiryDate,
          daysToExpiry: days,
          bucket,
          quantity: qty,
          status: b.status,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return { buckets, rows };
  }

  async stockLedger(
    request: TenantRequest,
    params: { page: number; pageSize: number; batchId?: string; warehouseId?: string; productId?: string },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.InventoryMovementWhereInput = { organizationId: orgId };
    if (params.batchId) where.batchId = params.batchId;
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.productId) where.batch = { productId: params.productId };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          batch: { include: { product: { select: { name: true, sku: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    return { total, items };
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
    const delta = data.direction === 'IN' ? qty : -qty;

    const adjustment = await this.prisma.$transaction(async (tx) => {
      await this.applyBalanceDelta(tx, {
        organizationId: orgId,
        batchId: batch.id,
        warehouseId: data.warehouseId,
        delta,
        actorUserId: request.principal.userId,
        movementType: data.direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        reason: data.reason,
        sourceDocument: 'STOCK_ADJUSTMENT',
      });
      return tx.stockAdjustment.create({
        data: {
          organizationId: orgId,
          batchId: batch.id,
          warehouseId: data.warehouseId,
          direction: data.direction,
          quantity: qty.toFixed(3),
          reason: data.reason,
          notes: data.notes ?? null,
          movementId: 'linked-via-ledger',
          actorUserId: request.principal.userId,
        },
      });
    });

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

  // ── Transfers ──────────────────────────────────────────────────────────────

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
      for (const line of count.lines) {
        const variance = Number(line.variance);
        if (variance === 0) continue;
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
