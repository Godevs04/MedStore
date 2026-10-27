import { beforeAll, describe, expect, it } from 'vitest';
import { api, bootTestServer, registerOrg, TEST_BASE, type TestUser } from './harness.js';

let owner: TestUser;
let warehouseId: string;
let secondWarehouseId: string;
let productId: string;

const futureDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function batch(batchNumber: string, days: number, quantity = '10', rate = '10.00') {
  const res = await api<{ id: string }>({
    path: '/api/v1/inventory/batches',
    method: 'POST',
    user: owner,
    body: { productId, warehouseId, batchNumber, expiryDate: futureDate(days), quantity, purchaseRate: rate, mrp: '20.00' },
  });
  expect(res.status).toBe(201);
  return res.body.id;
}

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg();
  const branches = await api<Array<{ id: string }>>({ path: '/api/v1/organizations/branches', user: owner });
  const branchId = branches.body[0]!.id;
  const wh = await api<{ id: string }>({
    path: `/api/v1/organizations/branches/${branchId}/warehouses`,
    method: 'POST',
    user: owner,
    body: { name: 'Stock Main', isDefault: true },
  });
  warehouseId = wh.body.id;
  const wh2 = await api<{ id: string }>({ path: `/api/v1/organizations/branches/${branchId}/warehouses`, method: 'POST', user: owner, body: { name: 'Stock Back' } });
  secondWarehouseId = wh2.body.id;
  const product = await api<{ id: string }>({
    path: '/api/v1/catalog/products',
    method: 'POST',
    user: owner,
    body: { name: 'Stockwise 5', sku: 'STK-5', hsnCode: '3004', mrp: '20.00', sellingPrice: '18.00', purchasePrice: '10.00', reorderLevel: 100 },
  });
  productId = product.body.id;
});

describe('product history and reactivation', () => {
  it('records before/after values with the actor name', async () => {
    const upd = await api({ path: `/api/v1/catalog/products/${productId}`, method: 'PUT', user: owner, body: { sellingPrice: '19.00', rackLocation: 'A-1' } });
    expect(upd.status).toBe(200);
    const res = await api<{ items: Array<{ changeType: string; actorName: string | null; details: { changes?: Record<string, { from: unknown; to: unknown }> } }> }>({
      path: `/api/v1/catalog/products/${productId}/history`,
      user: owner,
    });
    expect(res.status).toBe(200);
    const update = res.body.items.find((i) => i.changeType === 'UPDATED')!;
    expect(update.actorName).toBeTruthy();
    expect(update.details.changes?.sellingPrice).toMatchObject({ to: '19.00' });
    expect(update.details.changes?.rackLocation).toMatchObject({ from: null, to: 'A-1' });
    expect(res.body.items.some((i) => i.changeType === 'CREATED')).toBe(true);
  });

  it('reactivates an inactive product and refuses an active one', async () => {
    const p = await api<{ id: string }>({ path: '/api/v1/catalog/products', method: 'POST', user: owner, body: { name: 'Dormant 1', sku: 'DRM-1' } });
    expect((await api({ path: `/api/v1/catalog/products/${p.body.id}/reactivate`, method: 'PUT', user: owner })).status).toBe(409);
    await api({ path: `/api/v1/catalog/products/${p.body.id}/deactivate`, method: 'PUT', user: owner });
    const res = await api<{ reactivated: boolean }>({ path: `/api/v1/catalog/products/${p.body.id}/reactivate`, method: 'PUT', user: owner });
    expect(res.status).toBe(200);
    const product = await api<{ status: string }>({ path: `/api/v1/catalog/products/${p.body.id}`, user: owner });
    expect(product.body.status).toBe('ACTIVE');
  });
});

describe('stock summary and expiry value', () => {
  it('summarises stock value, reorder state and expiring stock', async () => {
    await batch('SUM-1', 20, '10', '10.00');
    await batch('SUM-2', 400, '30', '12.00');
    const res = await api<{
      products: { active: number; inStock: number; belowReorder: number };
      value: { cost: string; mrp: string };
      expiring30: { batches: number; cost: string };
      batches: Record<string, { batches: number; quantity: number }>;
    }>({ path: `/api/v1/inventory/stock-summary?warehouseId=${warehouseId}`, user: owner });
    expect(res.status).toBe(200);
    expect(res.body.value.cost).toBe('460.00');
    expect(res.body.value.mrp).toBe('800.00');
    expect(res.body.products.inStock).toBeGreaterThanOrEqual(1);
    expect(res.body.products.belowReorder).toBeGreaterThanOrEqual(1);
    expect(res.body.expiring30).toMatchObject({ batches: 1, cost: '100.00' });
    expect(res.body.batches.SALEABLE).toMatchObject({ batches: 2, quantity: 40 });
  });

  it('adds cost and MRP value to the expiry dashboard', async () => {
    const res = await api<{ valueAtRisk: { cost: string; mrp: string }; bucketValues: Record<string, { cost: string }>; rows: Array<{ batchNumber: string; valueAtCost: string; valueAtMrp: string }> }>({
      path: `/api/v1/inventory/expiry-dashboard?warehouseId=${warehouseId}`,
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body.valueAtRisk).toEqual({ cost: '100.00', mrp: '200.00' });
    expect(res.body.bucketValues.DAYS_30!.cost).toBe('100.00');
    expect(res.body.rows.find((r) => r.batchNumber === 'SUM-2')).toMatchObject({ valueAtCost: '360.00', valueAtMrp: '600.00' });
  });
});

describe('bulk expiry write-off', () => {
  it('refuses saleable stock far from expiry', async () => {
    const far = await batch('FAR-1', 300);
    const res = await api<{ error: { details: Array<{ field: string }> } }>({
      path: '/api/v1/inventory/expiry/bulk-writeoff',
      method: 'POST',
      user: owner,
      body: { batchIds: [far], notes: 'Destroyed by vendor' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]!.field).toBe('batchIds');
  });

  it('requires a note', async () => {
    const res = await api({ path: '/api/v1/inventory/expiry/bulk-writeoff', method: 'POST', user: owner, body: { batchIds: [productId], notes: '' } });
    expect(res.status).toBe(400);
  });

  it('writes off near-expiry stock, blocks the batch and logs EXPIRY_WRITEOFF adjustments', async () => {
    const near = await batch('NEAR-1', 10, '7', '10.00');
    const res = await api<{ batches: number; lines: number; quantity: number; value: string }>({
      path: '/api/v1/inventory/expiry/bulk-writeoff',
      method: 'POST',
      user: owner,
      body: { batchIds: [near], notes: 'Sent for destruction' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ batches: 1, lines: 1, quantity: 7, value: '70.00' });
    const batches = await api<{ items: Array<{ id: string; status: string; balances: Array<{ quantity: string }> }> }>({
      path: `/api/v1/inventory/batches?search=NEAR-1`,
      user: owner,
    });
    const row = batches.body.items.find((b) => b.id === near)!;
    expect(row.status).toBe('EXPIRED_BLOCKED');
    expect(Number(row.balances[0]!.quantity)).toBe(0);
    const adj = await api<{ items: Array<{ reason: string; batchId: string; actorName: string | null }> }>({ path: '/api/v1/inventory/adjustments?reason=EXPIRY_WRITEOFF', user: owner });
    const line = adj.body.items.find((a) => a.batchId === near)!;
    expect(line).toBeTruthy();
    expect(line.actorName).toBeTruthy();
  });
});

describe('adjustment summary', () => {
  it('totals adjustments by reason at cost', async () => {
    const b = await batch('ADJ-1', 200, '20', '5.00');
    await api({ path: '/api/v1/inventory/adjustments', method: 'POST', user: owner, body: { batchId: b, warehouseId, direction: 'OUT', quantity: '2', reason: 'DAMAGE' } });
    await api({ path: '/api/v1/inventory/adjustments', method: 'POST', user: owner, body: { batchId: b, warehouseId, direction: 'IN', quantity: '1', reason: 'COUNT_CORRECTION' } });
    const res = await api<{ count: number; outValue: string; byReason: Array<{ reason: string; outQty: number; outValue: string; inValue: string }> }>({
      path: '/api/v1/inventory/adjustments/summary',
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body.byReason.find((r) => r.reason === 'DAMAGE')).toMatchObject({ outQty: 2, outValue: '10.00' });
    expect(res.body.byReason.find((r) => r.reason === 'COUNT_CORRECTION')).toMatchObject({ inValue: '5.00' });
  });
});

describe('ledger filters and export', () => {
  it('searches by batch number and returns actor names', async () => {
    const res = await api<{ items: Array<{ batch: { batchNumber: string }; actorName: string | null }> }>({ path: '/api/v1/inventory/ledger?search=ADJ-1', user: owner });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(3);
    expect(res.body.items.every((i) => i.batch.batchNumber === 'ADJ-1')).toBe(true);
    expect(res.body.items[0]!.actorName).toBeTruthy();
  });

  it('exports the filtered ledger as CSV', async () => {
    const res = await fetch(`${TEST_BASE}/api/v1/inventory/ledger/export?search=ADJ-1`, {
      headers: { Cookie: owner.cookie, 'x-organization-id': owner.organizationId, 'x-branch-id': owner.branchId },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('Movement');
    expect(text).toContain('ADJ-1');
    expect(text).toContain('Stock Main');
  });
});

describe('transfers', () => {
  it('rejects the same warehouse and duplicate batches', async () => {
    const b = await batch('TRF-1', 200, '10');
    const same = await api({
      path: '/api/v1/inventory/transfers',
      method: 'POST',
      user: owner,
      body: { sourceWarehouseId: warehouseId, destinationWarehouseId: warehouseId, lines: [{ productId, batchId: b, quantity: '1' }] },
    });
    expect(same.status).toBe(400);
    const dup = await api({
      path: '/api/v1/inventory/transfers',
      method: 'POST',
      user: owner,
      body: {
        sourceWarehouseId: warehouseId,
        destinationWarehouseId: secondWarehouseId,
        lines: [{ productId, batchId: b, quantity: '1' }, { productId, batchId: b, quantity: '2' }],
      },
    });
    expect(dup.status).toBe(400);
  });

  it('returns transfer detail with warehouse names and movements', async () => {
    const b = await batch('TRF-2', 200, '10');
    const created = await api<{ id: string }>({
      path: '/api/v1/inventory/transfers',
      method: 'POST',
      user: owner,
      body: { sourceWarehouseId: warehouseId, destinationWarehouseId: secondWarehouseId, notes: 'Shelf top-up', lines: [{ productId, batchId: b, quantity: '4' }] },
    });
    expect(created.status).toBe(201);
    const res = await api<{ sourceWarehouseName: string; destinationWarehouseName: string; createdByName: string; movements: unknown[]; lines: Array<{ batch: { product: { name: string } } }> }>({
      path: `/api/v1/inventory/transfers/${created.body.id}`,
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sourceWarehouseName: 'Stock Main', destinationWarehouseName: 'Stock Back' });
    expect(res.body.createdByName).toBeTruthy();
    expect(res.body.movements).toHaveLength(1);
    expect(res.body.lines[0]!.batch.product.name).toBe('Stockwise 5');
  });
});

describe('count sheet and cancel', () => {
  it('lists every stocked batch in the warehouse with system quantity', async () => {
    const res = await api<{ items: Array<{ batchNumber: string; systemQty: number; rackLocation: string | null }> }>({
      path: `/api/v1/inventory/counts/sheet?warehouseId=${warehouseId}`,
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body.items.find((i) => i.batchNumber === 'SUM-2')).toMatchObject({ systemQty: 30, rackLocation: 'A-1' });
    expect(res.body.items.some((i) => i.batchNumber === 'NEAR-1')).toBe(false);
    const all = await api<{ items: Array<{ batchNumber: string }> }>({ path: `/api/v1/inventory/counts/sheet?warehouseId=${warehouseId}&includeZero=true`, user: owner });
    expect(all.body.items.some((i) => i.batchNumber === 'NEAR-1')).toBe(true);
  });

  it('rejects duplicate batches and cancels an unposted count', async () => {
    const sheet = await api<{ items: Array<{ batchId: string; productId: string; batchNumber: string }> }>({ path: `/api/v1/inventory/counts/sheet?warehouseId=${warehouseId}`, user: owner });
    const line = sheet.body.items.find((i) => i.batchNumber === 'SUM-2')!;
    const dup = await api({
      path: '/api/v1/inventory/counts',
      method: 'POST',
      user: owner,
      body: { warehouseId, lines: [{ productId: line.productId, batchId: line.batchId, countedQty: '1' }, { productId: line.productId, batchId: line.batchId, countedQty: '2' }] },
    });
    expect(dup.status).toBe(400);
    const count = await api<{ id: string }>({
      path: '/api/v1/inventory/counts',
      method: 'POST',
      user: owner,
      body: { warehouseId, lines: [{ productId: line.productId, batchId: line.batchId, countedQty: '29' }] },
    });
    expect(count.status).toBe(201);
    expect((await api({ path: `/api/v1/inventory/counts/${count.body.id}/cancel`, method: 'POST', user: owner, body: { reason: 'no' } })).status).toBe(400);
    const cancelled = await api<{ status: string }>({ path: `/api/v1/inventory/counts/${count.body.id}/cancel`, method: 'POST', user: owner, body: { reason: 'Recount tomorrow' } });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await api({ path: `/api/v1/inventory/counts/${count.body.id}/post`, method: 'POST', user: owner })).status).toBe(409);
  });
});
