import { z } from 'zod';

/** Shared pagination + sorting contract (spec §27). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().max(64).optional(),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQueryDto = z.infer<typeof paginationQuerySchema>;

export const uuidSchema = z.string().uuid();

/** Indian mobile numbers: 10 digits, first digit 6-9, optional +91/0 prefix. */
export const indianPhoneSchema = z
  .string()
  .trim()
  .regex(/^(\+91[\s-]?)?[0]?[6-9]\d{9}$/, 'Must be a valid Indian mobile number');

/** PIN code: 6 digits, first digit non-zero. */
export const pinCodeSchema = z.string().trim().regex(/^[1-9]\d{5}$/, 'Must be a valid 6-digit PIN code');

/**
 * GSTIN format check only — 15 chars: 2-digit state code, 10-char PAN,
 * entity digit, 'Z' or other, checksum char. This validates FORMAT, not
 * government registration status (spec §6).
 */
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/,
    'Must be a valid 15-character GSTIN format (e.g. 27ABCDE1234F1Z5)',
  );

/** Extract the 2-digit state code from a GSTIN (caller validates consistency). */
export function gstinStateCode(gstin: string): string {
  return gstin.slice(0, 2);
}

/** Indian states/UTs with their GST state codes (Schedule I of CGST rulebook numbering). */
export const INDIAN_STATE_CODES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
] as const;

export const stateCodeSchema = z.string().refine(
  (v) => INDIAN_STATE_CODES.some((s) => s.code === v),
  'Must be a valid 2-digit GST state code',
);

/** PAN format: 5 letters, 4 digits, 1 letter. */
export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Must be a valid 10-character PAN');

/** Monetary amounts cross the API as decimal strings, never floats. */
export const decimalStringSchema = z
  .string()
  .regex(/^-?\d{1,15}(\.\d{1,4})?$/, 'Must be a decimal string like "123.45"');

/** Positive decimal string (quantities allow up to 3 decimals for strips/ml). */
export const quantitySchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Must be a positive decimal string like "10" or "10.5"');

export const emailSchema = z.string().trim().toLowerCase().email();

/** ISO date string (YYYY-MM-DD) for dates without time semantics. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO date (YYYY-MM-DD)');

/** Validates a real calendar date (rejects 2025-02-30). */
export const calendarDateSchema = isoDateSchema.refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Must be a real calendar date');

/** Command-palette search across the workspace. */
export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(80, 'Search is limited to 80 characters'),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

/** HSN codes: 4, 6, or 8 digits (8-digit mandatory for turnover > 5 crore). */
export const hsnCodeSchema = z.string().trim().regex(/^\d{4}(\d{2})?(\d{2})?$/, 'Must be a 4, 6, or 8 digit HSN code');
