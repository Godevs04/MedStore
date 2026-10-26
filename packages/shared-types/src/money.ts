/**
 * Money and quantity primitives.
 *
 * Rule (spec §1.29, §17): no binary floating point as the source of
 * financial truth. All monetary amounts cross the API as strings in
 * major units (e.g. "123.45") and are computed here on integer minor
 * units (paise) with deterministic HALF_UP rounding.
 */

export const INR_CURRENCY = 'INR';
export const PAISE_PER_RUPEE = 100n;

/** Parse a decimal string like "123.45" or "123" into integer paise. Throws on invalid input. */
export function parseMinorUnits(value: string, currency = INR_CURRENCY): bigint {
  if (currency !== INR_CURRENCY) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
  const trimmed = value.trim();
  if (!/^-?\d{1,15}(\.\d{1,4})?$/.test(trimmed)) {
    throw new Error(`Invalid decimal string: "${value}"`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fracRaw = ''] = unsigned.split('.');
  let paise = BigInt(whole!) * PAISE_PER_RUPEE;
  // up to 4 fractional digits: paise take first two, rest round HALF_UP
  const frac4 = (fracRaw + '0000').slice(0, 4);
  const wholePaise = Number(frac4.slice(0, 2));
  const rest = frac4.slice(2);
  paise += BigInt(wholePaise);
  if (rest.length > 0) {
    const restNum = Number(rest);
    const divisor = 10 ** rest.length;
    if (restNum * 2 >= divisor) paise += 1n; // HALF_UP on the sub-paise remainder
  }
  return negative ? -paise : paise;
}

/** Format integer minor units back to a decimal string with 2 places. */
export function formatMinorUnits(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const rupees = abs / PAISE_PER_RUPEE;
  const paise = abs % PAISE_PER_RUPEE;
  const body = `${rupees}.${paise.toString().padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/** Multiply minor units by a rational rate (e.g. 18% = 18 / 100) with HALF_UP rounding. */
export function multiplyByRate(minor: bigint, ratePercent: string): bigint {
  const rate = parseMinorUnits(ratePercent); // rate expressed like "18.00" percent
  const numerator = minor * rate;
  const denominator = 100n * PAISE_PER_RUPEE; // rate was in hundredths of a percent of paise
  return divideHalfUp(numerator, denominator);
}

/** Deterministic HALF_UP integer division for positive and negative values. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const up = r * 2n >= d;
  const result = up ? q + 1n : q;
  return negative ? -result : result;
}

/** Sum a list of minor-unit amounts. */
export function sumMinor(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/**
 * Indian-numbering format: 12,34,567.89 (lakh/crore grouping).
 * Accepts a decimal string (as returned by formatMinorUnits).
 */
export function formatIndianNumbering(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, frac] = unsigned.split('.');
  let grouped: string;
  if (whole!.length <= 3) {
    grouped = whole!;
  } else {
    const last3 = whole!.slice(-3);
    let rest = whole!.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) parts.unshift(rest);
    grouped = `${parts.join(',')},${last3}`;
  }
  const body = frac ? `${grouped}.${frac}` : grouped;
  return negative ? `-${body}` : body;
}
