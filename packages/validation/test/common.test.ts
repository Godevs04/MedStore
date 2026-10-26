import { describe, expect, it } from 'vitest';
import {
  calendarDateSchema,
  decimalStringSchema,
  gstinSchema,
  indianPhoneSchema,
  pinCodeSchema,
  quantitySchema,
} from '../src/common.js';
import { formatIndianNumbering, parseMinorUnits, formatMinorUnits, multiplyByRate, divideHalfUp } from '@medicore/shared-types';
import { productCreateSchema } from '../src/master-data.js';

describe('gstinSchema', () => {
  it('accepts a valid-format GSTIN', () => {
    expect(gstinSchema.safeParse('27ABCDE1234F1Z5').success).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(gstinSchema.safeParse('27ABCDE1234F1Z').success).toBe(false);
  });

  it('rejects lowercase without normalizing check (stores uppercase)', () => {
    const result = gstinSchema.parse('27abcde1234f1z5');
    expect(result).toBe('27ABCDE1234F1Z5');
  });
});

describe('indianPhoneSchema', () => {
  it.each(['9876543210', '+919876543210', '09876543210'])('accepts %s', (v) => {
    expect(indianPhoneSchema.safeParse(v).success).toBe(true);
  });

  it.each(['1234567890', '987654321', '98765432101'])('rejects %s', (v) => {
    expect(indianPhoneSchema.safeParse(v).success).toBe(false);
  });
});

describe('pinCodeSchema', () => {
  it('accepts 411001', () => expect(pinCodeSchema.safeParse('411001').success).toBe(true));
  it('rejects leading zero', () => expect(pinCodeSchema.safeParse('011001').success).toBe(false));
});

describe('calendarDateSchema', () => {
  it('rejects impossible dates', () => {
    expect(calendarDateSchema.safeParse('2025-02-30').success).toBe(false);
  });
  it('accepts real dates', () => {
    expect(calendarDateSchema.safeParse('2026-02-28').success).toBe(true);
  });
});

describe('decimalStringSchema / quantitySchema', () => {
  it('accepts decimal strings and rejects floats', () => {
    expect(decimalStringSchema.safeParse('123.45').success).toBe(true);
    expect(decimalStringSchema.safeParse(123.45).success).toBe(false);
  });
  it('quantity allows up to 3 decimals', () => {
    expect(quantitySchema.safeParse('10.5').success).toBe(true);
    expect(quantitySchema.safeParse('10.5000').success).toBe(false);
  });
});

describe('money helpers', () => {
  it('round-trips paise', () => {
    expect(formatMinorUnits(parseMinorUnits('123.45'))).toBe('123.45');
    expect(formatMinorUnits(parseMinorUnits('0.01'))).toBe('0.01');
  });

  it('HALF_UP rounds sub-paise', () => {
    // 100.555 → 100.56 (55555 paise? 100.555 → 10055.5 paise → 10056)
    expect(formatMinorUnits(parseMinorUnits('100.555'))).toBe('100.56');
  });

  it('multiplies by rate deterministically', () => {
    // 18% of 1000.00 = 180.00
    expect(multiplyByRate(parseMinorUnits('1000.00'), '18.00')).toBe(parseMinorUnits('180.00'));
    // 18% of 100.33 = 18.0594 → 18.06
    expect(multiplyByRate(parseMinorUnits('100.33'), '18.00')).toBe(parseMinorUnits('18.06'));
  });

  it('divides HALF_UP', () => {
    expect(divideHalfUp(5n, 2n)).toBe(3n);
    expect(divideHalfUp(-5n, 2n)).toBe(-3n);
  });
});

describe('formatIndianNumbering', () => {
  it('groups lakh/crore style', () => {
    expect(formatIndianNumbering('1234567.89')).toBe('12,34,567.89');
    expect(formatIndianNumbering('123456789.00')).toBe('12,34,56,789.00');
    expect(formatIndianNumbering('999.00')).toBe('999.00');
  });
});

describe('productCreateSchema', () => {
  const valid = {
    name: 'Paracetamol 500mg Tablet',
    sku: 'PARA-500',
    status: 'ACTIVE',
    barcodes: [],
  };

  it('accepts minimal product', () => {
    expect(productCreateSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects bad SKU characters', () => {
    expect(productCreateSchema.safeParse({ ...valid, sku: 'bad sku!' }).success).toBe(false);
  });
});
