import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_BASE, api, bootTestServer, registerOrg, uniqueEmail, type TestUser } from './harness.js';

let owner: TestUser;
let other: TestUser;

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg();
  other = await registerOrg();
});

async function createProduct(user: TestUser, overrides: Record<string, unknown> = {}) {
  return api({
    path: '/api/v1/catalog/products',
    method: 'POST',
    user,
    body: {
      name: 'Paracetamol 500mg Tablet',
      sku: `PARA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      genericName: 'Paracetamol',
      dosageForm: 'TABLET',
      strength: '500mg',
      hsnCode: '3004',
      mrp: '30.00',
      purchasePrice: '20.00',
      sellingPrice: '28.00',
      prescriptionClass: 'OTC',
      barcodes: ['8901234567890'],
      ...overrides,
    },
  });
}

describe('product catalog', () => {
  it('creates a product with barcodes and change history', async () => {
    const res = await createProduct(owner);
    expect(res.status).toBe(201);
    const product = res.body as { id: string; barcodes: Array<{ barcode: string }> };
    expect(product.barcodes.map((b) => b.barcode)).toContain('8901234567890');

    const detail = await api({
      path: `/api/v1/catalog/products/${product.id}`,
      user: owner,
    });
    expect(detail.status).toBe(200);
    const body = detail.body as { changeHistory: Array<{ changeType: string }> };
    expect(body.changeHistory.some((h) => h.changeType === 'CREATED')).toBe(true);
  });

  it('rejects duplicate SKU within the organization', async () => {
    const first = await createProduct(owner);
    expect(first.status).toBe(201);
    const sku = (first.body as { sku: string }).sku;
    const dup = await createProduct(owner, { sku });
    expect(dup.status).toBe(409);
    expect((dup.body as { error: { code: string } }).error.code).toBe('DUPLICATE_ENTITY');
  });

  it('validates product input server-side', async () => {
    const res = await createProduct(owner, { sku: 'bad sku!' });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('is tenant-isolated: another org cannot read the product', async () => {
    const created = await createProduct(owner);
    const productId = (created.body as { id: string }).id;
    const res = await api({
      path: `/api/v1/catalog/products/${productId}`,
      user: other,
    });
    expect(res.status).toBe(404);
  });

  it('finds products by barcode (POS lookup path)', async () => {
    await createProduct(owner, { sku: 'BC-SEARCH-1', barcodes: ['8900000000017'] });
    const res = await api({ path: '/api/v1/catalog/products/barcode/8900000000017', user: owner });
    expect(res.status).toBe(200);
    expect((res.body as { sku: string }).sku).toBe('BC-SEARCH-1');
  });

  it('denies product creation without products.create permission', async () => {
    // ANALYST role holds products.read only — creation must be forbidden.
    const roles = await api({ path: '/api/v1/organizations/roles', user: owner });
    const analyst = (roles.body as Array<{ id: string; key: string | null }>).find((r) => r.key === 'ANALYST');
    expect(analyst).toBeDefined();

    const inviteEmail = uniqueEmail();
    const invite = await api({
      path: '/api/v1/organizations/members/invite',
      user: owner,
      body: { email: inviteEmail, fullName: 'Analyst User', roleId: analyst!.id, branchIds: [] },
    });
    expect(invite.status).toBe(201);
    const token = (invite.body as { invitationToken?: string }).invitationToken;
    expect(typeof token).toBe('string');

    const accept = await api({
      path: '/api/v1/auth/invitations/accept',
      body: { token: token!, password: 'AnalystPass123', fullName: 'Analyst User' },
    });
    expect(accept.status).toBe(200);

    const loginRes = await fetch(`${TEST_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, password: 'AnalystPass123' }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const denied = await api({
      path: '/api/v1/catalog/products',
      method: 'POST',
      headers: { Cookie: cookie, 'x-organization-id': owner.organizationId },
      body: { name: 'Should Not Exist', sku: 'DENIED-1' },
    });
    expect(denied.status).toBe(403);
    expect((denied.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    // Reading the catalog is allowed for the same member.
    const allowed = await api({
      path: '/api/v1/catalog/products',
      headers: { Cookie: cookie, 'x-organization-id': owner.organizationId },
    });
    expect(allowed.status).toBe(200);
  });
});

describe('vendors and customers', () => {
  it('creates a vendor with GSTIN and rejects state mismatch', async () => {
    const ok = await api({
      path: '/api/v1/partners/vendors',
      method: 'POST',
      user: owner,
      body: {
        legalName: 'MedSupply Distributors Pvt Ltd',
        gstin: '27AAAPZ1234C1ZV',
        stateCode: '27',
        creditDays: 30,
        creditLimit: '100000.00',
      },
    });
    expect(ok.status).toBe(201);

    const mismatch = await api({
      path: '/api/v1/partners/vendors',
      method: 'POST',
      user: owner,
      body: { legalName: 'Wrong State Traders', gstin: '27AAAPZ1234C1ZV', stateCode: '29' },
    });
    expect(mismatch.status).toBe(409);
  });

  it('creates a customer and lists with pagination envelope', async () => {
    const created = await api({
      path: '/api/v1/partners/customers',
      method: 'POST',
      user: owner,
      body: { name: 'City Hospital', phone: '9876543210', creditLimit: '50000.00', creditDays: 15 },
    });
    expect(created.status).toBe(201);

    const list = await api({ path: '/api/v1/partners/customers?page=1&pageSize=25', user: owner });
    expect(list.status).toBe(200);
    const body = list.body as { items: unknown[]; pageInfo: { totalItems: number } };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.pageInfo.totalItems).toBeGreaterThanOrEqual(1);
  });
});

describe('tax configuration', () => {
  it('creates effective-dated tax versions without hardcoded rates', async () => {
    const res = await api({
      path: '/api/v1/catalog/tax-rates',
      method: 'POST',
      user: owner,
      body: {
        hsnCode: '3004',
        description: 'Medicaments — post GST 2.0 slab',
        cgstPercent: '2.50',
        sgstPercent: '2.50',
        effectiveFrom: '2025-09-22',
      },
    });
    expect(res.status).toBe(201);
    const rate = res.body as { id: string; cgstPercent: string };
    expect(rate.cgstPercent).toBe('2.5');
  });
});

describe('CSV import', () => {
  it('previews rows with per-row errors and duplicates, then commits valid rows', async () => {
    const preview = await api({
      path: '/api/v1/imports/products/preview',
      method: 'POST',
      user: owner,
      body: {
        rows: [
          { name: 'Imported Tablet A', sku: 'IMP-A1', hsnCode: '3004', mrp: '10.00' },
          { name: 'Imported Tablet A', sku: 'IMP-A1', hsnCode: '3004' }, // duplicate within batch vs existing key
          { name: 'Broken Row', sku: 'bad sku!' }, // validation error
        ],
      },
    });
    expect(preview.status).toBe(201);
    const body = preview.body as {
      totalRows: number;
      validRows: number;
      errorRows: number;
      duplicateRows: number;
      validatedRows: Array<Record<string, unknown>>;
    };
    expect(body.totalRows).toBe(3);
    expect(body.validRows).toBe(1);
    expect(body.errorRows).toBe(1);
    expect(body.duplicateRows).toBe(1);

    const commit = await api({
      path: '/api/v1/imports/products/commit',
      method: 'POST',
      user: owner,
      body: { validatedRows: body.validatedRows },
    });
    expect(commit.status).toBe(201);
    expect(commit.body).toEqual({ created: 1, skipped: 0, rejected: 0 });

    // Re-commit is retry-safe: duplicates are skipped, not re-created.
    const retry = await api({
      path: '/api/v1/imports/products/preview',
      method: 'POST',
      user: owner,
      body: { rows: [{ name: 'Imported Tablet A', sku: 'IMP-A1', hsnCode: '3004', mrp: '10.00' }] },
    });
    expect((retry.body as { duplicateRows: number }).duplicateRows).toBe(1);
  });

  it('denies import to members without products.import permission', async () => {
    // Create a role with read-only catalog access.
    const roleRes = await api({
      path: '/api/v1/organizations/roles',
      user: other,
      body: { name: 'Catalog Reader', permissionKeys: ['products.read'] },
    });
    expect(roleRes.status).toBe(201);
    const roleId = (roleRes.body as { id: string }).id;

    const inviteEmail = uniqueEmail();
    const inviteRes = await api({
      path: '/api/v1/organizations/members/invite',
      user: other,
      body: { email: inviteEmail, fullName: 'Reader Person', roleId, branchIds: [] },
    });
    expect(inviteRes.status).toBe(201);
    const token = (inviteRes.body as { invitationToken?: string }).invitationToken;
    expect(typeof token).toBe('string');

    const acceptRes = await api({
      path: '/api/v1/auth/invitations/accept',
      body: { token: token!, password: 'ReaderPass123', fullName: 'Reader Person' },
    });
    expect(acceptRes.status).toBe(200);

    // Sign in as the limited member and attempt an import.
    const loginRes = await fetch(`${TEST_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, password: 'ReaderPass123' }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const importRes = await api({
      path: '/api/v1/imports/products/preview',
      headers: { Cookie: cookie, 'x-organization-id': other.organizationId },
      body: { rows: [{ name: 'Nope', sku: 'NOPE-1' }] },
    });
    expect(importRes.status).toBe(403);
    expect((importRes.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });
});
