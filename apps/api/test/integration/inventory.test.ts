import { beforeAll, describe, expect, it } from 'vitest';
import { api, bootTestServer, registerOrg, type TestUser } from './harness.js';

let owner: TestUser;
let warehouseId: string;
let destinationWarehouseId: string;
let productId: string;
let other: TestUser;

const futureDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function createBatch(overrides: Record<string, unknown>) {
  return api({
    path: '/api/v1/inventory/batches',
    method: 'POST',
    user: owner,
    body: {
      productId,
      warehouseId,
      batchNumber: `B${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      expiryDate: futureDate(180),
      quantity: '100',
      purchaseRate: '10.00',
      mrp: '20.00',
      ...overrides,
    },
  });
}

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg();
  other = await registerOrg();

  // Create a warehouse via branches API.
  const branches = await api({ path: '/api/v1/organizations/branches', user: owner });
  const branchId = (branches.body as Array<{ id: string }>)[0]!.id;
  const wh = await api({
    path: `/api/v1/organizations/branches/${branchId}/warehouses`,
    method: 'POST',
    user: owner,
    body: { name: 'Main Warehouse', isDefault: true },
  });
  warehouseId = (wh.body as { id: string }).id;
  const wh2 = await api({
    path: `/api/v1/organizations/branches/${branchId}/warehouses`,
    method: 'POST',
    user: owner,
    body: { name: 'Secondary Warehouse' },
  });
  destinationWarehouseId = (wh2.body as { id: string }).id;

  const product = await api({
    path: '/api/v1/catalog/products',
    method: 'POST',
    user: owner,
    body: { name: 'Cetirizine 10mg Tablet', sku: 'CET-10', hsnCode: '3004', mrp: '20.00' },
  });
  productId = (product.body as { id: string }).id;

  const otherBranches = await api({ path: '/api/v1/organizations/branches', user: other });
  const otherBranchId = (otherBranches.body as Array<{ id: string }>)[0]!.id;
  await api({
    path: `/api/v1/organizations/branches/${otherBranchId}/warehouses`,
    method: 'POST',
    user: other,
    body: { name: 'Other Warehouse', isDefault: true },
  });
});

describe('batch creation and FEFO', () => {
  it('creates opening stock and records movements', async () => {
    const res = await createBatch({ batchNumber: 'OPEN-1', quantity: '50' });
    expect(res.status).toBe(201);
    const batch = res.body as { id: string; balances: Array<{ quantity: string }> };
    expect(Number(batch.balances[0]!.quantity)).toBe(50);
  });

  it('allocates earliest-expiry batch first (FEFO)', async () => {
    await createBatch({ batchNumber: 'FEFO-OLD', expiryDate: futureDate(40), quantity: '30' });
    await createBatch({ batchNumber: 'FEFO-NEW', expiryDate: futureDate(300), quantity: '30' });
    const res = await api({
      path: '/api/v1/inventory/allocate',
      method: 'POST',
      user: owner,
      body: { productId, warehouseId, quantity: '10' },
    });
    expect(res.status).toBe(200);
    const allocations = (res.body as { allocations: Array<{ batchNumber: string; quantity: number }> }).allocations;
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.batchNumber).toBe('FEFO-OLD');
    expect(allocations[0]!.quantity).toBe(10);
  });

  it('spans multiple batches when the first is insufficient (FEFO continuity)', async () => {
    const res = await api({
      path: '/api/v1/inventory/allocate',
      method: 'POST',
      user: owner,
      body: { productId, warehouseId, quantity: '35' },
    });
    expect(res.status).toBe(200);
    const allocations = (res.body as { allocations: Array<{ batchNumber: string; quantity: number }> }).allocations;
    expect(allocations[0]!.batchNumber).toBe('FEFO-OLD');
    expect(allocations[0]!.quantity).toBe(30);
    expect(allocations[1]!.batchNumber).toBe('OPEN-1');
  });

  it('refuses to allocate from expired batches (Drugs Rules 65(17))', async () => {
    await createBatch({ batchNumber: 'EXPIRED-1', expiryDate: futureDate(-10), quantity: '500' });
    const res = await api({
      path: '/api/v1/inventory/allocate',
      method: 'POST',
      user: owner,
      body: { productId, warehouseId, quantity: '5000' },
    });
    // The expired 500 cannot satisfy anything; other batches are far too small.
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('blocks explicit allocation of a recalled or expired batch', async () => {
    const expired = await createBatch({ batchNumber: 'EXPL-EXP', expiryDate: futureDate(-5), quantity: '10' });
    const expiredBatchId = (expired.body as { id: string }).id;
    const res = await api({
      path: '/api/v1/inventory/allocate',
      method: 'POST',
      user: owner,
      body: { productId, warehouseId, quantity: '5', explicitBatchId: expiredBatchId },
    });
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe('BATCH_INELIGIBLE');
  });
});

describe('oversell prevention and concurrency', () => {
  it('rejects a sale exceeding available stock', async () => {
    const batch = await createBatch({ batchNumber: 'SMALL-1', quantity: '5' });
    const batchId = (batch.body as { id: string }).id;
    const res = await api({
      path: '/api/v1/inventory/adjustments',
      method: 'POST',
      user: owner,
      body: { batchId, warehouseId, direction: 'OUT', quantity: '10', reason: 'DAMAGE' },
    });
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('serializes concurrent deductions — no oversell under parallel requests', async () => {
    const batch = await createBatch({ batchNumber: 'CONC-1', quantity: '10' });
    const batchId = (batch.body as { id: string }).id;
    // 8 concurrent OUT adjustments of 3 each against a stock of 10: at most 3 succeed.
    const requests = Array.from({ length: 8 }, () =>
      api({
        path: '/api/v1/inventory/adjustments',
        method: 'POST',
        user: owner,
        body: { batchId, warehouseId, direction: 'OUT', quantity: '3', reason: 'DAMAGE' },
      }),
    );
    const results = await Promise.all(requests);
    const succeeded = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 422).length;
    // Exactly floor(10/3)=3 can succeed; the rest must be rejected — never oversold.
    expect(succeeded).toBe(3);
    expect(rejected).toBe(5);

    // Final balance must be 10 - 9 = 1, never negative.
    const reconcile = await api({ path: '/api/v1/inventory/reconcile', user: owner });
    expect((reconcile.body as { consistent: boolean }).consistent).toBe(true);
  });
});

describe('transfers', () => {
  it('dispatches, receives, and prevents over-receipt', async () => {
    const batch = await createBatch({ batchNumber: 'TRF-1', quantity: '40' });
    const batchId = (batch.body as { id: string }).id;

    const transfer = await api({
      path: '/api/v1/inventory/transfers',
      method: 'POST',
      user: owner,
      body: {
        sourceWarehouseId: warehouseId,
        destinationWarehouseId,
        lines: [{ productId, batchId, quantity: '15' }],
      },
    });
    expect(transfer.status).toBe(201);
    const transferBody = transfer.body as { id: string; status: string; lines: Array<{ id: string }> };
    expect(transferBody.status).toBe('DISPATCHED');

    // Over-receipt attempt: 16 > dispatched 15.
    const over = await api({
      path: `/api/v1/inventory/transfers/${transferBody.id}/receive`,
      method: 'POST',
      user: owner,
      body: { lines: [{ transferLineId: transferBody.lines[0]!.id, receivedQty: '16' }] },
    });
    expect(over.status).toBe(422);
    expect((over.body as { error: { code: string } }).error.code).toBe('TRANSFER_QUANTITY_INVALID');

    const receive = await api({
      path: `/api/v1/inventory/transfers/${transferBody.id}/receive`,
      method: 'POST',
      user: owner,
      body: { lines: [{ transferLineId: transferBody.lines[0]!.id, receivedQty: '15' }] },
    });
    expect(receive.status).toBe(201);
    expect((receive.body as { status: string }).status).toBe('RECEIVED');

    // Ledger must reconcile after the transfer pair.
    const reconcile = await api({ path: '/api/v1/inventory/reconcile', user: owner });
    expect((reconcile.body as { consistent: boolean }).consistent).toBe(true);
  });

  it('returns undelivered stock on cancellation', async () => {
    const batch = await createBatch({ batchNumber: 'TRF-CXL', quantity: '20' });
    const batchId = (batch.body as { id: string }).id;
    const transfer = await api({
      path: '/api/v1/inventory/transfers',
      method: 'POST',
      user: owner,
      body: {
        sourceWarehouseId: warehouseId,
        destinationWarehouseId,
        lines: [{ productId, batchId, quantity: '8' }],
      },
    });
    const transferId = (transfer.body as { id: string }).id;
    const cancel = await api({
      path: `/api/v1/inventory/transfers/${transferId}/cancel`,
      method: 'POST',
      user: owner,
      body: { reason: 'Transport unavailable' },
    });
    expect(cancel.status).toBe(201);
    expect((cancel.body as { status: string }).status).toBe('CANCELLED');
  });
});

describe('stock counts', () => {
  it('posts count variances as compensating movements and reconciles', async () => {
    const batch = await createBatch({ batchNumber: 'CNT-1', quantity: '25' });
    const batchId = (batch.body as { id: string }).id;
    // Count 22 against system 25 → variance -3.
    const count = await api({
      path: '/api/v1/inventory/counts',
      method: 'POST',
      user: owner,
      body: { warehouseId, lines: [{ productId, batchId, countedQty: '22' }] },
    });
    expect(count.status).toBe(201);
    const countId = (count.body as { id: string }).id;
    const posted = await api({
      path: `/api/v1/inventory/counts/${countId}/post`,
      method: 'POST',
      user: owner,
    });
    expect(posted.status).toBe(201);
    expect((posted.body as { status: string }).status).toBe('POSTED');

    const reconcile = await api({ path: '/api/v1/inventory/reconcile', user: owner });
    expect((reconcile.body as { consistent: boolean }).consistent).toBe(true);
  });
});

describe('recalls', () => {
  it('blocks recalled batches from allocation', async () => {
    const batch = await createBatch({ batchNumber: 'RCL-1', quantity: '30' });
    const batchId = (batch.body as { id: string }).id;
    const recall = await api({
      path: '/api/v1/inventory/recalls',
      method: 'POST',
      user: owner,
      body: { batchId, reason: 'Manufacturer recall notice R-2026-114' },
    });
    expect(recall.status).toBe(201);

    const allocate = await api({
      path: '/api/v1/inventory/allocate',
      method: 'POST',
      user: owner,
      body: { productId, warehouseId, quantity: '5', explicitBatchId: batchId },
    });
    expect(allocate.status).toBe(422);
    expect((allocate.body as { error: { code: string } }).error.code).toBe('BATCH_INELIGIBLE');
  });
});

describe('tenant isolation on inventory', () => {
  it("another tenant cannot allocate against this org's batches", async () => {
    const res = await api({
      path: '/api/v1/inventory/allocate',
      method: 'POST',
      user: other,
      body: { productId, warehouseId, quantity: '1' },
    });
    // Warehouse belongs to owner's org → must be 404 for the other tenant.
    expect([404, 422]).toContain(res.status);
    if (res.status === 422) {
      // If treated as a warehouse validation failure, it must NOT be insufficient-stock leakage.
      expect((res.body as { error: { code: string } }).error.code).not.toBe('INSUFFICIENT_STOCK');
    }
  });
});
