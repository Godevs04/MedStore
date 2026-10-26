import { z } from 'zod';
import { ADJUSTMENT_REASONS, BATCH_STATUSES, TRANSFER_STATUSES, COUNT_STATUSES } from '@medicore/shared-types';
import { calendarDateSchema, decimalStringSchema, quantitySchema } from './common';

// ── Opening stock & batches ──────────────────────────────────────────────────

export const batchCreateSchema = z.object({
  productId: z.string().uuid(),
  batchNumber: z.string().trim().min(1).max(64),
  expiryDate: calendarDateSchema,
  manufacturingDate: calendarDateSchema.nullish(),
  quantity: quantitySchema,
  freeQuantity: quantitySchema.default('0'),
  purchaseRate: decimalStringSchema,
  mrp: decimalStringSchema,
  /** Intra- or inter-state input tax captured with the batch. */
  warehouseId: z.string().uuid(),
  supplierId: z.string().uuid().nullish(),
  status: z.enum(BATCH_STATUSES).default('SALEABLE'),
});

export type BatchCreateDto = z.infer<typeof batchCreateSchema>;

/**
 * Batch selection request for dispensing: FEFO is the default allocator;
 * an explicit batchId indicates an authorized override which is audited.
 */
export const allocateBatchesRequestSchema = z.object({
  productId: z.string().uuid(),
  quantity: quantitySchema,
  warehouseId: z.string().uuid(),
  explicitBatchId: z.string().uuid().nullish(),
  /** Allocation happens at sale time; eligibility filter defaults to saleable + not expired. */
});

export type AllocateBatchesRequestDto = z.infer<typeof allocateBatchesRequestSchema>;

// ── Adjustments ──────────────────────────────────────────────────────────────

export const adjustmentCreateSchema = z.object({
  batchId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  direction: z.enum(['IN', 'OUT']),
  quantity: quantitySchema,
  reason: z.enum(ADJUSTMENT_REASONS),
  notes: z.string().trim().max(500).nullish(),
});

export type AdjustmentCreateDto = z.infer<typeof adjustmentCreateSchema>;

// ── Stock counts ─────────────────────────────────────────────────────────────

export const countCreateSchema = z.object({
  warehouseId: z.string().uuid(),
  notes: z.string().trim().max(500).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        batchId: z.string().uuid(),
        countedQty: quantitySchema,
      }),
    )
    .min(1)
    .max(2000),
});

export type CountCreateDto = z.infer<typeof countCreateSchema>;

// ── Stock transfers ──────────────────────────────────────────────────────────

export const transferCreateSchema = z.object({
  sourceWarehouseId: z.string().uuid(),
  destinationWarehouseId: z.string().uuid(),
  notes: z.string().trim().max(500).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        batchId: z.string().uuid(),
        quantity: quantitySchema,
      }),
    )
    .min(1)
    .max(500),
});

export type TransferCreateDto = z.infer<typeof transferCreateSchema>;

export const transferReceiveSchema = z.object({
  lines: z
    .array(
      z.object({
        transferLineId: z.string().uuid(),
        receivedQty: quantitySchema,
      }),
    )
    .min(1),
});

export type TransferReceiveDto = z.infer<typeof transferReceiveSchema>;

export const transferCancelSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

// ── Recalls ──────────────────────────────────────────────────────────────────

export const recallCreateSchema = z.object({
  batchId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(1000).nullish(),
});

export const recallResolveSchema = z.object({
  resolutionNotes: z.string().trim().min(3).max(1000),
});

// ── Inventory queries ────────────────────────────────────────────────────────

export const batchQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  status: z.enum(BATCH_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
});

export const expiryDashboardQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  /** Days threshold for the CUSTOM bucket; defaults to org settings. */
  customDays: z.coerce.number().int().min(1).max(730).optional(),
});

export const movementQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  transferStatusFilter: z.enum(TRANSFER_STATUSES).optional(),
  countStatusFilter: z.enum(COUNT_STATUSES).optional(),
});
