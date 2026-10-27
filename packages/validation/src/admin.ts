import { z } from 'zod';
import { GST_REGISTRATION_TYPES } from '@medicore/shared-types';
import { emailSchema, gstinSchema, indianPhoneSchema, panSchema, pinCodeSchema, stateCodeSchema } from './common';
import { branchCreateSchema } from './onboarding';

/** Blank form fields arrive as "" — treat them as cleared values. */
const blankable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullish());

// ── Branches & counters ──────────────────────────────────────────────────────

export const branchUpdateSchema = branchCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
  isDefault: z.literal(true).optional(),
});

export const billingCounterCreateSchema = z.object({
  name: z.string().trim().min(2, 'Name the counter, e.g. "Counter 1"').max(60),
});

export const billingCounterUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  isActive: z.boolean().optional(),
});

// ── Members ──────────────────────────────────────────────────────────────────

export const MEMBER_STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED'] as const;

export const memberListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(MEMBER_STATUSES).optional(),
  roleId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});

export const memberInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  roleId: z.string().uuid('Pick a role').nullable(),
  branchIds: z.array(z.string().uuid()).max(50).default([]),
});

export const memberBranchesSchema = z.object({
  branchIds: z.array(z.string().uuid()).max(50),
});

// ── Roles ────────────────────────────────────────────────────────────────────

export const roleCreateSchema = z.object({
  name: z.string().trim().min(2, 'Role name needs at least 2 characters').max(80),
  description: z.string().trim().max(300).nullish(),
  permissionKeys: z.array(z.string().max(64)).min(1, 'Grant at least one permission').max(200),
});

export const rolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string().max(64)).min(1, 'Grant at least one permission').max(200),
});

// ── Organization profile & settings ──────────────────────────────────────────

/** GST registrations that must carry a GSTIN. */
export const GSTIN_REQUIRED_FOR = ['REGULAR', 'COMPOSITION'] as const;

export const organizationUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Business name needs at least 2 characters').max(160).optional(),
  legalEntityName: blankable(z.string().trim().max(160)),
  gstRegistrationStatus: z.enum(GST_REGISTRATION_TYPES).optional(),
  gstin: blankable(gstinSchema),
  pan: blankable(panSchema),
  addressLine1: blankable(z.string().trim().max(200)),
  addressLine2: blankable(z.string().trim().max(200)),
  city: blankable(z.string().trim().max(100)),
  stateCode: blankable(stateCodeSchema),
  pinCode: blankable(pinCodeSchema),
  contactPhone: blankable(indianPhoneSchema),
  contactEmail: blankable(emailSchema),
  financialYearStartMonth: z.number().int().min(1).max(12).optional(),
});

export const upiIdSchema = z.string().trim().regex(/^[\w.-]{2,256}@[A-Za-z]{2,64}$/, 'Must be a valid UPI ID (e.g. pharmacy@okhdfc)');

export const organizationSettingsSchema = z
  .object({
    receiptFooter: z.string().trim().max(500, 'Keep the footer under 500 characters').nullish(),
    invoiceTerms: z.string().trim().max(1000, 'Keep the terms under 1000 characters').nullish(),
    printLicenceOnInvoice: z.boolean().optional(),
    defaultPrintFormat: z.enum(['A4', 'THERMAL_80']).optional(),
    upiId: blankable(upiIdSchema),
    lowStockAlertDays: z.number().int().min(1).max(365).optional(),
    expiryAlertDays: z.number().int().min(1).max(730).optional(),
  })
  .passthrough();

// ── Platform ─────────────────────────────────────────────────────────────────

export const PLAN_KEYS = ['TRIAL', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'] as const;
export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'CANCELLED', 'EXPIRED'] as const;

export const tenantListQuerySchema = z.object({
  page: z.coerce
    .number()
    .catch(1)
    .transform((v) => Math.max(1, Math.floor(v) || 1)),
  pageSize: z.coerce
    .number()
    .catch(25)
    .transform((v) => Math.min(100, Math.max(1, Math.floor(v) || 25))),
  search: z.string().trim().max(100).optional(),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  planKey: z.enum(PLAN_KEYS).optional(),
  suspended: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
