import { z } from 'zod';
import { calendarDateSchema, indianPhoneSchema, paginationQuerySchema } from './common';

const money = (label: string) => z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, `${label} must be an amount like 120 or 120.50`);
const rate = z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, 'Rate must be a number like 45 or 45.50');

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'CREDIT', 'BANK'] as const;
export const TENDER_METHODS = ['CASH', 'UPI', 'CARD', 'BANK'] as const;

export const saleLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Quantity must be a number like 1 or 2.5')
    .refine((v) => Number(v) > 0, 'Quantity must be greater than zero'),
  unitPrice: rate,
  discountAmount: money('Discount').optional(),
  explicitBatchId: z.string().uuid().nullish(),
});

/** State medical council registration, e.g. "MMC 2010/12345" or "KMC-54321". */
export const prescriberRegNoSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9/.\- ]{2,29}$/, 'Registration number must be 3–30 letters, digits, / . or -');

export const prescriptionSchema = z.object({
  patientName: z.string().trim().min(2, 'Patient name is required').max(160),
  patientPhone: indianPhoneSchema.nullish(),
  prescriberName: z.string().trim().min(2, 'Prescriber name is required').max(160),
  prescriberRegNo: prescriberRegNoSchema.nullish(),
  prescriberAddress: z.string().trim().min(3, 'Prescriber address is required').max(300),
});

export const saleCreateSchema = z.object({
  customerId: z.string().uuid().nullish(),
  walkInName: z.string().trim().max(120).nullish(),
  warehouseId: z.string().uuid(),
  lines: z.array(saleLineSchema).min(1, 'Add at least one item').max(100),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: money('Payment'),
        reference: z.string().trim().max(120).nullish(),
      }),
    )
    .min(1)
    .max(10),
  idempotencyKey: z.string().min(8).max(64).nullish(),
  prescription: prescriptionSchema.nullish(),
});
export type SaleCreateDto = z.infer<typeof saleCreateSchema>;

export const saleReturnCreateSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().min(3, 'Give a reason of at least 3 characters').max(500),
  refundMethod: z.enum(TENDER_METHODS).optional(),
  lines: z
    .array(
      z.object({
        invoiceLineId: z.string().uuid(),
        quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, 'Quantity must be a number'),
        restock: z.boolean(),
      }),
    )
    .min(1, 'Select at least one item to return')
    .max(100),
});

export const customerReceiptSchema = z.object({
  customerId: z.string().uuid(),
  amount: money('Amount').refine((v) => Number(v) > 0, 'Amount must be greater than zero'),
  method: z.enum(TENDER_METHODS),
  reference: z.string().trim().max(120).nullish(),
});

export const invoiceCancelSchema = z.object({
  reason: z.string().trim().min(5, 'Explain the cancellation in at least 5 characters').max(500),
});

const optionalDate = calendarDateSchema.optional();
const boolFlag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const invoiceListQuerySchema = paginationQuerySchema.extend({
  sortBy: z.enum(['invoiceDate', 'total', 'invoiceNumber', 'creditAmount']).optional(),
  customerId: z.string().uuid().optional(),
  search: z.string().trim().max(80).optional(),
  from: optionalDate,
  to: optionalDate,
  status: z.enum(['POSTED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED']).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  hasCredit: boolFlag,
});

export const returnListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(80).optional(),
  from: optionalDate,
  to: optionalDate,
});

export const heldBillCreateSchema = z.object({
  label: z.string().trim().min(1, 'Give the bill a name').max(60),
  customerId: z.string().uuid().nullish(),
  itemCount: z.number().int().min(1, 'Add at least one item').max(100),
  total: money('Total'),
  payload: z.record(z.unknown()),
});
