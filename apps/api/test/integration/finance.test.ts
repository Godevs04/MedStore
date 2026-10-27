import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_BASE, api, bootTestServer, registerOrg, type TestUser } from './harness.js';

let owner: TestUser;
let warehouseId: string;
let productId: string;
let b2bCustomerId: string;

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const period = () => istToday().slice(0, 7);
const futureDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function csv(path: string) {
  const res = await fetch(`${TEST_BASE}${path}`, {
    headers: { Cookie: owner.cookie, 'x-organization-id': owner.organizationId, 'x-branch-id': owner.branchId },
  });
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') ?? '' };
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
  const branches = await api<Array<{ id: string; warehouses: Array<{ id: string; isDefault: boolean }> }>>({ path: '/api/v1/organizations/branches', user: owner });
  warehouseId = branches.body[0]!.warehouses.find((w) => w.isDefault)!.id;
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
    body: { name: 'Finacet 500', sku: 'FIN-500', hsnCode: '3004', mrp: '42.00', sellingPrice: '42.00' },
  });
  productId = product.body.id;
  await api({
    path: '/api/v1/inventory/batches',
    method: 'POST',
    user: owner,
    body: { productId, warehouseId, batchNumber: 'FIN01', expiryDate: futureDate(300), quantity: '50', purchaseRate: '20.00', mrp: '42.00' },
  });
  const customer = await api<{ id: string }>({
    path: '/api/v1/partners/customers',
    method: 'POST',
    user: owner,
    body: { name: 'Metro Clinic LLP', phone: '9822012345', gstin: '27AABCM1234D1Z1', stateCode: '27' },
  });
  expect(customer.status).toBe(201);
  b2bCustomerId = customer.body.id;
  for (const extra of [{}, { customerId: b2bCustomerId }]) {
    const sale = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: { warehouseId, lines: [{ productId, quantity: '2', unitPrice: '42.00' }], payments: [{ method: 'CASH', amount: '84.00' }], ...extra },
    });
    expect(sale.status).toBe(201);
  }
});

describe('GSTR-1 export', () => {
  it('needs an organisation GSTIN', async () => {
    const other = await registerOrg();
    const res = await api<{ error: { code: string } }>({ path: `/api/v1/compliance/gst/gstr1/export?period=${period()}`, user: other });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('GSTIN_REQUIRED');
  });

  it('rejects malformed and future periods', async () => {
    expect((await api({ path: '/api/v1/compliance/gst/gstr1/export?period=2026-13', user: owner })).status).toBe(400);
    expect((await api({ path: '/api/v1/compliance/gst/gstr1/export?period=2999-01', user: owner })).status).toBe(400);
  });

  it('splits B2B and B2CS with an HSN summary and document series', async () => {
    type G = {
      gstin: string;
      fp: string;
      b2b: Array<{ ctin: string; inv: Array<{ pos: string; itms: Array<{ itm_det: { rt: number; txval: number; camt: number; samt: number } }> }> }>;
      b2cs: Array<{ sply_ty: string; pos: string; rt: number; txval: number }>;
      hsn: { data: Array<{ hsn_sc: string; qty: number; txval: number }> };
      doc_issue: { doc_det: Array<{ docs: Array<{ totnum: number; net_issue: number }> }> };
      summary: { invoices: number; b2b: number; b2cs: number };
    };
    const res = await api<G>({ path: `/api/v1/compliance/gst/gstr1/export?period=${period()}`, user: owner });
    expect(res.status).toBe(200);
    const g = res.body;
    expect(g.gstin).toBe('27AAPFU0939F1ZV');
    expect(g.fp).toBe(`${period().slice(5, 7)}${period().slice(0, 4)}`);
    expect(g.b2b).toHaveLength(1);
    expect(g.b2b[0]!.ctin).toBe('27AABCM1234D1Z1');
    const item = g.b2b[0]!.inv[0]!.itms[0]!.itm_det;
    expect(item.rt).toBe(5);
    expect(item.camt).toBeCloseTo(item.samt, 2);
    expect(g.b2cs[0]).toMatchObject({ sply_ty: 'INTRA', pos: '27', rt: 5 });
    expect(g.hsn.data[0]).toMatchObject({ hsn_sc: '3004', qty: 4 });
    expect(g.hsn.data[0]!.txval).toBeCloseTo(item.txval + g.b2cs[0]!.txval, 2);
    expect(g.doc_issue.doc_det[0]!.docs[0]).toMatchObject({ totnum: 2, net_issue: 2 });
    expect(g.summary).toMatchObject({ invoices: 2, b2b: 1, b2cs: 1 });
  });
});

describe('GSTR-3B', () => {
  it('reports outward tax as payable when there is no input credit', async () => {
    const res = await api<{ outward: { txval: string; camt: string; samt: string; iamt: string }; payable: { total: string; cgst: string }; carryForward: { cgst: string } }>({
      path: `/api/v1/compliance/gst/gstr3b?period=${period()}`,
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(Number(res.body.outward.txval)).toBeCloseTo(160, 0);
    const tax = Number(res.body.outward.camt) + Number(res.body.outward.samt) + Number(res.body.outward.iamt);
    expect(Number(res.body.payable.total)).toBeCloseTo(tax, 2);
    expect(res.body.carryForward.cgst).toBe('0.00');
  });
});

describe('licences', () => {
  it('checks the number format per licence type', async () => {
    const res = await api<{ error: { details: Array<{ field: string }> } }>({
      path: '/api/v1/compliance/licences',
      method: 'POST',
      user: owner,
      body: { licenceType: 'FSSAI', licenceNumber: '12345', expiryDate: futureDate(400) },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toContain('licenceNumber');
  });

  it('requires expiry after issue', async () => {
    const res = await api({
      path: '/api/v1/compliance/licences',
      method: 'POST',
      user: owner,
      body: { licenceType: 'FORM_20', licenceNumber: 'MH-PZ-123456', issueDate: '2025-04-01', expiryDate: '2025-03-01' },
    });
    expect(res.status).toBe(400);
  });

  it('blocks duplicates and warns about an unpaired Form 20', async () => {
    const body = { licenceType: 'FORM_20', licenceNumber: 'MH-PZ-123456', issueDate: '2025-04-01', expiryDate: futureDate(800) };
    expect((await api({ path: '/api/v1/compliance/licences', method: 'POST', user: owner, body })).status).toBe(201);
    const dup = await api<{ error: { code: string } }>({ path: '/api/v1/compliance/licences', method: 'POST', user: owner, body: { ...body, licenceNumber: 'mh-pz-123456' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('LICENCE_DUPLICATE');
    const overview = await api<{ items: unknown[]; warnings: string[] }>({ path: '/api/v1/compliance/licences/overview', user: owner });
    expect(overview.body.items).toHaveLength(1);
    expect(overview.body.warnings.some((w) => w.includes('Form 21'))).toBe(true);
  });
});

describe('expenses and statements', () => {
  it('rejects future-dated and zero expenses', async () => {
    const res = await api<{ error: { details: Array<{ field: string }> } }>({
      path: '/api/v1/accounting/expenses',
      method: 'POST',
      user: owner,
      body: { category: 'Rent', payee: 'Landlord', amount: '0', method: 'BANK', expenseDate: futureDate(5) },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['amount', 'expenseDate']));
  });

  it('filters the list and summarises by category', async () => {
    for (const [category, amount] of [['Rent', '15000.00'], ['Electricity', '2400.50']] as const) {
      const r = await api({ path: '/api/v1/accounting/expenses', method: 'POST', user: owner, body: { category, payee: 'Vendor', amount, method: 'BANK', expenseDate: istToday() } });
      expect(r.status).toBe(201);
    }
    const list = await api<{ items: unknown[]; total: string }>({ path: '/api/v1/accounting/expenses?category=rent', user: owner });
    expect(list.body.items).toHaveLength(1);
    expect(list.body.total).toBe('15000.00');
    const summary = await api<{ total: string; byCategory: Array<{ category: string; amount: string }> }>({ path: '/api/v1/accounting/expenses/summary', user: owner });
    expect(summary.body.total).toBe('17400.50');
    expect(summary.body.byCategory[0]).toMatchObject({ category: 'Rent', amount: '15000.00' });
  });

  it('shows the monthly trend and exports P&L and balance sheet', async () => {
    const trend = await api<Array<{ month: string; expenses: string }>>({ path: '/api/v1/accounting/profit-and-loss/trend', user: owner });
    expect(trend.status).toBe(200);
    expect(Number(trend.body.find((m) => m.month === period())!.expenses)).toBeGreaterThanOrEqual(17400.5);
    const pnl = await csv('/api/v1/accounting/profit-and-loss/export');
    expect(pnl.status).toBe(200);
    expect(pnl.text).toContain('Net profit');
    const bs = await csv(`/api/v1/accounting/balance-sheet/export?asOf=${istToday()}`);
    expect(bs.text).toContain('Total assets');
    expect((await api({ path: '/api/v1/accounting/profit-and-loss?from=2026-05-01&to=2026-04-01', user: owner })).status).toBe(400);
  });
});

describe('dead stock', () => {
  it('flags a product with months of cover as slow, never dead when just stocked', async () => {
    const res = await api<{ days: number; items: Array<{ productId: string; classification: string; coverDays: number; soldQty: number }>; summary: { deadItems: number; slowItems: number } }>({
      path: '/api/v1/reports/dead-stock?days=30',
      user: owner,
    });
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(30);
    const row = res.body.items.find((i) => i.productId === productId)!;
    expect(row).toMatchObject({ classification: 'SLOW', soldQty: 4 });
    expect(row.coverDays).toBe(345);
    expect(res.body.summary.deadItems).toBe(0);
    expect((await api({ path: '/api/v1/reports/dead-stock?days=5', user: owner })).status).toBe(400);
  });
});
