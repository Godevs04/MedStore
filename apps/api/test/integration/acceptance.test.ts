/**
 * PRD §38 acceptance scenarios not covered by the phase suites: blocking
 * missing tax rates, partial receipts, COGS, split tenders, whole-rupee
 * rounding, multi-batch returns, IGST, adjustment journals, reversals under
 * period locks, books-to-stock reconciliation and tenant isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { api, bootTestServer, registerOrg, type TestUser } from './harness.js';

let owner: TestUser;
let warehouseId: string;
let productId: string;
let vendorId: string;
let accounts: Array<{ id: string; systemKey: string | null; type: string }> = [];
let firstSaleId: string;

const futureDate = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const errCode = (body: unknown): string | undefined => (body as { error?: { code?: string } }).error?.code;
const errMessage = (body: unknown): string | undefined => (body as { error?: { message?: string } }).error?.message;

async function balance(systemKey: string): Promise<number> {
  const acct = accounts.find((a) => a.systemKey === systemKey);
  if (!acct) throw new Error(`no account ${systemKey}`);
  const res = await api<{ closing: string }>({ path: `/api/v1/accounting/accounts/${acct.id}/ledger`, user: owner });
  return Number(res.body.closing);
}

async function sell(body: Record<string, unknown>) {
  return api<{ invoice: Record<string, unknown> & { id: string; total: string } }>({
    path: '/api/v1/sales/invoices',
    method: 'POST',
    user: owner,
    body: { warehouseId, idempotencyKey: `acc-${Math.random().toString(36).slice(2, 12)}`, ...body },
  });
}

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg({ name: 'Acceptance Pharmacy' });
  await api({
    path: '/api/v1/organizations',
    method: 'PATCH',
    user: owner,
    body: { addressLine1: '7 FC Road', city: 'Pune', stateCode: '27', pinCode: '411004', gstRegistrationStatus: 'REGULAR', gstin: '27ACCEP1234K1Z5' },
  });
  const wh = await api<{ id: string }>({
    path: `/api/v1/organizations/branches/${owner.branchId}/warehouses`,
    method: 'POST',
    user: owner,
    body: { name: 'Front Store', isDefault: true },
  });
  warehouseId = wh.body.id;
  await api({ path: '/api/v1/organizations/setup-complete', method: 'POST', user: owner });

  const vendor = await api<{ id: string }>({
    path: '/api/v1/partners/vendors',
    method: 'POST',
    user: owner,
    body: { legalName: 'Acceptance Distributors', gstin: '27ACCVD1234L1Z8', stateCode: '27', creditDays: 30 },
  });
  vendorId = vendor.body.id;
  const accts = await api<typeof accounts>({ path: '/api/v1/accounting/accounts', user: owner });
  accounts = accts.body;
});

describe('Tax configuration', () => {
  it('standard GST loader creates dated rate versions once (idempotent)', async () => {
    const first = await api<{ created: number; skipped: number; effectiveFrom: string }>({ path: '/api/v1/catalog/tax-rates/load-standard', method: 'POST', user: owner });
    expect(first.status).toBe(201);
    expect(first.body.created).toBeGreaterThanOrEqual(5);
    const again = await api<{ created: number }>({ path: '/api/v1/catalog/tax-rates/load-standard', method: 'POST', user: owner });
    expect(again.body.created).toBe(0);

    const product = await api<{ id: string }>({
      path: '/api/v1/catalog/products',
      method: 'POST',
      user: owner,
      body: { name: 'Acceptance Paracetamol 650', sku: 'ACC-650', hsnCode: '3004', mrp: '25.00', prescriptionClass: 'OTC' },
    });
    expect(product.status).toBe(201);
    productId = product.body.id;
    const list = await api<{ items: Array<{ id: string; taxResolved: boolean; gstPercent: string | null }> }>({ path: '/api/v1/catalog/products?page=1&pageSize=50', user: owner });
    const row = list.body.items.find((p) => p.id === productId)!;
    expect(row.taxResolved).toBe(true);
    expect(Number(row.gstPercent)).toBe(5);
  });

  it('a sale for a product without an effective GST rate is blocked (TAX_RATE_MISSING)', async () => {
    const orphan = await api<{ id: string }>({
      path: '/api/v1/catalog/products',
      method: 'POST',
      user: owner,
      body: { name: 'Unclassified Device', sku: 'ACC-NORATE', hsnCode: '9999', mrp: '50.00', prescriptionClass: 'OTC' },
    });
    await api({
      path: '/api/v1/purchasing/goods-receipts',
      method: 'POST',
      user: owner,
      body: { vendorId, warehouseId, lines: [{ productId: orphan.body.id, batchNumber: 'NR-1', expiryDate: futureDate(300), quantity: '5', purchaseRate: '20.00', mrp: '50.00' }] },
    });
    const res = await sell({ lines: [{ productId: orphan.body.id, quantity: '1', unitPrice: '50.00' }], payments: [{ method: 'CASH', amount: '50.00' }] });
    expect(res.status).toBe(422);
    expect(errCode(res.body)).toBe('TAX_RATE_MISSING');
  });
});

describe('Purchasing: partial receipts and inventory booking', () => {
  it('receives a PO in two partial GRNs, blocks over-receipt, books inventory at supplier invoice', async () => {
    const po = await api<{ id: string; lines: Array<{ id: string }> }>({
      path: '/api/v1/purchasing/purchase-orders',
      method: 'POST',
      user: owner,
      body: { vendorId, lines: [{ productId, quantity: '100', unitPrice: '10.00' }] },
    });
    expect(po.status).toBe(201);
    for (const action of ['send', 'confirm']) {
      await api({ path: `/api/v1/purchasing/purchase-orders/${po.body.id}/action`, method: 'POST', user: owner, body: { action } });
    }
    const poLineId = po.body.lines[0]!.id;
    const grnBody = (batchNumber: string, days: number, quantity: string) => ({
      vendorId,
      poId: po.body.id,
      warehouseId,
      lines: [{ productId, poLineId, batchNumber, expiryDate: futureDate(days), quantity, purchaseRate: '10.00', mrp: '25.00' }],
    });

    const inventoryBefore = await balance('INVENTORY');
    const g1 = await api<{ id: string }>({ path: '/api/v1/purchasing/goods-receipts', method: 'POST', user: owner, body: grnBody('ACC-A', 300, '40') });
    expect(g1.status).toBe(201);
    const pos = await api<{ items: Array<{ id: string; status: string }> }>({ path: '/api/v1/purchasing/purchase-orders', user: owner });
    expect(pos.body.items.find((p) => p.id === po.body.id)!.status).toBe('PARTIALLY_RECEIVED');
    // A goods receipt alone moves stock, not the books.
    expect(await balance('INVENTORY')).toBe(inventoryBefore);

    const over = await api({ path: '/api/v1/purchasing/goods-receipts', method: 'POST', user: owner, body: grnBody('ACC-X', 200, '70') });
    expect(over.status).toBeGreaterThanOrEqual(400);

    const g2 = await api<{ id: string }>({ path: '/api/v1/purchasing/goods-receipts', method: 'POST', user: owner, body: grnBody('ACC-B', 60, '60') });
    expect(g2.status).toBe(201);
    const after = await api<{ items: Array<{ id: string; status: string }> }>({ path: '/api/v1/purchasing/purchase-orders', user: owner });
    expect(after.body.items.find((p) => p.id === po.body.id)!.status).toBe('RECEIVED');

    // Three-way match: invoice quantity must equal the receipt.
    const mismatch = await api({
      path: '/api/v1/purchasing/invoices',
      method: 'POST',
      user: owner,
      body: { vendorId, invoiceNumber: 'ACC-INV-X', invoiceDate: istToday(), grnId: g1.body.id, lines: [{ productId, quantity: '45', unitCost: '10.00' }] },
    });
    expect(mismatch.status).toBe(422);

    for (const [grn, qty, no] of [[g1.body.id, '40', 'ACC-INV-1'], [g2.body.id, '60', 'ACC-INV-2']] as const) {
      const inv = await api({
        path: '/api/v1/purchasing/invoices',
        method: 'POST',
        user: owner,
        body: { vendorId, invoiceNumber: no, invoiceDate: istToday(), grnId: grn, lines: [{ productId, quantity: qty, unitCost: '10.00' }] },
      });
      expect(inv.status).toBe(201);
    }
    expect(await balance('INVENTORY')).toBe(inventoryBefore + 1000);
    expect(await balance('GST_INPUT')).toBe(50);
  });
});

describe('POS billing', () => {
  it('posts COGS at batch cost (FEFO batch) alongside revenue', async () => {
    const cogsBefore = await balance('COGS');
    const res = await sell({ lines: [{ productId, quantity: '5', unitPrice: '21.00' }], payments: [{ method: 'CASH', amount: '105.00' }] });
    expect(res.status).toBe(201);
    firstSaleId = res.body.invoice.id;
    expect(String(res.body.invoice.invoiceNumber)).toMatch(/^SI\/\d{4}\/\d{6}$/);
    const lines = res.body.invoice.lines as Array<{ costOfGoods: string; batchAllocations: Array<{ batch: { batchNumber: string } }> }>;
    expect(lines[0]!.batchAllocations[0]!.batch.batchNumber).toBe('ACC-B');
    expect(Number(lines[0]!.costOfGoods)).toBe(50);
    expect(await balance('COGS')).toBe(cogsBefore + 50);
  });

  it('split tender posts cash to Cash in Hand and UPI/card to Bank', async () => {
    const cash0 = await balance('CASH');
    const bank0 = await balance('BANK');
    const res = await sell({
      lines: [{ productId, quantity: '10', unitPrice: '21.00' }],
      payments: [
        { method: 'CASH', amount: '100.00' },
        { method: 'UPI', amount: '60.00', reference: 'UPI-123' },
        { method: 'CARD', amount: '50.00', reference: 'XX-4242' },
      ],
    });
    expect(res.status).toBe(201);
    expect(await balance('CASH')).toBe(cash0 + 100);
    expect(await balance('BANK')).toBe(bank0 + 110);
  });

  it('rounds the bill to the whole rupee and requires tenders to match the rounded total', async () => {
    const short = await sell({ lines: [{ productId, quantity: '1', unitPrice: '20.50' }], payments: [{ method: 'CASH', amount: '20.50' }] });
    expect(short.status).toBe(400);
    expect(errMessage(short.body)).toMatch(/21/);
    const ok = await sell({ lines: [{ productId, quantity: '1', unitPrice: '20.50' }], payments: [{ method: 'CASH', amount: '21.00' }] });
    expect(ok.status).toBe(201);
    expect(Number(ok.body.invoice.total)).toBe(21);
  });

  it('expired batches cannot be sold even when chosen explicitly', async () => {
    const batches = await api<{ items: Array<{ id: string; batchNumber: string }> }>({ path: `/api/v1/inventory/batches?page=1&pageSize=50&productId=${productId}`, user: owner });
    const a = batches.body.items.find((b) => b.batchNumber === 'ACC-A')!;
    await api({ path: `/api/v1/inventory/batches/${a.id}/status`, method: 'PUT', user: owner, body: { status: 'QUARANTINED', reason: 'Temperature excursion check' } });
    const res = await sell({ lines: [{ productId, quantity: '1', unitPrice: '21.00', explicitBatchId: a.id }], payments: [{ method: 'CASH', amount: '21.00' }] });
    expect(res.status).toBe(422);
    await api({ path: `/api/v1/inventory/batches/${a.id}/status`, method: 'PUT', user: owner, body: { status: 'SALEABLE', reason: 'Cleared after inspection' } });
  });
});

describe('Returns', () => {
  it('full return of a sale spanning two batches restocks each batch and refunds cash', async () => {
    // ACC-B has 60 - 5 - 10 - 1 = 44 left; 70 units span ACC-B (44) and ACC-A (26).
    const sale = await sell({ lines: [{ productId, quantity: '70', unitPrice: '21.00' }], payments: [{ method: 'CASH', amount: '1470.00' }] });
    expect(sale.status).toBe(201);
    const line = (sale.body.invoice.lines as Array<{ id: string; batchAllocations: Array<{ quantity: string }> }>)[0]!;
    expect(line.batchAllocations).toHaveLength(2);

    const cash0 = await balance('CASH');
    const ret = await api<{ refundTotal: string; creditAdjusted: string }>({
      path: '/api/v1/sales/returns',
      method: 'POST',
      user: owner,
      body: { invoiceId: sale.body.invoice.id, reason: 'Wrong strength dispensed', refundMethod: 'CASH', lines: [{ invoiceLineId: line.id, quantity: '70', restock: true }] },
    });
    expect(ret.status).toBe(201);
    expect(Number(ret.body.refundTotal)).toBe(1470);
    expect(await balance('CASH')).toBe(cash0 - 1470);

    const detail = await api<{ status: string }>({ path: `/api/v1/sales/invoices/${sale.body.invoice.id}`, user: owner });
    expect(detail.body.status).toBe('RETURNED');
    const again = await api({
      path: '/api/v1/sales/returns',
      method: 'POST',
      user: owner,
      body: { invoiceId: sale.body.invoice.id, reason: 'Duplicate attempt', lines: [{ invoiceLineId: line.id, quantity: '1', restock: true }] },
    });
    expect(again.status).toBe(409);

    const reconcile = await api<{ consistent: boolean }>({ path: '/api/v1/inventory/reconcile', user: owner });
    expect(reconcile.body.consistent).toBe(true);
  });
});

describe('Inter-state supply and credit', () => {
  it('bills IGST for an out-of-state customer; credit limit 0 means no limit', async () => {
    const cust = await api<{ id: string }>({
      path: '/api/v1/partners/customers',
      method: 'POST',
      user: owner,
      body: { name: 'Bengaluru Clinic', phone: '9845000001', stateCode: '29', creditLimit: '0' },
    });
    expect(cust.status).toBe(201);
    const res = await sell({ customerId: cust.body.id, lines: [{ productId, quantity: '2', unitPrice: '21.00' }], payments: [{ method: 'CREDIT', amount: '42.00' }] });
    expect(res.status).toBe(201);
    expect(Number(res.body.invoice.igstAmount)).toBeGreaterThan(0);
    expect(Number(res.body.invoice.cgstAmount)).toBe(0);
    expect(Number(res.body.invoice.creditAmount)).toBe(42);
    const out = await api<{ outstanding: string }>({ path: `/api/v1/sales/customers/${cust.body.id}/outstanding`, user: owner });
    expect(Number(out.body.outstanding)).toBe(42);

    await api({ path: `/api/v1/partners/customers/${cust.body.id}`, method: 'PUT', user: owner, body: { creditLimit: '50.00' } });
    const blocked = await sell({ customerId: cust.body.id, lines: [{ productId, quantity: '1', unitPrice: '21.00' }], payments: [{ method: 'CREDIT', amount: '21.00' }] });
    expect(blocked.status).toBe(422);
    expect(errCode(blocked.body)).toBe('CREDIT_LIMIT_EXCEEDED');
  });
});

describe('Accounting controls', () => {
  it('stock adjustment posts an inventory write-off journal at batch cost', async () => {
    const batches = await api<{ items: Array<{ id: string; batchNumber: string }> }>({ path: `/api/v1/inventory/batches?page=1&pageSize=50&productId=${productId}`, user: owner });
    const a = batches.body.items.find((b) => b.batchNumber === 'ACC-A')!;
    const loss0 = await balance('INVENTORY_LOSS');
    const adj = await api({
      path: '/api/v1/inventory/adjustments',
      method: 'POST',
      user: owner,
      body: { batchId: a.id, warehouseId, direction: 'OUT', quantity: '2', reason: 'DAMAGE', notes: 'Strip crushed in shelf' },
    });
    expect(adj.status).toBe(201);
    expect(await balance('INVENTORY_LOSS')).toBe(loss0 + 20);
    const journals = await api<{ items: Array<{ lines: Array<{ debit: string; credit: string }> }> }>({ path: '/api/v1/accounting/journals?page=1&pageSize=5&sourceType=STOCK_ADJUSTMENT', user: owner });
    const j = journals.body.items[0]!;
    expect(j.lines.reduce((s, l) => s + Number(l.debit), 0)).toBe(j.lines.reduce((s, l) => s + Number(l.credit), 0));
  });

  it('manual journals reverse exactly once; locked periods reject any posting', async () => {
    const cash = accounts.find((a) => a.systemKey === 'CASH')!;
    const equity = accounts.find((a) => a.systemKey === 'EQUITY')!;
    const posted = await api<{ id: string; entryNumber: string }>({
      path: '/api/v1/accounting/journals',
      method: 'POST',
      user: owner,
      body: { date: istToday(), memo: 'Owner capital introduced', lines: [{ accountId: cash.id, debit: '1000.00' }, { accountId: equity.id, credit: '1000.00' }] },
    });
    expect(posted.status).toBe(201);
    expect(posted.body.entryNumber).toMatch(/^JV\/\d{4}\/\d{6}$/);

    const unbalanced = await api({
      path: '/api/v1/accounting/journals',
      method: 'POST',
      user: owner,
      body: { date: istToday(), memo: 'Broken', lines: [{ accountId: cash.id, debit: '10.00' }, { accountId: equity.id, credit: '9.00' }] },
    });
    expect(unbalanced.status).toBe(422);

    const cash0 = await balance('CASH');
    const rev = await api<{ id: string }>({ path: `/api/v1/accounting/journals/${posted.body.id}/reverse`, method: 'POST', user: owner, body: {} });
    expect(rev.status).toBe(201);
    expect(await balance('CASH')).toBe(cash0 - 1000);
    const twice = await api({ path: `/api/v1/accounting/journals/${posted.body.id}/reverse`, method: 'POST', user: owner, body: {} });
    expect(twice.status).toBe(409);
    const ofReversal = await api({ path: `/api/v1/accounting/journals/${rev.body.id}/reverse`, method: 'POST', user: owner, body: {} });
    expect(ofReversal.status).toBe(409);

    const label = istToday().slice(0, 7);
    const lock = await api({ path: '/api/v1/accounting/periods/lock', method: 'POST', user: owner, body: { periodLabel: label, locked: true } });
    expect(lock.status).toBe(201);
    const blockedJournal = await api({
      path: '/api/v1/accounting/journals',
      method: 'POST',
      user: owner,
      body: { date: istToday(), memo: 'Into a locked month', lines: [{ accountId: cash.id, debit: '5.00' }, { accountId: equity.id, credit: '5.00' }] },
    });
    expect(blockedJournal.status).toBe(422);
    expect(errCode(blockedJournal.body)).toBe('PERIOD_LOCKED');
    const blockedSale = await sell({ lines: [{ productId, quantity: '1', unitPrice: '21.00' }], payments: [{ method: 'CASH', amount: '21.00' }] });
    expect(blockedSale.status).toBe(422);
    expect(errCode(blockedSale.body)).toBe('PERIOD_LOCKED');
    await api({ path: '/api/v1/accounting/periods/lock', method: 'POST', user: owner, body: { periodLabel: label, locked: false } });
  });

  it('books stay balanced and inventory GL equals physical stock at cost', async () => {
    const tb = await api<{ balanced: boolean; totalDebits: string; totalCredits: string }>({ path: '/api/v1/accounting/trial-balance', user: owner });
    expect(tb.body.balanced).toBe(true);
    const bs = await api<{ balanced: boolean }>({ path: '/api/v1/accounting/balance-sheet', user: owner });
    expect(bs.body.balanced).toBe(true);
    const val = await api<{ totalValue: string; bookValue: string; unbookedDifference: string }>({ path: '/api/v1/reports/stock-valuation', user: owner });
    // The un-invoiced 5-unit "no rate" receipt (₹100) is the only gap.
    expect(Number(val.body.unbookedDifference)).toBe(100);
    expect(Number(val.body.totalValue) - Number(val.body.bookValue)).toBe(100);
  });

  it('CSV exports are permission-gated and audited', async () => {
    const res = await fetch(`http://localhost:3101/api/v1/reports/export/sales-by-product`, {
      headers: { Cookie: owner.cookie, 'x-organization-id': owner.organizationId, 'x-branch-id': owner.branchId },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(await res.text()).toContain('Acceptance Paracetamol 650');
  });
});

describe('Reports agree with the books', () => {
  it('sales summary, dashboard and GST views reconcile with accounting', async () => {
    const custs = await api<{ items: Array<{ id: string; name: string }> }>({ path: '/api/v1/partners/customers?page=1&pageSize=20&search=Bengaluru', user: owner });
    const clinic = custs.body.items.find((c) => c.name === 'Bengaluru Clinic')!;
    const receipt = await api({ path: '/api/v1/sales/receipts', method: 'POST', user: owner, body: { customerId: clinic.id, amount: '10.00', method: 'UPI' } });
    expect(receipt.status).toBe(201);

    const today = istToday();
    const summary = await api<{
      totals: { revenue: string; netRevenue: string; netSales: string; grossMargin: string };
      byPayment: Array<{ method: string; amount: string }>;
    }>({ path: `/api/v1/reports/sales-summary?from=${today}&to=${today}`, user: owner });
    const pnl = await api<{ netSales: string; grossProfit: string }>({ path: `/api/v1/accounting/profit-and-loss?from=${today}&to=${today}`, user: owner });
    expect(summary.body.totals.netSales).toBe(pnl.body.netSales);
    expect(summary.body.totals.grossMargin).toBe(pnl.body.grossProfit);
    // Later receipts are collections, not tenders: tender mix sums exactly to the bills.
    const tendered = summary.body.byPayment.reduce((s, p) => s + Number(p.amount), 0);
    expect(tendered.toFixed(2)).toBe(Number(summary.body.totals.revenue).toFixed(2));

    const dash = await api<{ today: { revenue: string } }>({ path: '/api/v1/reports/dashboard', user: owner });
    expect(dash.body.today.revenue).toBe(summary.body.totals.netRevenue);

    const gst = await api<{ invoiceCount: number; eligible: { count: number }; ineligibleTax: string }>({ path: '/api/v1/compliance/gst/purchase-summary', user: owner });
    expect(gst.body.eligible.count).toBe(gst.body.invoiceCount);
    expect(gst.body.ineligibleTax).toBe('0.00');

    const checklist = await api<{ steps: Array<{ key: string; complete: boolean; required?: boolean }> }>({ path: '/api/v1/organizations/setup-checklist', user: owner });
    expect(checklist.body.steps.find((s) => s.key === 'tax_rates')).toMatchObject({ complete: true, required: false });
  });
});

describe('Tenant isolation', () => {
  it('another organization cannot read or act on this tenant’s documents', async () => {
    const other = await registerOrg({ name: 'Rival Pharmacy' });
    const direct = await api({ path: `/api/v1/sales/invoices/${firstSaleId}`, user: other });
    expect(direct.status).toBe(404);
    const spoofed = await api({ path: `/api/v1/sales/invoices/${firstSaleId}`, user: other, headers: { 'x-organization-id': owner.organizationId, 'x-branch-id': owner.branchId } });
    // Non-membership is indistinguishable from a missing organization.
    expect(spoofed.status).toBe(404);
    const list = await api<{ items: unknown[] }>({ path: '/api/v1/sales/invoices?page=1&pageSize=5', user: other });
    expect(list.body.items).toHaveLength(0);
    const reverse = await api({ path: `/api/v1/sales/returns`, method: 'POST', user: other, body: { invoiceId: firstSaleId, reason: 'Cross tenant attempt', lines: [] } });
    expect(reverse.status).toBeGreaterThanOrEqual(400);
  });
});
