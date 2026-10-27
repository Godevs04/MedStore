import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_BASE, api, bootTestServer, registerOrg, type TestUser } from './harness.js';

let owner: TestUser;
let warehouseId: string;
let productId: string;
let substituteId: string;
let customerId: string;

const futureDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

type Invoice = { id: string; invoiceNumber: string; status: string; total: string };

async function sell(body: Record<string, unknown> = {}) {
  return api<{ invoice: Invoice }>({
    path: '/api/v1/sales/invoices',
    method: 'POST',
    user: owner,
    body: {
      warehouseId,
      lines: [{ productId, quantity: '2', unitPrice: '40.00' }],
      payments: [{ method: 'CASH', amount: '80.00' }],
      ...body,
    },
  });
}

async function onHand(id: string): Promise<number> {
  const res = await api<{ items: Array<{ id: string; onHand: number }> }>({
    path: `/api/v1/catalog/products?search=SELL&stockWarehouseId=${warehouseId}&pageSize=50`,
    user: owner,
  });
  return res.body.items.find((p) => p.id === id)!.onHand;
}

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg();
  await api({
    path: '/api/v1/organizations',
    method: 'PATCH',
    user: owner,
    body: { addressLine1: '5 Station Road', city: 'Pune', stateCode: '27', pinCode: '411001', gstRegistrationStatus: 'REGULAR', gstin: '27AAPFU0939F1ZV' },
  });
  const branches = await api<Array<{ id: string }>>({ path: '/api/v1/organizations/branches', user: owner });
  const wh = await api<{ id: string }>({
    path: `/api/v1/organizations/branches/${branches.body[0]!.id}/warehouses`,
    method: 'POST',
    user: owner,
    body: { name: 'Sell Store', isDefault: true },
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
    body: { name: 'Sellamol 500', sku: 'SELL-500', genericName: 'Paracetamol', strength: '500 mg', hsnCode: '3004', mrp: '40.00', sellingPrice: '40.00' },
  });
  productId = product.body.id;
  const sub = await api<{ id: string }>({
    path: '/api/v1/catalog/products',
    method: 'POST',
    user: owner,
    body: { name: 'Sellagen 500', sku: 'SELL-501', genericName: 'paracetamol', strength: '500mg', hsnCode: '3004', mrp: '35.00', sellingPrice: '32.00' },
  });
  substituteId = sub.body.id;
  for (const id of [productId, substituteId]) {
    await api({
      path: '/api/v1/inventory/batches',
      method: 'POST',
      user: owner,
      body: { productId: id, warehouseId, batchNumber: `S${id.slice(0, 6).toUpperCase()}`, expiryDate: futureDate(300), quantity: '50', purchaseRate: '20.00', mrp: '40.00' },
    });
  }
  const customer = await api<{ id: string }>({
    path: '/api/v1/partners/customers',
    method: 'POST',
    user: owner,
    body: { name: 'Sell Clinic', phone: '9822012345', creditLimit: '5000.00' },
  });
  customerId = customer.body.id;
});

describe('product stock and substitutes', () => {
  it('adds saleable on-hand per product when a warehouse is given', async () => {
    expect(await onHand(productId)).toBe(50);
  });

  it('lists same-generic products ignoring case and spacing in strength', async () => {
    const res = await api<{ generic: string; items: Array<{ id: string; sameStrength: boolean; onHand: number }> }>({
      path: `/api/v1/catalog/products/${productId}/substitutes?warehouseId=${warehouseId}`,
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body.generic).toBe('Paracetamol');
    const hit = res.body.items.find((i) => i.id === substituteId)!;
    expect(hit.sameStrength).toBe(true);
    expect(hit.onHand).toBe(50);
    expect(res.body.items.some((i) => i.id === productId)).toBe(false);
  });
});

describe('sales history filters and summary', () => {
  let creditInvoice: Invoice;

  beforeAll(async () => {
    await sell();
    const credit = await sell({ customerId, payments: [{ method: 'UPI', amount: '30.00' }, { method: 'CREDIT', amount: '50.00' }] });
    creditInvoice = credit.body.invoice;
  });

  it('filters by payment method and open credit', async () => {
    const upi = await api<{ items: Invoice[] }>({ path: '/api/v1/sales/invoices?paymentMethod=UPI', user: owner });
    expect(upi.body.items.map((i) => i.id)).toEqual([creditInvoice.id]);
    const credit = await api<{ items: Invoice[] }>({ path: '/api/v1/sales/invoices?hasCredit=true', user: owner });
    expect(credit.body.items.map((i) => i.id)).toEqual([creditInvoice.id]);
  });

  it('sorts by total and rejects unknown sort fields', async () => {
    const sorted = await api<{ items: Invoice[] }>({ path: '/api/v1/sales/invoices?sortBy=total&sortDirection=asc', user: owner });
    expect(sorted.status).toBe(200);
    const bad = await api({ path: '/api/v1/sales/invoices?sortBy=costOfGoods', user: owner });
    expect(bad.status).toBe(400);
  });

  it('summarises invoices for the active filters', async () => {
    const res = await api<{ invoices: number; gross: string; creditOutstanding: string; averageBill: string }>({ path: '/api/v1/sales/invoices/summary', user: owner });
    expect(res.status).toBe(200);
    expect(res.body.invoices).toBeGreaterThanOrEqual(2);
    expect(res.body.creditOutstanding).toBe('50.00');
  });
});

describe('sales exports', () => {
  it('exports filtered invoices and returns as CSV', async () => {
    const headers = { Cookie: owner.cookie, 'x-organization-id': owner.organizationId };
    const inv = await fetch(`${TEST_BASE}/api/v1/sales/invoices/export?hasCredit=true`, { headers });
    expect(inv.status).toBe(200);
    expect(inv.headers.get('content-type')).toContain('text/csv');
    const text = await inv.text();
    expect(text).toContain('Credit open');
    expect(text.trim().split('\r\n')).toHaveLength(2);
    const ret = await fetch(`${TEST_BASE}/api/v1/sales/returns/export`, { headers });
    expect(ret.status).toBe(200);
  });
});

describe('invoice cancellation', () => {
  it('requires a reason', async () => {
    const sale = await sell();
    const res = await api({ path: `/api/v1/sales/invoices/${sale.body.invoice.id}/cancel`, method: 'POST', user: owner, body: { reason: 'no' } });
    expect(res.status).toBe(400);
  });

  it('cancels an untouched invoice, restores stock and reverses the journal', async () => {
    const before = await onHand(productId);
    const sale = await sell();
    expect(await onHand(productId)).toBe(before - 2);
    const res = await api<{ status: string; cancelReason: string }>({
      path: `/api/v1/sales/invoices/${sale.body.invoice.id}/cancel`,
      method: 'POST',
      user: owner,
      body: { reason: 'Billed to the wrong patient' },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.cancelReason).toBe('Billed to the wrong patient');
    expect(await onHand(productId)).toBe(before);

    const again = await api({ path: `/api/v1/sales/invoices/${sale.body.invoice.id}/cancel`, method: 'POST', user: owner, body: { reason: 'Second attempt here' } });
    expect(again.status).toBe(409);
  });

  it('refuses invoices that already have a return', async () => {
    const sale = await sell();
    const detail = await api<{ lines: Array<{ id: string }> }>({ path: `/api/v1/sales/invoices/${sale.body.invoice.id}`, user: owner });
    await api({
      path: '/api/v1/sales/returns',
      method: 'POST',
      user: owner,
      body: { invoiceId: sale.body.invoice.id, reason: 'Wrong strength', lines: [{ invoiceLineId: detail.body.lines[0]!.id, quantity: '1', restock: true }] },
    });
    const res = await api({ path: `/api/v1/sales/invoices/${sale.body.invoice.id}/cancel`, method: 'POST', user: owner, body: { reason: 'Customer changed mind' } });
    expect(res.status).toBe(409);
  });
});

describe('returns filters', () => {
  it('searches returns by reason', async () => {
    const res = await api<{ items: Array<{ reason: string }> }>({ path: '/api/v1/sales/returns?search=strength', user: owner });
    expect(res.status).toBe(200);
    expect(res.body.items.every((r) => r.reason.toLowerCase().includes('strength'))).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});

describe('held bills', () => {
  it('holds, lists and discards a bill', async () => {
    const held = await api<{ id: string; label: string }>({
      path: '/api/v1/sales/held-bills',
      method: 'POST',
      user: owner,
      body: { label: 'Mr Sharma', itemCount: 2, total: '80.00', payload: { lines: [{ productId, quantity: '2' }] } },
    });
    expect(held.status).toBe(201);
    const list = await api<Array<{ id: string }>>({ path: '/api/v1/sales/held-bills', user: owner });
    expect(list.body.some((b) => b.id === held.body.id)).toBe(true);
    const del = await api({ path: `/api/v1/sales/held-bills/${held.body.id}`, method: 'DELETE', user: owner });
    expect(del.status).toBe(204);
    const missing = await api({ path: `/api/v1/sales/held-bills/${held.body.id}`, method: 'DELETE', user: owner });
    expect(missing.status).toBe(404);
  });

  it('rejects an empty label', async () => {
    const res = await api<{ error: { details: Array<{ field: string }> } }>({
      path: '/api/v1/sales/held-bills',
      method: 'POST',
      user: owner,
      body: { label: ' ', itemCount: 1, total: '10.00', payload: {} },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toContain('label');
  });
});

describe('dashboard and report additions', () => {
  it('returns a zero-filled trend and top products', async () => {
    const res = await api<{ days: Array<{ date: string }>; topProducts: Array<{ productId: string }> }>({ path: '/api/v1/reports/dashboard/trend?days=7', user: owner });
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.topProducts[0]?.productId).toBe(productId);
  });

  it('reports the payment mix with shares', async () => {
    const res = await api<{ methods: Array<{ method: string; share: number }> }>({ path: '/api/v1/reports/payment-mix', user: owner });
    expect(res.status).toBe(200);
    const methods = res.body.methods.map((m) => m.method);
    expect(methods).toEqual(expect.arrayContaining(['CASH', 'UPI', 'CREDIT']));
    expect(Math.round(res.body.methods.reduce((s, m) => s + m.share, 0))).toBe(100);
  });

  it('rejects an inverted date range', async () => {
    const res = await api({ path: '/api/v1/reports/payment-mix?from=2026-10-10&to=2026-10-01', user: owner });
    expect(res.status).toBe(400);
  });

  it('values stock by days to expiry', async () => {
    const res = await api<{ buckets: Array<{ key: string; batches: number }>; totalCost: string }>({ path: '/api/v1/reports/expiry-value', user: owner });
    expect(res.status).toBe(200);
    expect(res.body.buckets.map((b) => b.key)).toEqual(['EXPIRED', 'D0_30', 'D31_60', 'D61_90', 'D91_180']);
  });
});
