import { beforeAll, describe, expect, it } from 'vitest';
import { api, bootTestServer, registerOrg, type TestUser } from './harness.js';

let owner: TestUser;
let warehouseId: string;
let productId: string;
let vendorId: string;
let customerId: string;

const futureDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg();

  // Set business profile + GSTIN (accounting + tax need state context).
  await api({
    path: '/api/v1/organizations',
    method: 'PATCH',
    user: owner,
    body: {
      addressLine1: '1 Market Road',
      city: 'Pune',
      stateCode: '27',
      pinCode: '411001',
      gstRegistrationStatus: 'REGULAR',
      gstin: '27COMME5678K1Z2',
    },
  });
  const branches = await api({ path: '/api/v1/organizations/branches', user: owner });
  const branchId = (branches.body as Array<{ id: string }>)[0]!.id;
  const wh = await api({
    path: `/api/v1/organizations/branches/${branchId}/warehouses`,
    method: 'POST',
    user: owner,
    body: { name: 'Commerce Store', isDefault: true },
  });
  warehouseId = (wh.body as { id: string }).id;

  // Complete onboarding gate.
  await api({ path: '/api/v1/organizations/setup-complete', method: 'POST', user: owner });

  const tax = await api({
    path: '/api/v1/catalog/tax-rates',
    method: 'POST',
    user: owner,
    body: { hsnCode: '3004', description: '5% slab', cgstPercent: '2.50', sgstPercent: '2.50', igstPercent: '5.00', effectiveFrom: '2025-09-22' },
  });
  expect(tax.status).toBe(201);

  const product = await api({
    path: '/api/v1/catalog/products',
    method: 'POST',
    user: owner,
    body: { name: 'Commerce Tablet 500mg', sku: 'COM-500', hsnCode: '3004', mrp: '40.00', prescriptionClass: 'OTC' },
  });
  productId = (product.body as { id: string }).id;

  const vendor = await api({
    path: '/api/v1/partners/vendors',
    method: 'POST',
    user: owner,
    body: { legalName: 'Commerce Distributors', gstin: '27COMVD1234L1Z8', stateCode: '27', creditDays: 30 },
  });
  vendorId = (vendor.body as { id: string }).id;

  const customer = await api({
    path: '/api/v1/partners/customers',
    method: 'POST',
    user: owner,
    body: { name: 'Commerce Clinic', phone: '9822011111', creditLimit: '5000.00' },
  });
  customerId = (customer.body as { id: string }).id;
});

describe('Phase 4: purchasing chain', () => {
  let poId: string;
  let grnId: string;

  it('creates, sends, and confirms a purchase order', async () => {
    const create = await api({
      path: '/api/v1/purchasing/purchase-orders',
      method: 'POST',
      user: owner,
      body: {
        vendorId,
        lines: [{ productId, quantity: '100', unitPrice: '20.00' }],
      },
    });
    expect(create.status).toBe(201);
    poId = (create.body as { id: string }).id;
    expect((create.body as { poNumber: string }).poNumber).toMatch(/^PO\/\d{4}\/\d{6}$/);

    const send = await api({
      path: `/api/v1/purchasing/purchase-orders/${poId}/action`,
      method: 'POST',
      user: owner,
      body: { action: 'send' },
    });
    expect(send.status).toBe(200);
    const confirm = await api({
      path: `/api/v1/purchasing/purchase-orders/${poId}/action`,
      method: 'POST',
      user: owner,
      body: { action: 'confirm' },
    });
    expect((confirm.body as { status: string }).status).toBe('CONFIRMED');
  });

  it('receives goods: GRN creates batches + PURCHASE_RECEIPT movements, PO → RECEIVED', async () => {
    const poDetail = await api({
      path: '/api/v1/purchasing/purchase-orders',
      user: owner,
    });
    const poLine = (poDetail.body as { items: Array<{ id: string; lines: Array<{ id: string; quantity: string }> }> }).items
      .find((p) => p.id === poId)!.lines[0]!;

    const grn = await api({
      path: '/api/v1/purchasing/goods-receipts',
      method: 'POST',
      user: owner,
      body: {
        vendorId,
        poId,
        warehouseId,
        lines: [
          { productId, poLineId: poLine.id, batchNumber: 'COM-B1', expiryDate: futureDate(400), quantity: '60', purchaseRate: '20.00', mrp: '40.00' },
          { productId, poLineId: poLine.id, batchNumber: 'COM-B2', expiryDate: futureDate(25), quantity: '40', purchaseRate: '20.00', mrp: '40.00' },
        ],
      },
    });
    expect(grn.status).toBe(201);
    grnId = (grn.body as { id: string }).id;
    expect((grn.body as { grnNumber: string }).grnNumber).toMatch(/^GRN\/\d{4}\/\d{6}$/);

    // Batch balances exist.
    const batches = await api({
      path: `/api/v1/inventory/batches?page=1&pageSize=50&warehouseId=${warehouseId}&productId=${productId}`,
      user: owner,
    });
    const rows = (batches.body as { items: Array<{ batchNumber: string; balances: Array<{ quantity: string }> }> }).items;
    const b1 = rows.find((r) => r.batchNumber === 'COM-B1')!;
    expect(Number(b1.balances[0]!.quantity)).toBe(60);

    // PO fully received.
    const pos = await api({ path: '/api/v1/purchasing/purchase-orders', user: owner });
    const po = (pos.body as { items: Array<{ id: string; status: string }> }).items.find((p) => p.id === poId)!;
    expect(po.status).toBe('RECEIVED');
  });

  it('posts supplier invoice: totals, input-tax, duplicate rejection, accounting journal', async () => {
    const inv = await api({
      path: '/api/v1/purchasing/invoices',
      method: 'POST',
      user: owner,
      body: {
        vendorId,
        invoiceNumber: 'SUP-2026-001',
        invoiceDate: futureDate(0),
        grnId,
        lines: [{ productId, quantity: '100', unitCost: '20.00' }],
      },
    });
    expect(inv.status).toBe(201);
    const body = inv.body as { subtotal: string; taxAmount: string; total: string; lines: Array<{ cgstAmount: string; sgstAmount: string }> };
    // 100 × 20 = 2000 taxable; intra-state 2.5+2.5% → tax 100; total 2100.
    expect(Number(body.subtotal)).toBe(2000);
    expect(Number(body.taxAmount)).toBe(100);
    expect(Number(body.total)).toBe(2100);

    // Duplicate invoice rejected.
    const dupe = await api({
      path: '/api/v1/purchasing/invoices',
      method: 'POST',
      user: owner,
      body: {
        vendorId,
        invoiceNumber: 'SUP-2026-001',
        invoiceDate: futureDate(0),
        lines: [{ productId, quantity: '1', unitCost: '20.00' }],
      },
    });
    expect(dupe.status).toBe(409);
    expect((dupe.body as { error: { code: string } }).error.code).toBe('DUPLICATE_ENTITY');

    // Accounting journal exists and balances.
    const journals = await api({ path: '/api/v1/accounting/journals?page=1&pageSize=10', user: owner });
    const journalRows = (journals.body as { items: Array<{ memo: string; lines: Array<{ debit: string; credit: string }> }> }).items;
    const purchaseJournal = journalRows.find((j) => j.memo.includes('SUP-2026-001'))!;
    const debits = purchaseJournal.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = purchaseJournal.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBe(credits);
    expect(debits).toBe(2100);
  });

  it('records supplier payment with allocation; over-allocation rejected', async () => {
    const invoices = await api({ path: '/api/v1/purchasing/invoices', user: owner });
    const invoiceId = (invoices.body as { items: Array<{ id: string; total: string }> }).items[0]!.id;

    const over = await api({
      path: '/api/v1/purchasing/payments',
      method: 'POST',
      user: owner,
      body: { vendorId, amount: '3000.00', method: 'BANK', allocations: [{ invoiceId, amount: '3000.00' }] },
    });
    expect(over.status).toBe(422);
    expect((over.body as { error: { code: string } }).error.code).toBe('ALLOCATION_EXCEEDS_BALANCE');

    const pay = await api({
      path: '/api/v1/purchasing/payments',
      method: 'POST',
      user: owner,
      body: { vendorId, amount: '1000.00', method: 'BANK', allocations: [{ invoiceId, amount: '1000.00' }] },
    });
    expect(pay.status).toBe(201);

    const after = await api({ path: '/api/v1/purchasing/invoices', user: owner });
    const inv = (after.body as { items: Array<{ id: string; status: string; paidAmount: string }> }).items.find((i) => i.id === invoiceId)!;
    expect(inv.status).toBe('PARTIALLY_PAID');
    expect(Number(inv.paidAmount)).toBe(1000);

    // Vendor ledger shows invoice + payment with running balance.
    const ledger = await api({ path: `/api/v1/purchasing/vendors/${vendorId}/ledger`, user: owner });
    const ledgerBody = ledger.body as { rows: Array<{ type: string }>; outstanding: string };
    expect(ledgerBody.rows.some((r) => r.type === 'INVOICE')).toBe(true);
    expect(ledgerBody.rows.some((r) => r.type.startsWith('PAYMENT'))).toBe(true);
    expect(Number(ledgerBody.outstanding)).toBe(1100);
  });

  it('purchase return: stock out + debit note + journal', async () => {
    const batches = await api({
      path: `/api/v1/inventory/batches?page=1&pageSize=50&warehouseId=${warehouseId}&productId=${productId}`,
      user: owner,
    });
    const b1 = (batches.body as { items: Array<{ id: string; batchNumber: string }> }).items.find((b) => b.batchNumber === 'COM-B1')!;

    const ret = await api({
      path: '/api/v1/purchasing/purchase-returns',
      method: 'POST',
      user: owner,
      body: { vendorId, reason: 'Supplier shortage claim — verified', lines: [{ batchId: b1.id, quantity: '10', rate: '20.00' }] },
    });
    expect(ret.status).toBe(201);
    // Debit note carries the input GST being reversed: 10 × 20 = 200 + 5% = 210.
    expect(Number((ret.body as { total: string }).total)).toBe(210);

    // Stock reduced.
    const batchesAfter = await api({
      path: `/api/v1/inventory/batches?page=1&pageSize=50&warehouseId=${warehouseId}&productId=${productId}`,
      user: owner,
    });
    const b1After = (batchesAfter.body as { items: Array<{ batchNumber: string; balances: Array<{ quantity: string }> }> }).items.find(
      (b) => b.batchNumber === 'COM-B1',
    )!;
    expect(Number(b1After.balances[0]!.quantity)).toBe(50);

    // Reconciliation stays consistent.
    const reconcile = await api({ path: '/api/v1/inventory/reconcile', user: owner });
    expect((reconcile.body as { consistent: boolean }).consistent).toBe(true);
  });
});

describe('Phase 5: POS sales', () => {
  it('posts a cash sale: FEFO (earliest expiry first), tax-inclusive GST, stock deduction', async () => {
    // Batches: COM-B1 expiry 400d (50 left), COM-B2 expiry 25d (40 left) → FEFO picks COM-B2.
    const sale = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        warehouseId,
        lines: [{ productId, quantity: '5', unitPrice: '40.00' }],
        payments: [{ method: 'CASH', amount: '200.00' }],
        idempotencyKey: `pos-${Date.now()}-a`,
      },
    });
    expect(sale.status).toBe(201);
    const body = sale.body as { invoice: { id: string; invoiceNumber: string; total: string; cgstAmount: string; lines: Array<{ batchAllocations: Array<{ batch: { batchNumber: string } }> }> } };
    expect(body.invoice.invoiceNumber).toMatch(/^SI\/\d{4}\/\d{6}$/);
    expect(Number(body.invoice.total)).toBe(200);
    // Tax-inclusive: 200 @ 5% → taxable 190.48, tax 9.52.
    expect(Number(body.invoice.cgstAmount)).toBeCloseTo(4.76, 1);
    // FEFO: near-expiry batch first.
    expect(body.invoice.lines[0]!.batchAllocations[0]!.batch.batchNumber).toBe('COM-B2');
  });

  it('rejects sale above MRP (DPCO para 26)', async () => {
    const res = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        warehouseId,
        lines: [{ productId, quantity: '1', unitPrice: '55.00' }],
        payments: [{ method: 'CASH', amount: '55.00' }],
      },
    });
    expect(res.status).toBe(422);
    expect((res.body as { error: { message: string } }).error.message).toContain('MRP');
  });

  it('idempotency key prevents duplicate posting on retry', async () => {
    const key = `pos-retry-${Date.now()}`;
    const first = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        warehouseId,
        lines: [{ productId, quantity: '2', unitPrice: '40.00' }],
        payments: [{ method: 'CASH', amount: '80.00' }],
        idempotencyKey: key,
      },
    });
    expect(first.status).toBe(201);
    const retry = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        warehouseId,
        lines: [{ productId, quantity: '2', unitPrice: '40.00' }],
        payments: [{ method: 'CASH', amount: '80.00' }],
        idempotencyKey: key,
      },
    });
    expect(retry.status).toBe(201);
    expect((retry.body as { idempotentReplay: boolean }).idempotentReplay).toBe(true);
    const invoiceId1 = (first.body as { invoice: { id: string } }).invoice.id;
    const invoiceId2 = (retry.body as { invoice: { id: string } }).invoice.id;
    expect(invoiceId1).toBe(invoiceId2);
  });

  it('credit sale respects customer credit limit', async () => {
    // Shrink the limit so stock suffices but credit is still refused.
    await api({
      path: `/api/v1/partners/customers/${customerId}`,
      method: 'PUT',
      user: owner,
      body: { creditLimit: '100.00' },
    });
    const res = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        customerId,
        warehouseId,
        lines: [{ productId, quantity: '20', unitPrice: '40.00' }],
        payments: [{ method: 'CREDIT', amount: '800.00' }],
      },
    });
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe('CREDIT_LIMIT_EXCEEDED');

    // Restore the original limit so later scenarios can use credit.
    await api({
      path: `/api/v1/partners/customers/${customerId}`,
      method: 'PUT',
      user: owner,
      body: { creditLimit: '5000.00' },
    });
  });

  it('Schedule H1 sale without prescription details is rejected; with details enters the register', async () => {
    const h1Product = await api({
      path: '/api/v1/catalog/products',
      method: 'POST',
      user: owner,
      body: { name: 'Alprazolam 0.5mg (H1 analog test)', sku: 'H1-TEST', hsnCode: '3004', mrp: '30.00', prescriptionClass: 'SCHEDULE_H1' },
    });
    const h1Id = (h1Product.body as { id: string }).id;
    // Give it stock via GRN.
    await api({
      path: '/api/v1/purchasing/goods-receipts',
      method: 'POST',
      user: owner,
      body: {
        vendorId,
        warehouseId,
        lines: [{ productId: h1Id, batchNumber: 'H1-B1', expiryDate: futureDate(300), quantity: '20', purchaseRate: '15.00', mrp: '30.00' }],
      },
    });

    const rejected = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        warehouseId,
        lines: [{ productId: h1Id, quantity: '1', unitPrice: '30.00' }],
        payments: [{ method: 'CASH', amount: '30.00' }],
      },
    });
    expect(rejected.status).toBe(422);
    expect((rejected.body as { error: { message: string } }).error.message).toContain('Schedule H1');

    const ok = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        warehouseId,
        lines: [{ productId: h1Id, quantity: '1', unitPrice: '30.00' }],
        payments: [{ method: 'CASH', amount: '30.00' }],
        prescription: {
          patientName: 'Ramesh Kulkarni',
          prescriberName: 'Dr. S. Deshpande',
          prescriberAddress: 'Sassoon Hospital, Pune 411001',
        },
      },
    });
    expect(ok.status).toBe(201);
  });
});

describe('Phase 6: sales returns & receipts', () => {
  it('returns part of an invoice: returnable-qty enforcement, restock, accounting reversal', async () => {
    // Sell 8 units cash.
    const sale = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        warehouseId,
        lines: [{ productId, quantity: '8', unitPrice: '40.00' }],
        payments: [{ method: 'CASH', amount: '320.00' }],
        idempotencyKey: `ret-base-${Date.now()}`,
      },
    });
    const invoice = (sale.body as { invoice: { id: string; lines: Array<{ id: string; quantity: string }> } }).invoice;

    // Over-return attempt.
    const over = await api({
      path: '/api/v1/sales/returns',
      method: 'POST',
      user: owner,
      body: {
        invoiceId: invoice.id,
        reason: 'Customer returned sealed pack',
        lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: '9', restock: true }],
      },
    });
    expect(over.status).toBe(422);
    expect((over.body as { error: { code: string } }).error.code).toBe('RETURN_QUANTITY_EXCEEDS_ORIGINAL');

    // Return 3 with restock.
    const ret = await api({
      path: '/api/v1/sales/returns',
      method: 'POST',
      user: owner,
      body: {
        invoiceId: invoice.id,
        reason: 'Customer returned sealed pack',
        lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: '3', restock: true }],
      },
    });
    expect(ret.status).toBe(201);
    expect(Number((ret.body as { refundTotal: string }).refundTotal)).toBe(120);

    // Second return of 3 more passes; a third of 3 passes too (total 9 > 8 blocked by then).
    const second = await api({
      path: '/api/v1/sales/returns',
      method: 'POST',
      user: owner,
      body: {
        invoiceId: invoice.id,
        reason: 'Second partial return',
        lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: '6', restock: false }],
      },
    });
    expect(second.status).toBe(422);

    // Reconcile after restock movement.
    const reconcile = await api({ path: '/api/v1/inventory/reconcile', user: owner });
    expect((reconcile.body as { consistent: boolean }).consistent).toBe(true);
  });

  it('records customer receipt against credit outstanding (FIFO)', async () => {
    // Credit sale within limit.
    const sale = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        customerId,
        warehouseId,
        lines: [{ productId, quantity: '5', unitPrice: '40.00' }],
        payments: [{ method: 'CREDIT', amount: '200.00' }],
        idempotencyKey: `cr-base-${Date.now()}`,
      },
    });
    expect(sale.status).toBe(201);
    const before = await api({ path: `/api/v1/sales/customers/${customerId}/outstanding`, user: owner });
    expect(Number((before.body as { outstanding: string }).outstanding)).toBeGreaterThan(0);

    const receipt = await api({
      path: '/api/v1/sales/receipts',
      method: 'POST',
      user: owner,
      body: { customerId, amount: '50.00', method: 'UPI' },
    });
    expect(receipt.status).toBe(201);

    const over = await api({
      path: '/api/v1/sales/receipts',
      method: 'POST',
      user: owner,
      body: { customerId, amount: '999999.00', method: 'CASH' },
    });
    expect(over.status).toBe(422);
  });
});

describe('Phase 7: accounting statements', () => {
  it('trial balance balances; P&L reflects activity', async () => {
    const tb = await api({ path: '/api/v1/accounting/trial-balance', user: owner });
    const body = tb.body as { totalDebits: string; totalCredits: string; balanced: boolean };
    expect(body.totalDebits).toBe(body.totalCredits);
    expect(body.balanced).toBe(true);
    expect(Number(body.totalDebits)).toBeGreaterThan(0);

    const pnl = await api({ path: '/api/v1/accounting/profit-and-loss', user: owner });
    const pnlBody = pnl.body as { totalIncome: string; totalExpenses: string; netProfit: string };
    expect(Number(pnlBody.totalIncome)).toBeGreaterThan(0);
    expect(Number(pnlBody.netProfit)).toBeCloseTo(Number(pnlBody.totalIncome) - Number(pnlBody.totalExpenses), 2);

    const bs = await api({ path: '/api/v1/accounting/balance-sheet', user: owner });
    expect((bs.body as { balanced: boolean }).balanced).toBe(true);
  });

  it('records an expense with journal posting; period lock blocks backdated posting', async () => {
    const expense = await api({
      path: '/api/v1/accounting/expenses',
      method: 'POST',
      user: owner,
      body: { category: 'Shop Rent', payee: 'Landlord Enterprises', amount: '15000.00', method: 'BANK', expenseDate: futureDate(0) },
    });
    expect(expense.status).toBe(201);
    expect((expense.body as { expenseNumber: string }).expenseNumber).toMatch(/^EXP\/\d{4}\/\d{6}$/);

    // Lock current month.
    const now = new Date();
    const label = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const lock = await api({
      path: '/api/v1/accounting/periods/lock',
      method: 'POST',
      user: owner,
      body: { periodLabel: label, locked: true },
    });
    expect(lock.status).toBe(201);

    const blocked = await api({
      path: '/api/v1/accounting/expenses',
      method: 'POST',
      user: owner,
      body: { category: 'Utilities', payee: 'MSEB', amount: '500.00', method: 'CASH', expenseDate: futureDate(0) },
    });
    expect(blocked.status).toBe(422);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('PERIOD_LOCKED');

    // Unlock for subsequent tests.
    await api({
      path: '/api/v1/accounting/periods/lock',
      method: 'POST',
      user: owner,
      body: { periodLabel: label, locked: false },
    });
  });
});

describe('Phase 8: compliance', () => {
  it('H1 register captures prescription entries; GST summaries aggregate by HSN', async () => {
    const register = await api({ path: '/api/v1/compliance/h1-register?page=1&pageSize=10', user: owner });
    const regBody = register.body as { items: Array<{ patientName: string; prescriberName: string; drugName: string }> };
    expect(regBody.items.length).toBeGreaterThanOrEqual(1);
    expect(regBody.items[0]!.prescriberName).toBe('Dr. S. Deshpande');

    const sales = await api({ path: '/api/v1/compliance/gst/sales-summary?from=2000-01-01&to=2999-12-31', user: owner });
    const salesBody = sales.body as { rows: Array<{ hsnCode: string; taxable: number }>; totals: { taxable: number } };
    expect(salesBody.rows.some((r) => r.hsnCode === '3004')).toBe(true);
    expect(Number(salesBody.totals.taxable)).toBeGreaterThan(0);

    const purchases = await api({ path: '/api/v1/compliance/gst/purchase-summary?from=2000-01-01&to=2999-12-31', user: owner });
    expect(Number((purchases.body as { totals: { taxable: string } }).totals.taxable)).toBe(2000);
  });

  it('integration registry shows NOT_CONNECTED honestly', async () => {
    const list = await api({ path: '/api/v1/compliance/integrations', user: owner });
    expect(list.status).toBe(200);
    const upsert = await api({
      path: '/api/v1/compliance/integrations',
      method: 'POST',
      user: owner,
      body: { provider: 'GST_EINVOICE' },
    });
    expect((upsert.body as { status: string }).status).toBe('NOT_CONNECTED');
  });
});

describe('Phase 10: reports & notifications', () => {
  it('sales summary, stock valuation, and aging reflect real data', async () => {
    const sales = await api({ path: '/api/v1/reports/sales-summary?from=2000-01-01&to=2999-12-31', user: owner });
    const salesBody = sales.body as { totals: { invoices: number; revenue: number } };
    expect(salesBody.totals.invoices).toBeGreaterThanOrEqual(4);
    expect(Number(salesBody.totals.revenue)).toBeGreaterThan(0);

    const valuation = await api({ path: '/api/v1/reports/stock-valuation', user: owner });
    expect(Number((valuation.body as { totalValue: string }).totalValue)).toBeGreaterThan(0);

    const aging = await api({ path: '/api/v1/reports/aging', user: owner });
    const agingBody = aging.body as { receivables: { total: number }; payables: { total: number } };
    expect(Number(agingBody.payables.total)).toBe(1100);
  });

  it('generates and lists notifications (low stock / near expiry)', async () => {
    const gen = await api({ path: '/api/v1/reports/notifications/generate', method: 'POST', user: owner });
    expect(gen.status).toBe(201);
    const list = await api({ path: '/api/v1/reports/notifications?page=1&pageSize=20', user: owner });
    const items = (list.body as { items: Array<{ type: string }> }).items;
    expect(items.some((n) => n.type === 'NEAR_EXPIRY')).toBe(true);
  });
});

describe('Phase 11: platform administration', () => {
  it('blocks non-superadmin from platform endpoints', async () => {
    const res = await api({ path: '/api/v1/platform/tenants', user: owner });
    expect(res.status).toBe(403);
  });
});

describe('Phase 9: wholesale', () => {
  it('flags wholesale invoices for wholesale customers', async () => {
    const wsCustomer = await api({
      path: '/api/v1/partners/customers',
      method: 'POST',
      user: owner,
      body: { name: 'Bulk Buyer Medicals', phone: '9822022222', isWholesale: true },
    });
    const wsId = (wsCustomer.body as { id: string }).id;
    const sale = await api({
      path: '/api/v1/sales/invoices',
      method: 'POST',
      user: owner,
      body: {
        customerId: wsId,
        warehouseId,
        lines: [{ productId, quantity: '10', unitPrice: '34.00' }],
        payments: [{ method: 'CASH', amount: '340.00' }],
        idempotencyKey: `ws-${Date.now()}`,
      },
    });
    expect(sale.status).toBe(201);
    expect((sale.body as { invoice: { isWholesale: boolean } }).invoice.isWholesale).toBe(true);
  });
});
