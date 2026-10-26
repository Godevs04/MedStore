import { z } from 'zod';
import { GST_REGISTRATION_TYPES } from '@medicore/shared-types';
import {
  calendarDateSchema,
  emailSchema,
  gstinSchema,
  indianPhoneSchema,
  pinCodeSchema,
  stateCodeSchema,
} from './common';

/**
 * Guided onboarding (spec §6). Steps arrive individually; the organization
 * cannot post real transactions until essential steps are complete — the
 * setup checklist endpoint computes readiness.
 */
export const organizationSetupSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  legalEntityName: z.string().trim().max(160).nullish(),
  gstRegistrationStatus: z.enum(GST_REGISTRATION_TYPES).default('REGULAR'),
  gstin: gstinSchema.nullish(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/).nullish(),
  addressLine1: z.string().trim().max(200),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100),
  stateCode: stateCodeSchema,
  pinCode: pinCodeSchema,
  contactPhone: indianPhoneSchema,
  contactEmail: emailSchema,
  /** Financial year start month for India: April by default. */
  financialYearStartMonth: z.number().int().min(1).max(12).default(4),
});

export type OrganizationSetupDto = z.infer<typeof organizationSetupSchema>;

export const branchCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().max(20).nullish(),
  addressLine1: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  stateCode: stateCodeSchema.nullish(),
  pinCode: pinCodeSchema.nullish(),
  phone: indianPhoneSchema.nullish(),
  isBillingEnabled: z.boolean().default(true),
});

export type BranchCreateDto = z.infer<typeof branchCreateSchema>;

export const warehouseCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().max(20).nullish(),
  isDefault: z.boolean().default(false),
});

export type WarehouseCreateDto = z.infer<typeof warehouseCreateSchema>;

/** Phase 0 note: licence numbers are tracked, never validated against a registry. */
export const pharmacyLicenceSchema = z.object({
  licenceType: z.enum(['FORM_20', 'FORM_20A', 'FORM_20B', 'FORM_21', 'FORM_21B', 'OTHER']),
  licenceNumber: z.string().trim().min(2).max(100),
  issuingAuthority: z.string().trim().max(160).nullish(),
  issueDate: calendarDateSchema.nullish(),
  expiryDate: calendarDateSchema,
  branchId: z.string().uuid().nullish(),
});

export type PharmacyLicenceDto = z.infer<typeof pharmacyLicenceSchema>;
