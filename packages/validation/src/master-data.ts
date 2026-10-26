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
  pinCodeSchema,
  stateCodeSchema,
} from './common';

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

export const taxRateVersionCreateSchema = z.object({
  hsnCode: hsnCodeSchema,
  description: z.string().trim().min(1).max(200),
  /** Slab percentages as decimal strings, e.g. cgst "9.00" + sgst "9.00". */
  cgstPercent: decimalStringSchema.nullish(),
  sgstPercent: decimalStringSchema.nullish(),
  igstPercent: decimalStringSchema.nullish(),
  cessPercent: decimalStringSchema.nullish(),
  effectiveFrom: calendarDateSchema,
  effectiveTo: calendarDateSchema.nullish(),
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
});

// ── Vendors ──────────────────────────────────────────────────────────────────

export const vendorCreateSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).nullish(),
  gstin: gstinSchema.nullish(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Must be a valid PAN').nullish(),
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
  notes: z.string().trim().max(1000).nullish(),
});

export type VendorCreateDto = z.infer<typeof vendorCreateSchema>;

export const vendorUpdateSchema = vendorCreateSchema.partial();

export const vendorQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
  stateCode: z.string().max(2).optional(),
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
  isWholesale: z.coerce.boolean().optional(),
});
