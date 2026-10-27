import { z } from 'zod';
import { calendarDateSchema } from './common';
import { drugLicenceNumberSchema, isValidGstinChecksum } from './india';

// ── Shared query shapes ──────────────────────────────────────────────────────

/** Optional `from`/`to` calendar dates where `from` must not be after `to`. */
export const dateRangeQuerySchema = z
  .object({ from: calendarDateSchema.optional(), to: calendarDateSchema.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'From date must be on or before the To date', path: ['to'] });

export const asOfQuerySchema = z.object({ asOf: calendarDateSchema.optional() });

/** GST return period `YYYY-MM` (e.g. "2026-10" for GSTR-1 Oct 2026); future months are rejected. */
export const returnPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a return period like 2026-10')
  .refine((v) => {
    const now = new Date(Date.now() + 330 * 60_000);
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return v <= current;
  }, 'Return period cannot be in the future');

export const returnPeriodQuerySchema = z.object({ period: returnPeriodSchema });

/** First and last calendar day of a `YYYY-MM` period. */
export function periodBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

// ── Accounting ───────────────────────────────────────────────────────────────

export const EXPENSE_METHODS = ['CASH', 'BANK', 'UPI'] as const;

export const EXPENSE_CATEGORIES = [
  'Rent',
  'Salaries & wages',
  'Electricity',
  'Internet & phone',
  'Repairs & maintenance',
  'Transport & delivery',
  'Packaging',
  'Licence & professional fees',
  'Bank charges',
  'Marketing',
  'Stationery & printing',
  'Miscellaneous',
] as const;

export const expenseCreateSchema = z.object({
  category: z.string().trim().min(2, 'Pick or type a category').max(80),
  payee: z.string().trim().min(2, 'Who was paid?').max(160),
  amount: z
    .string()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount like 1500 or 1500.50')
    .refine((v) => Number(v) > 0, 'Amount must be greater than zero'),
  method: z.enum(EXPENSE_METHODS),
  expenseDate: calendarDateSchema.refine((v) => {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    return v <= today;
  }, 'Expense date cannot be in the future'),
  notes: z.string().trim().max(300).nullish(),
});

export type ExpenseCreateDto = z.infer<typeof expenseCreateSchema>;

export const expenseListQuerySchema = z
  .object({
    category: z.string().trim().max(80).optional(),
    method: z.enum(EXPENSE_METHODS).optional(),
    search: z.string().trim().max(80).optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'From date must be on or before the To date', path: ['to'] });

// ── Compliance ───────────────────────────────────────────────────────────────

export const LICENCE_TYPES = ['FORM_20', 'FORM_21', 'FORM_20B', 'FORM_21B', 'FORM_20F', 'FORM_20G', 'NARCOTIC', 'FSSAI', 'GST', 'TRADE', 'OTHER'] as const;
export type LicenceType = (typeof LICENCE_TYPES)[number];

export const LICENCE_LABELS: Record<LicenceType, string> = {
  FORM_20: 'Form 20 — retail (non-Schedule C/X)',
  FORM_21: 'Form 21 — retail (Schedule C/C1)',
  FORM_20B: 'Form 20B — wholesale (non-Schedule C/X)',
  FORM_21B: 'Form 21B — wholesale (Schedule C/C1)',
  FORM_20F: 'Form 20F — Schedule X retail',
  FORM_20G: 'Form 20G — Schedule X wholesale',
  NARCOTIC: 'NDPS licence',
  FSSAI: 'FSSAI (nutraceuticals / food)',
  GST: 'GST registration',
  TRADE: 'Shop & establishment / trade licence',
  OTHER: 'Other',
};

const DRUG_FORMS = new Set<string>(['FORM_20', 'FORM_21', 'FORM_20B', 'FORM_21B', 'FORM_20F', 'FORM_20G', 'NARCOTIC']);

/** Number-format problem for a licence of the given type, or null when it looks right. */
export function licenceNumberIssue(type: string, value: string): string | null {
  const v = value.trim().toUpperCase();
  if (DRUG_FORMS.has(type)) {
    const r = drugLicenceNumberSchema.safeParse(v);
    return r.success ? null : (r.error.issues[0]?.message ?? 'Invalid drug licence number');
  }
  if (type === 'FSSAI') return /^[12]\d{13}$/.test(v) ? null : 'FSSAI licence numbers are 14 digits starting with 1 or 2';
  if (type === 'GST') {
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(v)) return 'Enter the 15-character GSTIN';
    return isValidGstinChecksum(v) ? null : 'GSTIN check digit does not match — re-check the number';
  }
  return v.length >= 2 ? null : 'Licence number is too short';
}

/** Warnings for licence sets that are legal to save but usually incomplete. */
export function licenceSetWarnings(types: string[]): string[] {
  const has = new Set(types);
  const out: string[] = [];
  if (has.has('FORM_20') !== has.has('FORM_21')) out.push('Retail chemists normally hold both Form 20 and Form 21 (Drugs Rules, rule 61).');
  if (has.has('FORM_20B') !== has.has('FORM_21B')) out.push('Wholesale licences come as a pair: add both Form 20B and Form 21B.');
  if (!['FORM_20', 'FORM_21', 'FORM_20B', 'FORM_21B'].some((t) => has.has(t))) out.push('No drug sale licence on file — add Form 20/21 (retail) or 20B/21B (wholesale).');
  return out;
}

export const licenceUpsertSchema = z
  .object({
    licenceType: z.enum(LICENCE_TYPES),
    licenceNumber: z.string().trim().toUpperCase().min(2, 'Enter the licence number').max(80),
    issuingAuthority: z.string().trim().max(160).nullish(),
    issueDate: calendarDateSchema.nullish(),
    expiryDate: calendarDateSchema,
    branchId: z.string().uuid().nullish(),
  })
  .superRefine((d, ctx) => {
    const issue = licenceNumberIssue(d.licenceType, d.licenceNumber);
    if (issue) ctx.addIssue({ code: 'custom', path: ['licenceNumber'], message: issue });
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    if (d.issueDate && d.issueDate > today) ctx.addIssue({ code: 'custom', path: ['issueDate'], message: 'Issue date cannot be in the future' });
    if (d.issueDate && d.expiryDate <= d.issueDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry must be after the issue date' });
  });

export type LicenceUpsertDto = z.infer<typeof licenceUpsertSchema>;

export const h1RegisterQuerySchema = z
  .object({
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    search: z.string().trim().max(80).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'From date must be on or before the To date', path: ['to'] });

// ── Reports ──────────────────────────────────────────────────────────────────

export const deadStockQuerySchema = z.object({
  /** No sale within this many days marks an item dead. */
  days: z.coerce.number().int().min(30).max(365).default(90),
  warehouseId: z.string().uuid().optional(),
});
