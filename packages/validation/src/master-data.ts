import { z } from 'zod';
import {
  DOSAGE_FORMS,
  GST_REGISTRATION_TYPES,
  PRESCRIPTION_CLASSES,
  PRODUCT_STATUSES,
  VENDOR_STATUSES,
  CUSTOMER_STATUSES,
} from '@medicore/shared-types';
import {
  calendarDateSchema,
  decimalStringSchema,
  emailSchema,
  gstinSchema,
  hsnCodeSchema,
  indianPhoneSchema,
  panSchema,
  pinCodeSchema,
  stateCodeSchema,
} from './common';
import { bankAccountSchema, drugLicenceNumberSchema, gstinIssues, ifscSchema } from './india';

const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

// ── Taxonomy ─────────────────────────────────────────────────────────────────

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().uuid().nullish(),
  description: z.string().trim().max(500).nullish(),
});

export const manufacturerCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactEmail: emailSchema.nullish(),
  contactPhone: indianPhoneSchema.nullish(),
  notes: z.string().trim().max(500).nullish(),
});

// ── Tax configuration (versioned; no hardcoded rates — spec §13) ─────────────

export const categoryUpdateSchema = categoryCreateSchema.partial();
export const manufacturerUpdateSchema = manufacturerCreateSchema.partial();

const percentSchema = decimalStringSchema.refine((v) => Number(v) >= 0 && Number(v) <= 100, 'Must be between 0 and 100');

/**
 * GST is either split intra-state (CGST + SGST, always equal halves) or levied
 * inter-state as IGST, which must equal CGST + SGST for the same slab.
 */
export const taxRateVersionCreateSchema = z
  .object({
    hsnCode: hsnCodeSchema,
    description: z.string().trim().min(1, 'Describe the slab, e.g. "Medicines 5%"').max(200),
    /** Slab percentages as decimal strings, e.g. cgst "9.00" + sgst "9.00". */
    cgstPercent: percentSchema.nullish(),
    sgstPercent: percentSchema.nullish(),
    igstPercent: percentSchema.nullish(),
    cessPercent: percentSchema.nullish(),
    effectiveFrom: calendarDateSchema,
    effectiveTo: calendarDateSchema.nullish(),
  })
  .superRefine((v, ctx) => {
    const has = (x: string | null | undefined): x is string => x !== null && x !== undefined && x !== '';
    if (!has(v.cgstPercent) && !has(v.sgstPercent) && !has(v.igstPercent)) {
      ctx.addIssue({ code: 'custom', path: ['igstPercent'], message: 'Enter CGST + SGST, IGST, or both' });
      return;
    }
    if (has(v.cgstPercent) !== has(v.sgstPercent)) {
      ctx.addIssue({ code: 'custom', path: [has(v.cgstPercent) ? 'sgstPercent' : 'cgstPercent'], message: 'CGST and SGST are always levied together' });
    } else if (has(v.cgstPercent) && has(v.sgstPercent) && Number(v.cgstPercent) !== Number(v.sgstPercent)) {
      ctx.addIssue({ code: 'custom', path: ['sgstPercent'], message: 'SGST must equal CGST' });
    }
    if (has(v.igstPercent) && has(v.cgstPercent) && has(v.sgstPercent)) {
      const split = Number(v.cgstPercent) + Number(v.sgstPercent);
      if (Math.abs(split - Number(v.igstPercent)) > 0.001) {
        ctx.addIssue({ code: 'custom', path: ['igstPercent'], message: `IGST must equal CGST + SGST (${split.toFixed(2)}%)` });
      }
    }
    if (v.effectiveTo && v.effectiveTo < v.effectiveFrom) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'End date cannot be before the start date' });
    }
  });

// ── Products ─────────────────────────────────────────────────────────────────

export const productCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  genericName: z.string().trim().max(200).nullish(),
  brand: z.string().trim().max(160).nullish(),
  sku: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9._-]+$/, 'SKU: letters, digits, dot, dash, underscore'),
  categoryId: z.string().uuid().nullish(),
  manufacturerId: z.string().uuid().nullish(),
  dosageForm: z.enum(DOSAGE_FORMS).nullish(),
  strength: z.string().trim().max(80).nullish(),
  packSize: z.string().trim().max(80).nullish(),
  unitsPerPack: z.number().int().min(1).max(100000).nullish(),
  purchaseUnit: z.string().trim().max(40).nullish(),
  saleUnit: z.string().trim().max(40).nullish(),
  /** Sale units per purchase unit, e.g. pack of 10 strips → 10. */
  unitConversionFactor: z.number().min(0.001).max(1000000).nullish(),
  hsnCode: hsnCodeSchema.nullish(),
  taxRateVersionId: z.string().uuid().nullish(),
  mrp: decimalStringSchema.nullish(),
  purchasePrice: decimalStringSchema.nullish(),
  sellingPrice: decimalStringSchema.nullish(),
  tradePrice: decimalStringSchema.nullish(),
  prescriptionClass: z.enum(PRESCRIPTION_CLASSES).nullish(),
  storageInstructions: z.string().trim().max(300).nullish(),
  requiresRefrigeration: z.boolean().default(false),
  rackLocation: z.string().trim().max(60).nullish(),
  reorderLevel: z.number().int().min(0).max(1000000).nullish(),
  maxStockLevel: z.number().int().min(0).max(10000000).nullish(),
  minOrderQuantity: z.number().int().min(1).max(100000).nullish(),
  status: z.enum(PRODUCT_STATUSES).default('ACTIVE'),
  barcodes: z.array(z.string().trim().min(4).max(64)).max(10).default([]),
});

export type ProductCreateDto = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = productCreateSchema.partial();

export const productQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  manufacturerId: z.string().uuid().optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  prescriptionClass: z.enum(PRESCRIPTION_CLASSES).optional(),
  /** Adds `onHand` (saleable, unexpired) per product for this warehouse. */
  stockWarehouseId: z.string().uuid().optional(),
  /** Adds `onHand` (saleable, unexpired) per product across all warehouses. */
  withStock: boolQuery.optional(),
  /** Comma-separated product ids (up to 100) to fetch specific products. */
  ids: z
    .string()
    .regex(/^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,99}$/i, 'Comma-separated product ids (max 100)')
    .transform((v) => v.split(','))
    .optional(),
});

export const substitutesQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
});

// ── Vendors ──────────────────────────────────────────────────────────────────

export const vendorCreateSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).nullish(),
  gstin: gstinSchema.nullish(),
  pan: panSchema.nullish(),
  gstRegistrationType: z.enum(GST_REGISTRATION_TYPES).default('REGULAR'),
  addressLine1: z.string().trim().max(200).nullish(),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  stateCode: stateCodeSchema.nullish(),
  pinCode: pinCodeSchema.nullish(),
  contactName: z.string().trim().max(120).nullish(),
  phone: indianPhoneSchema.nullish(),
  email: emailSchema.nullish(),
  creditDays: z.number().int().min(0).max(365).default(30),
  creditLimit: decimalStringSchema.default('0.00'),
  openingBalance: decimalStringSchema.default('0.00'),
  /** Opening balance sign convention: positive = we owe supplier. */
  status: z.enum(VENDOR_STATUSES).default('ACTIVE'),
  /** Wholesale drug licence (Form 20B/21B) — Drugs & Cosmetics Rules require buying only from licensed suppliers. */
  drugLicenceNumber: drugLicenceNumberSchema.nullish(),
  drugLicenceExpiry: calendarDateSchema.nullish(),
  bankAccount: bankAccountSchema.nullish(),
  ifsc: ifscSchema.nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export type VendorCreateDto = z.infer<typeof vendorCreateSchema>;

/**
 * Form-level vendor checks: GSTIN ↔ state/PAN, registration type, bank pair.
 * Shared by the web form (inline errors) and the API (VALIDATION_ERROR).
 */
export function vendorIssues(v: {
  gstin?: string | null;
  pan?: string | null;
  stateCode?: string | null;
  gstRegistrationType?: string | null;
  bankAccount?: string | null;
  ifsc?: string | null;
}, opts: { requireGstin?: boolean } = {}): Array<{ field: string; message: string }> {
  const issues = gstinIssues({ gstin: v.gstin, stateCode: v.stateCode, pan: v.pan });
  if (opts.requireGstin && (v.gstRegistrationType === 'REGULAR' || v.gstRegistrationType === 'COMPOSITION') && !v.gstin) {
    issues.push({ field: 'gstin', message: 'GSTIN is required for a registered supplier' });
  }
  if (v.gstRegistrationType === 'UNREGISTERED' && v.gstin) {
    issues.push({ field: 'gstRegistrationType', message: 'A supplier with a GSTIN cannot be unregistered' });
  }
  if (v.bankAccount && !v.ifsc) issues.push({ field: 'ifsc', message: 'IFSC is required with a bank account' });
  if (v.ifsc && !v.bankAccount) issues.push({ field: 'bankAccount', message: 'Account number is required with an IFSC' });
  return issues;
}

export const vendorUpdateSchema = vendorCreateSchema.partial();

export const vendorQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
  stateCode: z.string().max(2).optional(),
  /** Adds `payable`, `overdue` and `openInvoices` per vendor. */
  withBalances: boolQuery.optional(),
});

// ── Customers ────────────────────────────────────────────────────────────────

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(80).nullish(),
  gstin: gstinSchema.nullish(),
  phone: indianPhoneSchema.nullish(),
  email: emailSchema.nullish(),
  addressLine1: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  stateCode: stateCodeSchema.nullish(),
  pinCode: pinCodeSchema.nullish(),
  creditDays: z.number().int().min(0).max(365).default(0),
  creditLimit: decimalStringSchema.default('0.00'),
  openingBalance: decimalStringSchema.default('0.00'),
  /** Opening balance sign convention: positive = customer owes us. */
  status: z.enum(CUSTOMER_STATUSES).default('ACTIVE'),
  isWholesale: z.boolean().default(false),
  notes: z.string().trim().max(1000).nullish(),
});

export type CustomerCreateDto = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema.partial();

export const customerQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  isWholesale: boolQuery.optional(),
  /** Adds `outstanding`, `overdue` and `oldestDueDays` per customer. */
  withBalances: boolQuery.optional(),
});

export const partnerTopProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
