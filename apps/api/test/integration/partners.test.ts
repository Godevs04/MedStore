import { beforeAll, describe, expect, it } from 'vitest';
import { api, bootTestServer, registerOrg, type TestUser } from './harness.js';

let owner: TestUser;
let warehouseId: string;
let productId: string;
let customerId: string;
let vendorId: string;

type ApiError = { error: { code: string; details?: Array<{ field: string; message: string }> } };
const fields = (body: unknown) => ((body as ApiError).error.details ?? []).map((d) => d.field);

const futureDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg();
  await api({
    path: '/api/v1/organizations',
    method: 'PATCH',
    user: owner,
    body: { addressLine1: '9 MG Road', city: 'Pune', stateCode: '27', pinCode: '411001', gstRegistrationStatus: 'REGULAR', gstin: '27AAPFU0939F1ZV' },
  });
  const branches = await api<Array<{ id: string }>>({ path: '/api/v1/organizations/branches', user: owner });
  const wh = await api<{ id: string }>({
    path: `/api/v1/organizations/branches/${branches.body[0]!.id}/warehouses`,
    method: 'POST',
    user: owner,
    body: { name: 'Partner Store', isDefault: true },
  });
  warehouseId = wh.body.id;
  await api({ path: '/api/v1/organizations/setup-complete', method: 'POST', user: owner });
  await api({
    path: '/api/v1/catalog/tax-rates',
    method: 'POST',
    user: owner,
    body: { hsnCode: '3004', description: '5% slab', cgstPercent: '2.50', sgstPercent: '2.50', igstPercent: '5.00', effectiveFrom: '2025-09-22' },
  });
  const product = await api<{ id: string }>({
    path: '/api/v1/catalog/products',
    method: 'POST',
    user: owner,
    body: { name: 'Partnerin 250', sku: 'PART-250', hsnCode: '3004', mrp: '50.00', sellingPrice: '50.00', purchasePrice: '30.00' },
  });
  productId = product.body.id;
  await api({
    path: '/api/v1/inventory/batches',
    method: 'POST',
    user: owner,
    body: { productId, warehouseId, batchNumber: 'PT001', expiryDate: futureDate(400), quantity: '40', purchaseRate: '30.00', mrp: '50.00' },
  });
  const customer = await api<{ id: string }>({
    path: '/api/v1/partners/customers',
    method: 'POST',
    user: owner,
    body: { name: 'Partner Clinic', phone: '9822033333', creditLimit: '5000.00', creditDays: 0, openingBalance: '100.00' },
  });
  customerId = customer.body.id;
});

describe('vendor licence, bank and GST checks', () => {
  it('stores drug licence and bank details', async () => {
    const res = await api<{ id: string; drugLicenceNumber: string; ifsc: string; drugLicenceExpiry: string }>({
      path: '/api/v1/partners/vendors',
      method: 'POST',
      user: owner,
      body: {
        legalName: 'Licensed Distributors',
        gstin: '27AAPFU0939F1ZV',
        pan: 'AAPFU0939F',
        stateCode: '27',
        drugLicenceNumber: 'mh-pune-20b-123456',
        drugLicenceExpiry: futureDate(365),
        bankAccount: '123456789012',
        ifsc: 'hdfc0001234',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.drugLicenceNumber).toBe('MH-PUNE-20B-123456');
    expect(res.body.ifsc).toBe('HDFC0001234');
    expect(res.body.drugLicenceExpiry.slice(0, 10)).toBe(futureDate(365));
    vendorId = res.body.id;
  });

  it('rejects a bad IFSC, an account without IFSC and a PAN that differs from the GSTIN', async () => {
    const badIfsc = await api({ path: '/api/v1/partners/vendors', method: 'POST', user: owner, body: { legalName: 'Bad IFSC', bankAccount: '123456789012', ifsc: 'HDFC1234' } });
    expect(badIfsc.status).toBe(400);
    expect(fields(badIfsc.body)).toContain('ifsc');

    const noIfsc = await api({ path: '/api/v1/partners/vendors', method: 'POST', user: owner, body: { legalName: 'No IFSC', bankAccount: '123456789012' } });
    expect(noIfsc.status).toBe(400);
    expect(fields(noIfsc.body)).toContain('ifsc');

    const pan = await api({ path: '/api/v1/partners/vendors', method: 'POST', user: owner, body: { legalName: 'PAN Mismatch', gstin: '27AAPFU0939F1ZV', stateCode: '27', pan: 'ABCDE1234F' } });
    expect(pan.status).toBe(400);
    expect(fields(pan.body)).toContain('pan');
  });

  it('rejects an unregistered supplier that has a GSTIN', async () => {
    const res = await api({
      path: '/api/v1/partners/vendors',
      method: 'POST',
      user: owner,
      body: { legalName: 'Confused Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', gstRegistrationType: 'UNREGISTERED' },
    });
    expect(res.status).toBe(400);
    expect(fields(res.body)).toContain('gstRegistrationType');
  });

  it('checks GSTIN against the merged record on update', async () => {
    const res = await api({ path: `/api/v1/partners/vendors/${vendorId}`, method: 'PUT', user: owner, body: { stateCode: '29' } });
    expect(res.status).toBe(400);
    expect(fields(res.body)).toContain('stateCode');
  });
});

describe('balances and top products', () => {
  beforeAll(async () => {
    const sale = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        warehouseId,
        customerId,
        lines: [{ productId, quantity: '3', unitPrice: '50.00' }],
        payments: [{ method: 'CASH', amount: '50.00' }, { method: 'CREDIT', amount: '100.00' }],
      },
    });
    expect(sale.status).toBe(201);
    const purchase = await api({
      path: '/api/v1/purchasing/invoices',
      method: 'POST',
      user: owner,
      body: {
        vendorId,
        invoiceNumber: 'LD/2026/77',
        invoiceDate: new Date().toISOString().slice(0, 10),
        lines: [{ productId, quantity: '10', freeQty: '1', unitCost: '30.00' }],
      },
    });
    expect(purchase.status).toBe(201);
  });

  it('adds outstanding to customers and filters wholesale correctly', async () => {
    const res = await api<{ items: Array<{ id: string; outstanding: string; overdue: string }> }>({
      path: '/api/v1/partners/customers?withBalances=true&isWholesale=false',
      user: owner,
    });
    expect(res.status).toBe(200);
    const row = res.body.items.find((c) => c.id === customerId)!;
    expect(row.outstanding).toBe('200.00');
    const wholesale = await api<{ items: unknown[] }>({ path: '/api/v1/partners/customers?isWholesale=true', user: owner });
    expect(wholesale.body.items).toHaveLength(0);
  });

  it('adds payable to vendors', async () => {
    const res = await api<{ items: Array<{ id: string; payable: string; openInvoices: number }> }>({
      path: '/api/v1/partners/vendors?withBalances=true',
      user: owner,
    });
    const row = res.body.items.find((v) => v.id === vendorId)!;
    expect(Number(row.payable)).toBeGreaterThan(300);
    expect(row.openInvoices).toBe(1);
  });

  it('ranks what a customer buys', async () => {
    const res = await api<Array<{ productId: string; quantity: string; value: string; bills: number }>>({
      path: `/api/v1/partners/customers/${customerId}/top-products`,
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ productId, quantity: '3.000', value: '150.00', bills: 1 });
  });

  it('lists products bought from a vendor with the last rate', async () => {
    const res = await api<Array<{ productId: string; quantity: string; freeQty: string; lastRate: string; invoices: number }>>({
      path: `/api/v1/partners/vendors/${vendorId}/products`,
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ productId, quantity: '10.000', freeQty: '1.000', lastRate: '30.00', invoices: 1 });
  });

  it('rejects an out-of-range limit', async () => {
    const res = await api({ path: `/api/v1/partners/customers/${customerId}/top-products?limit=500`, user: owner });
    expect(res.status).toBe(400);
  });
});
