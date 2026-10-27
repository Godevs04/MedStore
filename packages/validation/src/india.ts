import { z } from 'zod';
import { INDIAN_STATE_CODES, gstinSchema } from './common';

/**
 * India-specific business rules shared by the API and the web forms. Field
 * checks return `{ field, message }` issues so callers can render them inline
 * (web) or raise a VALIDATION_ERROR (API) from the same source of truth.
 */
export interface FieldIssue {
  field: string;
  message: string;
}

const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * GSTIN check digit (15th char) per the GSTN mod-36 algorithm. Format errors
 * are left to `gstinSchema`; this only answers "is the check digit right?".
 */
export function isValidGstinChecksum(gstin: string): boolean {
  const value = gstin.trim().toUpperCase();
  if (!/^[0-9A-Z]{15}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const code = GSTIN_CHARSET.indexOf(value.charAt(i));
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARSET.charAt((36 - (sum % 36)) % 36) === value.charAt(14);
}

/** GSTIN format plus the GSTN check digit. */
export const gstinCheckedSchema = gstinSchema.refine(isValidGstinChecksum, 'GSTIN check digit does not match — re-check the number');

/** Characters 3–12 of a GSTIN are the holder's PAN. */
export function panFromGstin(gstin: string): string {
  return gstin.trim().toUpperCase().slice(2, 12);
}

export function stateName(code: string | null | undefined): string | undefined {
  return INDIAN_STATE_CODES.find((s) => s.code === code)?.name;
}

/** Cross-field GSTIN consistency: state prefix and embedded PAN. */
export function gstinIssues(input: {
  gstin?: string | null;
  stateCode?: string | null;
  pan?: string | null;
}): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const gstin = input.gstin?.trim().toUpperCase();
  if (!gstin) return issues;
  const prefix = gstin.slice(0, 2);
  if (input.stateCode && prefix !== input.stateCode) {
    issues.push({
      field: 'stateCode',
      message: `GSTIN is registered in ${stateName(prefix) ?? prefix} (${prefix}) but the state is ${stateName(input.stateCode) ?? input.stateCode} (${input.stateCode})`,
    });
  }
  const pan = input.pan?.trim().toUpperCase();
  if (pan && gstin.length === 15 && panFromGstin(gstin) !== pan) {
    issues.push({ field: 'pan', message: `PAN must match characters 3–12 of the GSTIN (${panFromGstin(gstin)})` });
  }
  return issues;
}

/** IFSC: 4-letter bank code, a literal 0, then a 6-char branch code. */
export const ifscSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Must be a valid 11-character IFSC (e.g. HDFC0001234)');

/** Indian bank account numbers are 9–18 digits. */
export const bankAccountSchema = z
  .string()
  .trim()
  .regex(/^\d{9,18}$/, 'Account number must be 9–18 digits');

/**
 * Drug licence numbers vary by state (e.g. "KA-B23-20B-123456", "20B/MH/2024/1234").
 * Accept the common alphabet and require at least one digit.
 */
export const drugLicenceNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(4, 'Licence number is too short')
  .max(60)
  .regex(/^[A-Z0-9][A-Z0-9/\-. ]*$/, 'Use letters, digits, "/", "-" or "."')
  .refine((v) => /\d/.test(v), 'Licence number must contain digits');

/** UPI/NEFT/RTGS reference (UTR): 12–22 alphanumerics. */
export const utrSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{12,22}$/, 'UTR must be 12–22 letters or digits');

/** Cheque numbers in India are 6 digits (MICR band). */
export const chequeNumberSchema = z.string().trim().regex(/^\d{6}$/, 'Cheque number must be 6 digits');

/** Quantity strictly greater than zero (sale/adjust/transfer). */
export const positiveQuantitySchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Must be a quantity like "10" or "10.5"')
  .refine((v) => Number(v) > 0, 'Quantity must be greater than zero');

/** Whole units, at least 1 (strips, bottles, packs). */
export const wholeQuantitySchema = z.string().regex(/^[1-9]\d{0,11}$/, 'Must be a whole number of at least 1');

/** Positive money amount as a decimal string. */
export const positiveAmountSchema = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, 'Enter an amount like 250 or 250.50')
  .refine((v) => Number(v) > 0, 'Amount must be greater than zero');

/** Strings, numbers or decimal objects (e.g. Prisma.Decimal) that print as a number. */
export type NumericLike = string | number | { toString(): string } | null | undefined;

const asNumber = (v: NumericLike): number | null => {
  if (v === null || v === undefined) return null;
  const text = typeof v === 'number' ? String(v) : v.toString();
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/** MRP ≥ selling price ≥ purchase price (Legal Metrology: never sell above MRP). */
export function priceLadderIssues(input: {
  mrp?: NumericLike;
  sellingPrice?: NumericLike;
  purchasePrice?: NumericLike;
  tradePrice?: NumericLike;
}): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const mrp = asNumber(input.mrp);
  const selling = asNumber(input.sellingPrice);
  const purchase = asNumber(input.purchasePrice);
  const trade = asNumber(input.tradePrice);
  for (const [field, value] of [
    ['mrp', mrp],
    ['sellingPrice', selling],
    ['purchasePrice', purchase],
    ['tradePrice', trade],
  ] as const) {
    if (value !== null && value < 0) issues.push({ field, message: 'Price cannot be negative' });
  }
  if (mrp !== null && selling !== null && selling > mrp) {
    issues.push({ field: 'sellingPrice', message: `Selling price cannot exceed MRP (₹${mrp.toFixed(2)})` });
  }
  if (mrp !== null && purchase !== null && purchase > mrp) {
    issues.push({ field: 'purchasePrice', message: `Purchase price cannot exceed MRP (₹${mrp.toFixed(2)})` });
  }
  if (selling !== null && purchase !== null && purchase > selling) {
    issues.push({ field: 'purchasePrice', message: 'Purchase price is above the selling price — every sale would be a loss' });
  }
  return issues;
}

const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

/** Manufacture must precede expiry and cannot be in the future. */
export function batchDateIssues(input: {
  expiryDate?: string | null;
  manufacturingDate?: string | null;
  requireFutureExpiry?: boolean;
}): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const today = todayIsoDate();
  if (input.manufacturingDate && input.manufacturingDate > today) {
    issues.push({ field: 'manufacturingDate', message: 'Manufacturing date cannot be in the future' });
  }
  if (input.expiryDate && input.manufacturingDate && input.expiryDate <= input.manufacturingDate) {
    issues.push({ field: 'expiryDate', message: 'Expiry must be after the manufacturing date' });
  }
  if (input.requireFutureExpiry && input.expiryDate && input.expiryDate <= today) {
    issues.push({ field: 'expiryDate', message: 'This batch has already expired' });
  }
  return issues;
}

/** Days from today until an ISO date (negative when past). */
export function daysUntil(isoDate: string): number {
  const target = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${todayIsoDate()}T00:00:00Z`);
  return Math.round((target - today) / 86_400_000);
}

/** Indian financial year label for a date, e.g. 2026-10-27 → "FY 2026-27". */
export function financialYearOf(isoDate: string, startMonth = 4): { label: string; from: string; to: string } {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = `${startYear}-${pad(startMonth)}-01`;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return {
    label: startMonth === 1 ? `FY ${startYear}` : `FY ${startYear}-${String(endYear).slice(2)}`,
    from,
    to: `${endYear}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

/** GST slab consistency: intra-state CGST = SGST, inter-state IGST = CGST + SGST. */
export function gstSplitIssues(input: {
  cgstPercent?: string | null;
  sgstPercent?: string | null;
  igstPercent?: string | null;
}): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const cgst = asNumber(input.cgstPercent);
  const sgst = asNumber(input.sgstPercent);
  const igst = asNumber(input.igstPercent);
  if (cgst !== null && sgst !== null && Math.abs(cgst - sgst) > 0.0001) {
    issues.push({ field: 'sgstPercent', message: 'SGST must equal CGST' });
  }
  if (cgst !== null && sgst !== null && igst !== null && Math.abs(igst - (cgst + sgst)) > 0.0001) {
    issues.push({ field: 'igstPercent', message: `IGST must equal CGST + SGST (${(cgst + sgst).toFixed(2)}%)` });
  }
  for (const [field, value] of [
    ['cgstPercent', cgst],
    ['sgstPercent', sgst],
    ['igstPercent', igst],
  ] as const) {
    if (value !== null && (value < 0 || value > 28)) issues.push({ field, message: 'GST rate must be between 0% and 28%' });
  }
  return issues;
}

/** Turns a Zod error into `{ field: message }` (first message per field). */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function issuesToRecord(issues: FieldIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) if (!(issue.field in out)) out[issue.field] = issue.message;
  return out;
}
