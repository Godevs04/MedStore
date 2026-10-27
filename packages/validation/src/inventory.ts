import { z } from 'zod';
import { ADJUSTMENT_REASONS, BATCH_STATUSES, MOVEMENT_TYPES, TRANSFER_STATUSES, COUNT_STATUSES } from '@medicore/shared-types';
import { calendarDateSchema, decimalStringSchema, quantitySchema } from './common';
import { positiveQuantitySchema } from './india';

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
  quantity: positiveQuantitySchema,
  reason: z.enum(ADJUSTMENT_REASONS),
  notes: z.string().trim().max(500).nullish(),
}).refine((d) => d.reason !== 'OTHER' || (d.notes?.trim().length ?? 0) >= 3, {
  path: ['notes'],
  message: 'Describe the reason when choosing "Other"',
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
    .max(2000)
    .refine((lines) => new Set(lines.map((l) => l.batchId)).size === lines.length, 'Each batch can be counted only once per count'),
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
        quantity: positiveQuantitySchema,
      }),
    )
    .min(1)
    .max(500)
    .refine((lines) => new Set(lines.map((l) => l.batchId)).size === lines.length, 'Each batch can appear only once per transfer'),
}).refine((d) => d.sourceWarehouseId !== d.destinationWarehouseId, {
  path: ['destinationWarehouseId'],
  message: 'Destination must differ from the source warehouse',
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
  batchId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  status: z.enum(BATCH_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  expiryAfter: calendarDateSchema.optional(),
  expiryBefore: calendarDateSchema.optional(),
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

const dateRange = {
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
};

export const ledgerQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  movementType: z.enum(MOVEMENT_TYPES).optional(),
  direction: z.enum(['IN', 'OUT']).optional(),
  actorUserId: z.string().uuid().optional(),
  /** Batch number, product name or SKU. */
  search: z.string().trim().max(120).optional(),
  ...dateRange,
});

export const transferListQuerySchema = z.object({
  status: z.enum(TRANSFER_STATUSES).optional(),
  warehouseId: z.string().uuid().optional(),
});

export const countListQuerySchema = z.object({
  status: z.enum(COUNT_STATUSES).optional(),
  warehouseId: z.string().uuid().optional(),
});

export const adjustmentListQuerySchema = z.object({
  reason: z.enum(ADJUSTMENT_REASONS).optional(),
  direction: z.enum(['IN', 'OUT']).optional(),
  warehouseId: z.string().uuid().optional(),
  ...dateRange,
});

export const recallListQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED']).optional(),
});

export const stockSummaryQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
});

export const adjustmentSummaryQuerySchema = z.object({
  direction: z.enum(['IN', 'OUT']).optional(),
  warehouseId: z.string().uuid().optional(),
  ...dateRange,
});

export const expiryWriteoffSchema = z.object({
  batchIds: z
    .array(z.string().uuid())
    .min(1, 'Select at least one batch')
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate batches selected'),
  /** Limit the write-off to one warehouse; defaults to every warehouse holding the batch. */
  warehouseId: z.string().uuid().optional(),
  notes: z.string().trim().min(3, 'Add a note for the destruction register (min 3 characters)').max(500),
});

export type ExpiryWriteoffDto = z.infer<typeof expiryWriteoffSchema>;

export const countSheetQuerySchema = z.object({
  warehouseId: z.string().uuid(),
  search: z.string().trim().max(120).optional(),
  /** Include batches with zero system stock (to catch unrecorded receipts). */
  includeZero: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const countCancelSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason (min 5 characters)').max(500),
});

export const batchStatusUpdateSchema = z.object({
  status: z.enum(['SALEABLE', 'QUARANTINED', 'DAMAGED', 'EXPIRED_BLOCKED']),
  reason: z.string().trim().min(3, 'Give a reason (min 3 characters)').max(500),
});
