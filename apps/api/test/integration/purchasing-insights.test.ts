import { beforeAll, describe, expect, it } from 'vitest';
import { api, bootTestServer, registerOrg, type TestUser } from './harness.js';

let owner: TestUser;
let warehouseId: string;
let productId: string;
let vendorId: string;
let otherVendorId: string;

const futureDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

type Suggestion = { productId: string; onHand: number; onOrder: number; suggestedQty: number; vendorId: string | null; lastRate: string | null };

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg();
  await api({
    path: '/api/v1/organizations',
    method: 'PATCH',
    user: owner,
    body: { addressLine1: '1 Ring Road', city: 'Pune', stateCode: '27', pinCode: '411001', gstRegistrationStatus: 'REGULAR', gstin: '27AAPFU0939F1ZV' },
  });
  const branches = await api<Array<{ id: string }>>({ path: '/api/v1/organizations/branches', user: owner });
  const wh = await api<{ id: string }>({
    path: `/api/v1/organizations/branches/${branches.body[0]!.id}/warehouses`,
    method: 'POST',
    user: owner,
    body: { name: 'Buy Store', isDefault: true },
  });
  warehouseId = wh.body.id;
  await api({ path: '/api/v1/organizations/setup-complete', method: 'POST', user: owner });
  await api({
    path: '/api/v1/catalog/tax-rates',
    method: 'POST',
    user: owner,
    body: { hsnCode: '3004', description: '12% slab', cgstPercent: '6.00', sgstPercent: '6.00', igstPercent: '12.00', effectiveFrom: '2025-09-22' },
  });
  const product = await api<{ id: string }>({
    path: '/api/v1/catalog/products',
    method: 'POST',
    user: owner,
    body: { name: 'Reordex 10', sku: 'REO-10', hsnCode: '3004', mrp: '20.00', sellingPrice: '20.00', purchasePrice: '12.00', reorderLevel: 20, maxStockLevel: 100, minOrderQuantity: 10 },
  });
  productId = product.body.id;
  await api({
    path: '/api/v1/inventory/batches',
    method: 'POST',
    user: owner,
    body: { productId, warehouseId, batchNumber: 'RO1', expiryDate: futureDate(500), quantity: '5', purchaseRate: '12.00', mrp: '20.00' },
  });
  const vendor = await api<{ id: string }>({ path: '/api/v1/partners/vendors', method: 'POST', user: owner, body: { legalName: 'Reorder Pharma', stateCode: '27', creditDays: 0 } });
  vendorId = vendor.body.id;
  const other = await api<{ id: string }>({ path: '/api/v1/partners/vendors', method: 'POST', user: owner, body: { legalName: 'Other Pharma', stateCode: '27' } });
  otherVendorId = other.body.id;
  const bill = await api({
    path: '/api/v1/purchasing/invoices',
    method: 'POST',
    user: owner,
    body: { vendorId, invoiceNumber: 'RP/77', invoiceDate: new Date().toISOString().slice(0, 10), lines: [{ productId, quantity: '10', unitCost: '11.50' }] },
  });
  expect(bill.status).toBe(201);
});

describe('duplicate supplier bill check', () => {
  it('matches the same number from the same vendor ignoring case', async () => {
    const res = await api<{ duplicate: boolean; invoice: { invoiceNumber: string } | null }>({
      path: `/api/v1/purchasing/invoices/check-duplicate?vendorId=${vendorId}&invoiceNumber=rp%2F77`,
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(res.body.invoice?.invoiceNumber).toBe('RP/77');
  });

  it('does not flag the same number from another vendor', async () => {
    const res = await api<{ duplicate: boolean }>({
      path: `/api/v1/purchasing/invoices/check-duplicate?vendorId=${otherVendorId}&invoiceNumber=RP%2F77`,
      user: owner,
    });
    expect(res.body.duplicate).toBe(false);
  });

  it('requires a vendor', async () => {
    const res = await api({ path: '/api/v1/purchasing/invoices/check-duplicate?invoiceNumber=X1', user: owner });
    expect(res.status).toBe(400);
  });
});

describe('purchasing summary and filters', () => {
  it('reports payables and this month’s purchases', async () => {
    const res = await api<{ payable: string; overdue: string; monthInvoices: number; monthPurchases: string; awaitingBill: number }>({
      path: '/api/v1/purchasing/summary',
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body.monthInvoices).toBe(1);
    expect(Number(res.body.payable)).toBeCloseTo(128.8, 2);
    expect(res.body.monthPurchases).toBe(res.body.payable);
  });

  it('searches invoices by number and rejects malformed status filters', async () => {
    const hit = await api<{ items: unknown[] }>({ path: '/api/v1/purchasing/invoices?search=rp/7', user: owner });
    expect(hit.body.items).toHaveLength(1);
    const miss = await api<{ items: unknown[] }>({ path: `/api/v1/purchasing/invoices?vendorId=${otherVendorId}`, user: owner });
    expect(miss.body.items).toHaveLength(0);
    const bad = await api({ path: '/api/v1/purchasing/purchase-orders?status=sent', user: owner });
    expect(bad.status).toBe(400);
  });

  it('fetches a single invoice by id for deep links', async () => {
    const all = await api<{ items: Array<{ id: string }> }>({ path: '/api/v1/purchasing/invoices', user: owner });
    const id = all.body.items[0]!.id;
    const one = await api<{ items: Array<{ id: string }>; pageInfo: { totalItems: number } }>({ path: `/api/v1/purchasing/invoices?id=${id}`, user: owner });
    expect(one.body.pageInfo.totalItems).toBe(1);
    expect(one.body.items[0]!.id).toBe(id);
    const bad = await api({ path: '/api/v1/purchasing/invoices?id=nope', user: owner });
    expect(bad.status).toBe(400);
  });
});

describe('reorder suggestions', () => {
  it('tops up to max stock, rounded to the minimum order quantity', async () => {
    const res = await api<{ items: Suggestion[] }>({ path: '/api/v1/purchasing/reorder-suggestions', user: owner });
    expect(res.status).toBe(200);
    const row = res.body.items.find((i) => i.productId === productId)!;
    expect(row).toMatchObject({ onHand: 5, onOrder: 0, suggestedQty: 100, vendorId, lastRate: '11.50' });
  });

  it('nets off quantities already on open purchase orders', async () => {
    const po = await api({
      path: '/api/v1/purchasing/purchase-orders',
      method: 'POST',
      user: owner,
      body: { vendorId, lines: [{ productId, quantity: '30', unitPrice: '11.50' }] },
    });
    expect(po.status).toBe(201);
    const res = await api<{ items: Suggestion[] }>({ path: '/api/v1/purchasing/reorder-suggestions', user: owner });
    const row = res.body.items.find((i) => i.productId === productId)!;
    expect(row.onOrder).toBe(30);
    expect(row.suggestedQty).toBe(70);
  });

  it('filters by vendor', async () => {
    const res = await api<{ items: Suggestion[] }>({ path: `/api/v1/purchasing/reorder-suggestions?vendorId=${otherVendorId}`, user: owner });
    expect(res.body.items.some((i) => i.productId === productId)).toBe(false);
  });
});

describe('product lookup by ids', () => {
  it('returns only the requested products with their resolved GST rate', async () => {
    const res = await api<{ items: Array<{ id: string; taxResolved: boolean; gstPercent: string | null }> }>({
      path: `/api/v1/catalog/products?page=1&pageSize=10&ids=${productId}`,
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: productId, taxResolved: true, gstPercent: '12' });
  });

  it('rejects a malformed id list', async () => {
    const res = await api({ path: '/api/v1/catalog/products?ids=not-an-id', user: owner });
    expect(res.status).toBe(400);
  });
});
