import { divideHalfUp, formatMinorUnits } from '@medicore/shared-types';

/** Decimal-like inputs: API strings, Prisma Decimal, or numbers (formatted, never multiplied as floats). */
export type Num = string | number | { toFixed(dp: number): string };

function asString(v: Num, dp: number): string {
  return typeof v === 'string' ? v.trim() : v.toFixed(dp);
}

/** Parses a decimal into an integer scaled by 10^dp with HALF_UP on the remainder. */
export function scaled(v: Num, dp: number): bigint {
  const s = asString(v, dp);
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Invalid decimal: "${s}"`);
  const frac = m[3] ?? '';
  let n = BigInt(m[2] + frac.slice(0, dp).padEnd(dp, '0'));
  const rest = frac.slice(dp);
  if (rest.length > 0 && Number(rest[0]) >= 5) n += 1n;
  return m[1] ? -n : n;
}

export const toPaise = (v: Num): bigint => scaled(v, 2);
export const major = (paise: bigint): string => formatMinorUnits(paise);

/** rate (≤4 dp) × quantity (≤3 dp) → paise, HALF_UP. */
export function amountPaise(rate: Num, qty: Num): bigint {
  return divideHalfUp(scaled(rate, 4) * scaled(qty, 3), 100_000n);
}

/** total × part / whole (quantities ≤3 dp), HALF_UP — used for proportional reversals. */
export function prorate(totalPaise: bigint, part: Num, whole: Num): bigint {
  const w = scaled(whole, 3);
  if (w === 0n) return 0n;
  return divideHalfUp(totalPaise * scaled(part, 3), w);
}

/** Quantity comparisons on 3-dp integers. */
export const qty3 = (v: Num): bigint => scaled(v, 3);
export const qtyStr = (milli: bigint): string => {
  const neg = milli < 0n;
  const abs = neg ? -milli : milli;
  return `${neg ? '-' : ''}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`;
};
