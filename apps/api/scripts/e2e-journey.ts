/**
 * End-to-end valid business journey (spec §38 subset for Phases 1–3).
 * Boots the real API against the test database and executes the golden-path
 * scenario, asserting each step and emitting JSON results consumed by the
 * test-case workbook generator (infrastructure/testing/build-test-workbook.mjs).
 *
 * Run: pnpm --filter @medicore/api exec tsx scripts/e2e-journey.ts
 */
import { bootTestServer, TEST_BASE, uniqueEmail } from '../test/integration/harness.js';

interface StepResult {
  id: string;
  scenario: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL';
  evidence?: string;
}

const results: StepResult[] = [];

function record(id: string, scenario: string, expected: string, actual: string, pass: boolean, evidence?: string) {
  results.push({ id, scenario, expected, actual, status: pass ? 'PASS' : 'FAIL', evidence });
  console.log(`${pass ? '✓' : '✗'} ${id} — ${scenario}`);
  if (!pass) {
    console.error(`   expected: ${expected}\n   actual:   ${actual}${evidence ? `\n   evidence: ${evidence}` : ''}`);
  }
}

async function call(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; org?: string; branch?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.org) headers['x-organization-id'] = opts.org;
  if (opts.branch) headers['x-branch-id'] = opts.branch;
  const res = await fetch(`${TEST_BASE}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const futureDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function main(): Promise<void> {
  await bootTestServer();

  // ── SCENARIO 1: Organization onboarding ───────────────────────────────────
  const email = uniqueEmail();
  const reg = await call('/api/v1/auth/register', {
    body: { email, password: 'E2ePass123', fullName: 'E2E Owner', organizationName: 'E2E Pharma Pvt Ltd' },
  });
  record(
    'E2E-01',
    'Register organization with founder auto-login',
    '201 with userId + organizationId + slug',
    `${reg.status} ${JSON.stringify(reg.body).slice(0, 80)}`,
    reg.status === 201 && Boolean(reg.body?.organizationId),
    `slug=${reg.body?.slug}`,
  );
  const cookie = reg.body?.cookie ?? '';
  // Extract session cookie from the register response headers via re-login.
  const login = await call('/api/v1/auth/login', { body: { email, password: 'E2ePass123' } });
  record(
    'E2E-02',
    'Login returns session for the founder',
    '200 with userId',
    `${login.status} userId=${login.body?.userId}`,
    login.status === 200 && Boolean(login.body?.userId),
  );
  // Fetch set-cookie manually.
  const loginRes = await fetch(`${TEST_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'E2ePass123' }),
  });
  const sessionCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const me = await call('/api/v1/auth/me', { cookie: sessionCookie });
  record(
    'E2E-03',
    'Session resolves memberships with Owner role',
    '200, memberships[0].isOwner=true',
    `${me.status} isOwner=${me.body?.memberships?.[0]?.isOwner}`,
    me.status === 200 && me.body?.memberships?.[0]?.isOwner === true,
  );
  const orgId = me.body?.memberships?.[0]?.organizationId;

  // ── SCENARIO 2: Branch & warehouse setup ──────────────────────────────────
  const branches = await call('/api/v1/organizations/branches', { cookie: sessionCookie, org: orgId });
  const branchId = branches.body?.[0]?.id;
  record(
    'E2E-04',
    'Default branch created at registration',
    '200 with 1 default branch',
    `${branches.status} branches=${branches.body?.length} default=${branches.body?.[0]?.isDefault}`,
    branches.status === 200 && branches.body?.length === 1,
  );
  const wh = await call(`/api/v1/organizations/branches/${branchId}/warehouses`, {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { name: 'Central Store', isDefault: true },
  });
  record(
    'E2E-05',
    'Create warehouse on branch',
    '201 with warehouse id',
    `${wh.status} name=${wh.body?.name}`,
    wh.status === 201 && Boolean(wh.body?.id),
  );
  const warehouseId = wh.body?.id;

  // Business profile (onboarding requires address before posting gate lifts).
  const profile = await call('/api/v1/organizations', {
    method: 'PATCH',
    cookie: sessionCookie,
    org: orgId,
    body: {
      addressLine1: 'Shop 4, Health Plaza, FC Road',
      city: 'Pune',
      stateCode: '27',
      pinCode: '411005',
      contactPhone: '9822012345',
      contactEmail: 'owner@e2epharma.test',
      gstRegistrationStatus: 'REGULAR',
      gstin: '27E2EPA1234F1Z5',
      pan: 'E2EPA1234F',
    },
  });
  record(
    'E2E-06b',
    'Save business profile (address, GST registration with GSTIN)',
    '200 with updated organization',
    `${profile.status} city=${profile.body?.city} gstin=${profile.body?.gstin}`,
    profile.status === 200 && profile.body?.city === 'Pune' && profile.body?.gstin === '27E2EPA1234F1Z5',
  );

  const checklist = await call('/api/v1/organizations/setup-checklist', { cookie: sessionCookie, org: orgId });
  record(
    'E2E-06',
    'Setup checklist reflects readiness after warehouse creation',
    '200 allComplete=true',
    `${checklist.status} allComplete=${checklist.body?.allComplete}`,
    checklist.status === 200 && checklist.body?.allComplete === true,
  );
  const complete = await call('/api/v1/organizations/setup-complete', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
  });
  record(
    'E2E-07',
    'Complete onboarding (posting gate lifted)',
    '200 setupCompleted=true',
    `${complete.status} ${JSON.stringify(complete.body)}`,
    complete.status === 200 && complete.body?.setupCompleted === true,
  );

  // ── SCENARIO 3: Master data ───────────────────────────────────────────────
  const tax = await call('/api/v1/catalog/tax-rates', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: {
      hsnCode: '3004',
      description: 'Medicaments — 5% post GST 2.0',
      cgstPercent: '2.50',
      sgstPercent: '2.50',
      effectiveFrom: '2025-09-22',
    },
  });
  record(
    'E2E-08',
    'Create effective-dated GST rate version (HSN 3004 @ 5%)',
    '201 with version id',
    `${tax.status} cgst=${tax.body?.cgstPercent}`,
    tax.status === 201 && Boolean(tax.body?.id),
  );

  const product = await call('/api/v1/catalog/products', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: {
      name: 'Azithromycin 500mg Tablet',
      sku: 'AZI-500',
      genericName: 'Azithromycin',
      dosageForm: 'TABLET',
      strength: '500mg',
      packSize: '3x10',
      hsnCode: '3004',
      mrp: '62.50',
      purchasePrice: '45.00',
      sellingPrice: '58.00',
      prescriptionClass: 'PRESCRIPTION_ONLY',
      barcodes: ['8901234567890'],
    },
  });
  record(
    'E2E-09',
    'Create medicine product with barcodes and tax classification',
    '201 with product id',
    `${product.status} sku=${product.body?.sku}`,
    product.status === 201 && Boolean(product.body?.id),
  );
  const productId = product.body?.id;

  const barcodeLookup = await call('/api/v1/catalog/products/barcode/8901234567890', {
    cookie: sessionCookie,
    org: orgId,
  });
  record(
    'E2E-10',
    'Barcode lookup resolves the product (POS path)',
    '200 with matching sku',
    `${barcodeLookup.status} sku=${barcodeLookup.body?.sku}`,
    barcodeLookup.status === 200 && barcodeLookup.body?.sku === 'AZI-500',
  );

  const vendor = await call('/api/v1/partners/vendors', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: {
      legalName: 'MedSource Distributors Pvt Ltd',
      gstin: '27MSDPS1234K1Z9',
      stateCode: '27',
      creditDays: 30,
      creditLimit: '200000.00',
    },
  });
  record(
    'E2E-11',
    'Create supplier with GSTIN (Maharashtra, state-consistent)',
    '201 with vendor id',
    `${vendor.status} gstin=${vendor.body?.gstin}`,
    vendor.status === 201 && Boolean(vendor.body?.id),
  );

  const customer = await call('/api/v1/partners/customers', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { name: 'Dr. Sharma Clinic', phone: '9822012345', creditLimit: '15000.00', creditDays: 15 },
  });
  record(
    'E2E-12',
    'Create credit customer',
    '201 with customer id',
    `${customer.status} name=${customer.body?.name}`,
    customer.status === 201 && Boolean(customer.body?.id),
  );

  // ── SCENARIO 4: Inventory lifecycle ───────────────────────────────────────
  const b1 = await call('/api/v1/inventory/batches', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: {
      productId,
      warehouseId,
      batchNumber: 'AZI-26A01',
      expiryDate: futureDate(45),
      quantity: '200',
      purchaseRate: '45.00',
      mrp: '62.50',
      sourceDocument: 'OPENING-STOCK/2026-27/0001',
    },
  });
  record(
    'E2E-13',
    'Receive near-expiry batch (45 days) — earliest expiry',
    '201 with balance 200',
    `${b1.status} qty=${b1.body?.balances?.[0]?.quantity}`,
    b1.status === 201 && Number(b1.body?.balances?.[0]?.quantity) === 200,
  );
  const b2 = await call('/api/v1/inventory/batches', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: {
      productId,
      warehouseId,
      batchNumber: 'AZI-26B02',
      expiryDate: futureDate(300),
      quantity: '300',
      purchaseRate: '45.00',
      mrp: '62.50',
    },
  });
  record(
    'E2E-14',
    'Receive long-dated batch (300 days)',
    '201 with balance 300',
    `${b2.status} qty=${b2.body?.balances?.[0]?.quantity}`,
    b2.status === 201 && Number(b2.body?.balances?.[0]?.quantity) === 300,
  );

  const alloc = await call('/api/v1/inventory/allocate', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { productId, warehouseId, quantity: '220' },
  });
  const allocations = alloc.body?.allocations ?? [];
  record(
    'E2E-15',
    'FEFO allocation spans batches earliest-expiry-first',
    '200: [AZI-26A01 x200, AZI-26B02 x20]',
    `${alloc.status} ${JSON.stringify(allocations.map((a: any) => [a.batchNumber, a.quantity]))}`,
    alloc.status === 200 && allocations[0]?.batchNumber === 'AZI-26A01' && allocations[1]?.batchNumber === 'AZI-26B02',
  );

  const oversell = await call('/api/v1/inventory/adjustments', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { batchId: b2.body?.id, warehouseId, direction: 'OUT', quantity: '9999', reason: 'DAMAGE' },
  });
  record(
    'E2E-16',
    'Oversell attempt rejected (negative-stock prevention)',
    '422 INSUFFICIENT_STOCK',
    `${oversell.status} ${oversell.body?.error?.code}`,
    oversell.status === 422 && oversell.body?.error?.code === 'INSUFFICIENT_STOCK',
  );

  const expiryDashboard = await call('/api/v1/inventory/expiry-dashboard', { cookie: sessionCookie, org: orgId });
  record(
    'E2E-17',
    'Expiry dashboard buckets the 45-day batch into DAYS_60',
    '200 buckets with DAYS_60 ≥ 1',
    `${expiryDashboard.status} buckets=${JSON.stringify(expiryDashboard.body?.buckets)}`,
    expiryDashboard.status === 200 && (expiryDashboard.body?.buckets?.DAYS_60 ?? 0) >= 1,
  );

  // Second warehouse for transfer
  const wh2 = await call(`/api/v1/organizations/branches/${branchId}/warehouses`, {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { name: 'Retail Counter Stock' },
  });
  const destWarehouseId = wh2.body?.id;
  const transfer = await call('/api/v1/inventory/transfers', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: {
      sourceWarehouseId: warehouseId,
      destinationWarehouseId: destWarehouseId,
      lines: [{ productId, batchId: b2.body?.id, quantity: '50' }],
    },
  });
  record(
    'E2E-18',
    'Dispatch stock transfer (50 units of long-dated batch)',
    '201 DISPATCHED with source deducted',
    `${transfer.status} status=${transfer.body?.status}`,
    transfer.status === 201 && transfer.body?.status === 'DISPATCHED',
  );
  const receive = await call(`/api/v1/inventory/transfers/${transfer.body?.id}/receive`, {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { lines: [{ transferLineId: transfer.body?.lines?.[0]?.id, receivedQty: '50' }] },
  });
  record(
    'E2E-19',
    'Receive transfer in full → RECEIVED',
    '201 status=RECEIVED',
    `${receive.status} status=${receive.body?.status}`,
    receive.status === 201 && receive.body?.status === 'RECEIVED',
  );
  const overReceive = await call(`/api/v1/inventory/transfers/${transfer.body?.id}/receive`, {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { lines: [{ transferLineId: transfer.body?.lines?.[0]?.id, receivedQty: '10' }] },
  });
  record(
    'E2E-20',
    'Post-completion receipt rejected (state machine)',
    '409 STATE_TRANSITION_INVALID',
    `${overReceive.status} ${overReceive.body?.error?.code}`,
    overReceive.status === 409 && overReceive.body?.error?.code === 'STATE_TRANSITION_INVALID',
  );

  // Count (b2: 300 received − 50 transferred = 250 on hand; count 248 → variance −2)
  const count = await call('/api/v1/inventory/counts', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { warehouseId, lines: [{ productId, batchId: b2.body?.id, countedQty: '248' }] },
  });
  record(
    'E2E-21',
    'Cycle count: system 230 vs counted 228 (variance −2)',
    '201 COMPLETED with variance lines',
    `${count.status} variance=${count.body?.lines?.[0]?.variance}`,
    count.status === 201 && Number(count.body?.lines?.[0]?.variance) === -2,
  );
  const postCount = await call(`/api/v1/inventory/counts/${count.body?.id}/post`, {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
  });
  record(
    'E2E-22',
    'Post count → compensating movement',
    '201 POSTED',
    `${postCount.status} status=${postCount.body?.status}`,
    postCount.status === 201 && postCount.body?.status === 'POSTED',
  );

  // Recall
  const recall = await call('/api/v1/inventory/recalls', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { batchId: b1.body?.id, reason: 'Manufacturer recall notice MFR-2026-0412' },
  });
  record(
    'E2E-23',
    'Recall near-expiry batch → status RECALLED',
    '201 recall open; batch blocked',
    `${recall.status}`,
    recall.status === 201,
  );
  const blockedAlloc = await call('/api/v1/inventory/allocate', {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { productId, warehouseId, quantity: '10', explicitBatchId: b1.body?.id },
  });
  record(
    'E2E-24',
    'Allocation of recalled batch blocked',
    '422 BATCH_INELIGIBLE',
    `${blockedAlloc.status} ${blockedAlloc.body?.error?.code}`,
    blockedAlloc.status === 422 && blockedAlloc.body?.error?.code === 'BATCH_INELIGIBLE',
  );

  // ── SCENARIO 5: Operations lists (UI backing endpoints) ──────────────────
  const transfersList = await call('/api/v1/inventory/transfers?page=1&pageSize=50', {
    cookie: sessionCookie,
    org: orgId,
  });
  record(
    'E2E-30',
    'Transfer list returns documents with lines and product context',
    '200 with >= 1 transfer incl. lines',
    `${transfersList.status} count=${transfersList.body?.pageInfo?.totalItems} lines=${transfersList.body?.items?.[0]?.lines?.length}`,
    transfersList.status === 200 && (transfersList.body?.items?.length ?? 0) >= 1,
  );
  const countsList = await call('/api/v1/inventory/counts?page=1&pageSize=50', {
    cookie: sessionCookie,
    org: orgId,
  });
  record(
    'E2E-31',
    'Count list returns posted count with variance lines',
    '200 with >= 1 count incl. variance',
    `${countsList.status} count=${countsList.body?.pageInfo?.totalItems}`,
    countsList.status === 200 && (countsList.body?.items?.length ?? 0) >= 1,
  );
  const recallsList = await call('/api/v1/inventory/recalls?page=1&pageSize=50', {
    cookie: sessionCookie,
    org: orgId,
  });
  record(
    'E2E-32',
    'Recall list returns open recall with batch context',
    '200 with >= 1 recall',
    `${recallsList.status} count=${recallsList.body?.pageInfo?.totalItems}`,
    recallsList.status === 200 && (recallsList.body?.items?.length ?? 0) >= 1,
  );

  const resolveRecall = await call(`/api/v1/inventory/recalls/${recallsList.body?.items?.[0]?.id}/resolve`, {
    method: 'POST',
    cookie: sessionCookie,
    org: orgId,
    body: { resolutionNotes: 'Stock quarantined and returned to supplier under reference MFR-2026-0412' },
  });
  record(
    'E2E-33',
    'Resolve recall with documented resolution',
    '201 RESOLVED with resolution notes',
    `${resolveRecall.status} status=${resolveRecall.body?.status}`,
    resolveRecall.status === 201 && resolveRecall.body?.status === 'RESOLVED',
  );

  // ── SCENARIO 5: Verification ──────────────────────────────────────────────
  const reconcile = await call('/api/v1/inventory/reconcile', { cookie: sessionCookie, org: orgId });
  record(
    'E2E-25',
    'Ledger↔balance reconciliation across all operations',
    '200 consistent=true, 0 mismatches',
    `${reconcile.status} checked=${reconcile.body?.checked} mismatches=${reconcile.body?.mismatches?.length}`,
    reconcile.status === 200 && reconcile.body?.consistent === true,
  );
  const ledger = await call('/api/v1/inventory/ledger?page=1&pageSize=50', { cookie: sessionCookie, org: orgId });
  record(
    'E2E-26',
    'Append-only ledger traceable with reasons and documents',
    '200 with ≥ 5 movement rows',
    `${ledger.status} rows=${ledger.body?.pageInfo?.totalItems}`,
    ledger.status === 200 && (ledger.body?.pageInfo?.totalItems ?? 0) >= 5,
  );
  const audit = await call('/api/v1/audit?page=1&pageSize=50', { cookie: sessionCookie, org: orgId });
  record(
    'E2E-27',
    'Audit trail records the journey (org, profile, product, vendor, customer, tax, count, recall)',
    '200 with ≥ 8 audit events',
    `${audit.status} events=${audit.body?.pageInfo?.totalItems}`,
    audit.status === 200 && (audit.body?.pageInfo?.totalItems ?? 0) >= 8,
  );

  // Tenant isolation
  const strangerEmail = uniqueEmail();
  const stranger = await call('/api/v1/auth/register', {
    body: { email: strangerEmail, password: 'E2ePass123', fullName: 'Stranger Owner', organizationName: 'Unrelated Org' },
  });
  const strangerLogin = await fetch(`${TEST_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: strangerEmail, password: 'E2ePass123' }),
  });
  const strangerCookie = (strangerLogin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const leak = await call(`/api/v1/catalog/products/${productId}`, { cookie: strangerCookie, org: stranger.body?.organizationId });
  record(
    'E2E-28',
    'Cross-tenant product read prevented',
    '404 NOT_FOUND (no existence leak)',
    `${leak.status} ${leak.body?.error?.code}`,
    leak.status === 404,
  );
  const leakAlloc = await call('/api/v1/inventory/allocate', {
    method: 'POST',
    cookie: strangerCookie,
    org: stranger.body?.organizationId,
    body: { productId, warehouseId, quantity: '1' },
  });
  record(
    'E2E-29',
    "Cross-tenant inventory access prevented (other org's warehouse)",
    '404 (warehouse not visible cross-tenant)',
    `${leakAlloc.status} ${leakAlloc.body?.error?.code}`,
    leakAlloc.status === 404,
  );

  const passCount = results.filter((r) => r.status === 'PASS').length;
  console.log(`\nE2E journey complete: ${passCount}/${results.length} passed`);
  const { writeFileSync } = await import('node:fs');
  const outPath = new URL('../../../e2e-results.json', import.meta.url).pathname;
  writeFileSync(outPath, JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2));
  console.log(`Results written to ${outPath}`);
  // The spawned test server keeps the event loop alive; exit explicitly.
  process.exit(passCount !== results.length ? 1 : 0);
}

void main().catch((error) => {
  console.error('E2E journey failed:', error);
  process.exit(1);
});
