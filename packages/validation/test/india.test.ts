import { describe, expect, it } from 'vitest';
import {
  batchDateIssues,
  drugLicenceNumberSchema,
  financialYearOf,
  gstinIssues,
  gstSplitIssues,
  ifscSchema,
  isValidGstinChecksum,
  panFromGstin,
  positiveQuantitySchema,
  priceLadderIssues,
  utrSchema,
} from '../src/india.js';

describe('GSTIN rules', () => {
  it('accepts a GSTIN with a correct check digit', () => {
    expect(isValidGstinChecksum('27AAPFU0939F1ZV')).toBe(true);
  });

  it('rejects a GSTIN whose check digit is wrong', () => {
    expect(isValidGstinChecksum('27AAPFU0939F1ZA')).toBe(false);
  });

  it('extracts the embedded PAN', () => {
    expect(panFromGstin('27aapfu0939f1zv')).toBe('AAPFU0939F');
  });

  it('flags a state code that does not match the GSTIN prefix', () => {
    expect(gstinIssues({ gstin: '27AAPFU0939F1ZV', stateCode: '29' })).toEqual([
      expect.objectContaining({ field: 'stateCode' }),
    ]);
  });

  it('flags a PAN that differs from the GSTIN', () => {
    expect(gstinIssues({ gstin: '27AAPFU0939F1ZV', pan: 'ABCDE1234F' })).toEqual([expect.objectContaining({ field: 'pan' })]);
    expect(gstinIssues({ gstin: '27AAPFU0939F1ZV', stateCode: '27', pan: 'AAPFU0939F' })).toEqual([]);
  });
});

describe('banking and licence formats', () => {
  it('validates IFSC', () => {
    expect(ifscSchema.safeParse('hdfc0001234').success).toBe(true);
    expect(ifscSchema.safeParse('HDFC1001234').success).toBe(false);
  });

  it('validates UTR references', () => {
    expect(utrSchema.safeParse('HDFCN52022062512345').success).toBe(true);
    expect(utrSchema.safeParse('123').success).toBe(false);
  });

  it('requires digits in a drug licence number', () => {
    expect(drugLicenceNumberSchema.safeParse('KA-B23-20B-123456').success).toBe(true);
    expect(drugLicenceNumberSchema.safeParse('FORM-ABC').success).toBe(false);
  });
});

describe('pricing and stock rules', () => {
  it('enforces MRP ≥ selling ≥ purchase', () => {
    expect(priceLadderIssues({ mrp: '100', sellingPrice: '95', purchasePrice: '70' })).toEqual([]);
    expect(priceLadderIssues({ mrp: '100', sellingPrice: '120' })).toEqual([expect.objectContaining({ field: 'sellingPrice' })]);
    expect(priceLadderIssues({ sellingPrice: '50', purchasePrice: '60' })).toEqual([expect.objectContaining({ field: 'purchasePrice' })]);
  });

  it('requires expiry after manufacture', () => {
    expect(batchDateIssues({ manufacturingDate: '2026-01-01', expiryDate: '2025-12-31' })).toEqual([
      expect.objectContaining({ field: 'expiryDate' }),
    ]);
  });

  it('rejects zero quantities', () => {
    expect(positiveQuantitySchema.safeParse('0').success).toBe(false);
    expect(positiveQuantitySchema.safeParse('2.5').success).toBe(true);
  });

  it('checks GST split consistency', () => {
    expect(gstSplitIssues({ cgstPercent: '6', sgstPercent: '6', igstPercent: '12' })).toEqual([]);
    expect(gstSplitIssues({ cgstPercent: '6', sgstPercent: '9' })).toEqual([expect.objectContaining({ field: 'sgstPercent' })]);
  });

  it('labels the Indian financial year', () => {
    expect(financialYearOf('2026-10-27')).toEqual({ label: 'FY 2026-27', from: '2026-04-01', to: '2027-03-31' });
    expect(financialYearOf('2027-02-10').label).toBe('FY 2026-27');
  });
});
