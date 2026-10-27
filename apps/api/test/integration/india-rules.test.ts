import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_BASE, api, bootTestServer, registerOrg, type TestUser } from './harness.js';

let owner: TestUser;
let warehouseId: string;
let productId: string;

const futureDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

type ErrorBody = { error: { code: string; details?: Array<{ field?: string; message: string }> } };
const fieldsOf = (body: unknown) => ((body as ErrorBody).error.details ?? []).map((d) => d.field);

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg();
  const branches = await api<Array<{ id: string }>>({ path: '/api/v1/organizations/branches', user: owner });
  const wh = await api<{ id: string }>({
    path: `/api/v1/organizations/branches/${branches.body[0]!.id}/warehouses`,
    method: 'POST',
    user: owner,
    body: { name: 'Rules Warehouse', isDefault: true },
  });
  warehouseId = wh.body.id;
  const product = await api<{ id: string }>({
    path: '/api/v1/catalog/products',
    method: 'POST',
    user: owner,
    body: { name: 'Rules Test Tablet', sku: 'RULE-1', hsnCode: '3004', mrp: '50.00', sellingPrice: '45.00', purchasePrice: '30.00' },
  });
  productId = product.body.id;
});

describe('organization profile validation', () => {
  it('rejects malformed GSTIN, PAN, PIN and phone values', async () => {
    const res = await api({
      path: '/api/v1/organizations',
      method: 'PATCH',
      user: owner,
      body: { gstin: '27BAD', pan: 'ABC', pinCode: '012345', contactPhone: '12345' },
    });
    expect(res.status).toBe(400);
    expect(fieldsOf(res.body)).toEqual(expect.arrayContaining(['gstin', 'pan', 'pinCode', 'contactPhone']));
  });

  it('rejects a GSTIN whose state prefix differs from the saved state', async () => {
    await api({ path: '/api/v1/organizations', method: 'PATCH', user: owner, body: { stateCode: '29', gstin: null, pan: null } });
    const res = await api({ path: '/api/v1/organizations', method: 'PATCH', user: owner, body: { gstin: '27AAPFU0939F1ZV' } });
    expect(res.status).toBe(400);
    expect(fieldsOf(res.body)).toContain('stateCode');
  });

  it('rejects a PAN that is not embedded in the GSTIN and accepts a consistent profile', async () => {
    const bad = await api({
      path: '/api/v1/organizations',
      method: 'PATCH',
      user: owner,
      body: { stateCode: '27', gstin: '27AAPFU0939F1ZV', pan: 'ABCDE1234F' },
    });
    expect(bad.status).toBe(400);
    expect(fieldsOf(bad.body)).toContain('pan');
    const ok = await api<{ gstin: string; pan: string }>({
      path: '/api/v1/organizations',
      method: 'PATCH',
      user: owner,
      body: { stateCode: '27', gstin: '27aapfu0939f1zv', pan: 'AAPFU0939F', pinCode: '' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F' });
  });

  it('validates typed settings while keeping custom keys', async () => {
    const bad = await api({ path: '/api/v1/organizations/settings', method: 'PATCH', user: owner, body: { upiId: 'not-a-upi' } });
    expect(bad.status).toBe(400);
    const ok = await api<Record<string, unknown>>({
      path: '/api/v1/organizations/settings',
      method: 'PATCH',
      user: owner,
      body: { upiId: 'rules@okhdfc', receiptFooter: 'Thank you' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ upiId: 'rules@okhdfc', receiptFooter: 'Thank you' });
  });
});

describe('pricing rules', () => {
  it('rejects a selling price above MRP on create', async () => {
    const res = await api({
      path: '/api/v1/catalog/products',
      method: 'POST',
      user: owner,
      body: { name: 'Overpriced Syrup', sku: 'RULE-2', mrp: '100.00', sellingPrice: '120.00' },
    });
    expect(res.status).toBe(400);
    expect(fieldsOf(res.body)).toContain('sellingPrice');
  });

  it('checks updates against the stored prices', async () => {
    const res = await api({ path: `/api/v1/catalog/products/${productId}`, method: 'PUT', user: owner, body: { purchasePrice: '60.00' } });
    expect(res.status).toBe(400);
    expect(fieldsOf(res.body)).toContain('purchasePrice');
  });

  it('filters products by prescription class', async () => {
    await api({ path: '/api/v1/catalog/products', method: 'POST', user: owner, body: { name: 'Rules H1 Capsule', sku: 'RULE-H1', prescriptionClass: 'SCHEDULE_H1' } });
    const res = await api<{ items: Array<{ prescriptionClass: string }> }>({
      path: '/api/v1/catalog/products?prescriptionClass=SCHEDULE_H1',
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((p) => p.prescriptionClass === 'SCHEDULE_H1')).toBe(true);
  });
});

describe('vendor GSTIN/PAN consistency', () => {
  it('rejects a vendor PAN that does not match its GSTIN', async () => {
    const res = await api({
      path: '/api/v1/partners/vendors',
      method: 'POST',
      user: owner,
      body: { legalName: 'Mismatch Pharma', gstin: '27AAPFU0939F1ZV', stateCode: '27', pan: 'ABCDE1234F' },
    });
    expect(res.status).toBe(400);
    expect(fieldsOf(res.body)).toContain('pan');
  });
});

describe('batch and stock rules', () => {
  it('rejects a manufacturing date after expiry and an MRP below cost', async () => {
    const res = await api({
      path: '/api/v1/inventory/batches',
      method: 'POST',
      user: owner,
      body: {
        productId,
        warehouseId,
        batchNumber: 'RULE-B1',
        manufacturingDate: futureDate(-10),
        expiryDate: futureDate(-20),
        quantity: '10',
        purchaseRate: '40.00',
        mrp: '30.00',
      },
    });
    expect(res.status).toBe(400);
    expect(fieldsOf(res.body)).toEqual(expect.arrayContaining(['expiryDate', 'purchaseRate']));
  });

  it('rejects zero-quantity adjustments and "Other" without notes', async () => {
    const batch = await api<{ id: string }>({
      path: '/api/v1/inventory/batches',
      method: 'POST',
      user: owner,
      body: { productId, warehouseId, batchNumber: 'RULE-B2', expiryDate: futureDate(200), quantity: '10', purchaseRate: '30.00', mrp: '50.00' },
    });
    const zero = await api({
      path: '/api/v1/inventory/adjustments',
      method: 'POST',
      user: owner,
      body: { batchId: batch.body.id, warehouseId, direction: 'OUT', quantity: '0', reason: 'DAMAGE' },
    });
    expect(zero.status).toBe(400);
    const other = await api({
      path: '/api/v1/inventory/adjustments',
      method: 'POST',
      user: owner,
      body: { batchId: batch.body.id, warehouseId, direction: 'OUT', quantity: '1', reason: 'OTHER' },
    });
    expect(other.status).toBe(400);
    expect(fieldsOf(other.body)).toContain('notes');

    const filtered = await api<{ items: unknown[] }>({ path: '/api/v1/inventory/ledger?movementType=OPENING_STOCK&direction=IN', user: owner });
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.length).toBeGreaterThan(0);
    const badFilter = await api({ path: '/api/v1/inventory/ledger?movementType=NOPE', user: owner });
    expect(badFilter.status).toBe(400);
  });
});

describe('audit log filters', () => {
  it('filters, lists options and exports CSV', async () => {
    const filtered = await api<{ items: Array<{ event: string }> }>({ path: '/api/v1/audit?event=PRODUCT_CREATED', user: owner });
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.length).toBeGreaterThan(0);
    expect(filtered.body.items.every((e) => e.event === 'PRODUCT_CREATED')).toBe(true);

    const options = await api<{ events: string[] }>({ path: '/api/v1/audit/filters', user: owner });
    expect(options.body.events).toContain('PRODUCT_CREATED');

    const csv = await fetch(`${TEST_BASE}/api/v1/audit/export?event=PRODUCT_CREATED`, {
      headers: { Cookie: owner.cookie, 'x-organization-id': owner.organizationId },
    });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('PRODUCT_CREATED');
  });
});
