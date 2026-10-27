import { z } from 'zod';

const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Shared filters for purchase orders, receipts, invoices, payments and debit notes. */
export const purchaseListQuerySchema = z.object({
  /** One status or a comma-separated list, e.g. `SENT,CONFIRMED`. */
  status: z
    .string()
    .regex(/^[A-Z_]+(,[A-Z_]+)*$/, 'Use status codes like SENT or SENT,CONFIRMED')
    .optional(),
  vendorId: z.string().uuid().optional(),
  /** Matches the document number (and reference for payments). */
  search: z.string().trim().max(64).optional(),
  /** Goods receipts only: those without a supplier invoice. */
  uninvoiced: boolQuery.optional(),
  /** Supplier invoices only: a single invoice by id (deep links). */
  id: z.string().uuid().optional(),
});

export const purchaseDuplicateQuerySchema = z.object({
  vendorId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1).max(64),
});

export const reorderSuggestionsQuerySchema = z.object({
  /** Only products last bought from (or mapped to) this vendor. */
  vendorId: z.string().uuid().optional(),
  /** Count stock in one warehouse instead of the whole organisation. */
  warehouseId: z.string().uuid().optional(),
});
