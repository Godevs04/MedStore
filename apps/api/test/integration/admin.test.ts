import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, bootTestServer, registerOrg, uniqueEmail, type TestUser } from './harness.js';

let owner: TestUser;
let admin: TestUser;
let branchId: string;

type ErrorBody = { error: { code: string; message: string; details?: Array<{ field: string; message: string }> } };

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg({ name: 'Admin Suite Pharmacy' });
  admin = await registerOrg({ name: 'Admin Suite Platform' });
  const client = new pg.Client({ host: 'localhost', port: 5433, user: 'medicore', database: 'medicore_test' });
  await client.connect();
  await client.query(`UPDATE "User" SET "isPlatformSuperadmin" = true WHERE email = $1`, [admin.email]);
  await client.end();
  await api({
    path: `/api/v1/platform/tenants/${owner.organizationId}/subscription`,
    user: admin,
    body: { planKey: 'BUSINESS', status: 'ACTIVE', periodDays: 365, notes: 'Annual plan' },
  });
  await api({
    path: '/api/v1/organizations',
    method: 'PATCH',
    user: owner,
    body: { addressLine1: '5 Station Road', city: 'Pune', stateCode: '27', pinCode: '411001', gstRegistrationStatus: 'REGULAR', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F' },
  });
  const branches = await api<Array<{ id: string }>>({ path: '/api/v1/organizations/branches', user: owner });
  branchId = branches.body[0]!.id;
});

describe('Configuration: tax rates and taxonomy', () => {
  it('rejects GST splits where SGST ≠ CGST or IGST ≠ CGST + SGST', async () => {
    const unequal = await api<ErrorBody>({
      path: '/api/v1/catalog/tax-rates',
      user: owner,
      body: { hsnCode: '3004', description: 'Bad', cgstPercent: '2.50', sgstPercent: '6.00', igstPercent: '8.50', effectiveFrom: '2025-09-22' },
    });
    expect(unequal.status).toBe(400);
    expect(unequal.body.error.details?.some((d) => d.field === 'sgstPercent')).toBe(true);

    const igst = await api<ErrorBody>({
      path: '/api/v1/catalog/tax-rates',
      user: owner,
      body: { hsnCode: '3004', description: 'Bad', cgstPercent: '6.00', sgstPercent: '6.00', igstPercent: '18.00', effectiveFrom: '2025-09-22' },
    });
    expect(igst.status).toBe(400);
    expect(igst.body.error.details?.some((d) => d.field === 'igstPercent')).toBe(true);
  });

  it('edits and deletes categories and manufacturers with guard rails', async () => {
    const parent = await api<{ id: string }>({ path: '/api/v1/catalog/categories', user: owner, body: { name: 'Analgesics' } });
    const child = await api<{ id: string }>({ path: '/api/v1/catalog/categories', user: owner, body: { name: 'NSAIDs', parentId: parent.body.id } });
    expect(child.status).toBe(201);

    const dup = await api<ErrorBody>({ path: '/api/v1/catalog/categories', user: owner, body: { name: 'analgesics' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_ENTITY');

    const loop = await api<ErrorBody>({ path: `/api/v1/catalog/categories/${parent.body.id}`, method: 'PATCH', user: owner, body: { parentId: child.body.id } });
    expect(loop.status).toBe(400);

    const blocked = await api<ErrorBody>({ path: `/api/v1/catalog/categories/${parent.body.id}`, method: 'DELETE', user: owner });
    expect(blocked.status).toBe(409);

    const renamed = await api<{ name: string }>({ path: `/api/v1/catalog/categories/${child.body.id}`, method: 'PATCH', user: owner, body: { name: 'NSAID pain relief' } });
    expect(renamed.body.name).toBe('NSAID pain relief');
    expect((await api({ path: `/api/v1/catalog/categories/${child.body.id}`, method: 'DELETE', user: owner })).status).toBe(204);
    expect((await api({ path: `/api/v1/catalog/categories/${parent.body.id}`, method: 'DELETE', user: owner })).status).toBe(204);

    const mfr = await api<{ id: string }>({ path: '/api/v1/catalog/manufacturers', user: owner, body: { name: 'Sun Pharma' } });
    const edited = await api<{ contactPhone: string }>({ path: `/api/v1/catalog/manufacturers/${mfr.body.id}`, method: 'PATCH', user: owner, body: { contactPhone: '9822012345' } });
    expect(edited.status).toBe(200);
    await api({ path: '/api/v1/catalog/products', user: owner, body: { name: 'Sunflex 50', sku: 'SUN-50', hsnCode: '3004', mrp: '30.00', sellingPrice: '30.00', manufacturerId: mfr.body.id } });
    const inUse = await api<ErrorBody>({ path: `/api/v1/catalog/manufacturers/${mfr.body.id}`, method: 'DELETE', user: owner });
    expect(inUse.status).toBe(409);
  });
});

describe('Branches and billing counters', () => {
  it('checks branch GSTIN against state and PAN, and manages the default branch', async () => {
    const wrongState = await api<ErrorBody>({
      path: '/api/v1/organizations/branches',
      user: owner,
      body: { name: 'Bengaluru', code: 'BLR', stateCode: '27', gstin: '29AAPFU0939F1ZR' },
    });
    expect(wrongState.status).toBe(400);

    const badChecksum = await api<ErrorBody>({
      path: '/api/v1/organizations/branches',
      user: owner,
      body: { name: 'Bengaluru', code: 'BLR', stateCode: '29', gstin: '29AAPFU0939F1ZA' },
    });
    expect(badChecksum.status).toBe(400);

    const blr = await api<{ id: string; gstin: string }>({
      path: '/api/v1/organizations/branches',
      user: owner,
      body: { name: 'Bengaluru', code: 'BLR', stateCode: '29', gstin: '29AAPFU0939F1ZR', phone: '9822012345' },
    });
    expect(blr.status).toBe(201);
    expect(blr.body.gstin).toBe('29AAPFU0939F1ZR');

    const dupCode = await api<ErrorBody>({ path: '/api/v1/organizations/branches', user: owner, body: { name: 'Other', code: 'blr' } });
    expect(dupCode.status).toBe(409);

    const cannotDeactivateDefault = await api<ErrorBody>({ path: `/api/v1/organizations/branches/${branchId}`, method: 'PATCH', user: owner, body: { isActive: false } });
    expect(cannotDeactivateDefault.status).toBe(409);

    expect((await api({ path: `/api/v1/organizations/branches/${blr.body.id}`, method: 'PATCH', user: owner, body: { isDefault: true } })).status).toBe(200);
    const list = await api<Array<{ id: string; isDefault: boolean }>>({ path: '/api/v1/organizations/branches', user: owner });
    expect(list.body.filter((b) => b.isDefault).map((b) => b.id)).toEqual([blr.body.id]);
    expect((await api({ path: `/api/v1/organizations/branches/${blr.body.id}`, method: 'PATCH', user: owner, body: { isActive: false } })).status).toBe(409);
    await api({ path: `/api/v1/organizations/branches/${branchId}`, method: 'PATCH', user: owner, body: { isDefault: true } });
  });

  it('creates, renames and deactivates counters', async () => {
    const counter = await api<{ id: string }>({ path: `/api/v1/organizations/branches/${branchId}/counters`, user: owner, body: { name: 'Counter 1' } });
    expect(counter.status).toBe(201);
    const dup = await api<ErrorBody>({ path: `/api/v1/organizations/branches/${branchId}/counters`, user: owner, body: { name: 'counter 1' } });
    expect(dup.status).toBe(409);
    const off = await api<{ isActive: boolean; name: string }>({ path: `/api/v1/organizations/counters/${counter.body.id}`, method: 'PATCH', user: owner, body: { name: 'Front till', isActive: false } });
    expect(off.body).toMatchObject({ isActive: false, name: 'Front till' });
    const branches = await api<Array<{ id: string; billingCounters: Array<{ name: string }> }>>({ path: '/api/v1/organizations/branches', user: owner });
    expect(branches.body.find((b) => b.id === branchId)!.billingCounters.map((c) => c.name)).toContain('Front till');
  });
});

describe('Users and roles', () => {
  it('blocks empty and duplicate roles', async () => {
    const empty = await api<ErrorBody>({ path: '/api/v1/organizations/roles', user: owner, body: { name: 'Nothing', permissionKeys: [] } });
    expect(empty.status).toBe(400);
    expect((await api({ path: '/api/v1/organizations/roles', user: owner, body: { name: 'Counter staff', permissionKeys: ['sales.create'] } })).status).toBe(201);
    const dup = await api<ErrorBody>({ path: '/api/v1/organizations/roles', user: owner, body: { name: 'counter STAFF', permissionKeys: ['sales.create'] } });
    expect(dup.status).toBe(409);
  });

  it('never exposes or grants platform-scope permissions to tenant roles', async () => {
    const catalog = await api<Array<{ key: string }>>({ path: '/api/v1/organizations/permissions', user: owner });
    expect(catalog.body.some((p) => p.key.startsWith('platform.'))).toBe(false);
    const templates = await api<Array<{ key: string; permissions: string[] }>>({ path: '/api/v1/organizations/roles/templates', user: owner });
    expect(templates.body.map((t) => t.key)).not.toContain('PLATFORM_SUPERADMIN');
    expect(templates.body.flatMap((t) => t.permissions)).not.toContain('platform.admin');
    const sneaky = await api({ path: '/api/v1/organizations/roles', user: owner, body: { name: 'Sneaky', permissionKeys: ['platform.admin'] } });
    expect(sneaky.status).toBe(403);
  });

  it('filters members, assigns branches, resends and revokes invites', async () => {
    const email = uniqueEmail();
    const invite = await api<{ invitationToken: string }>({ path: '/api/v1/organizations/members/invite', user: owner, body: { email, fullName: 'Pending Person', roleId: null, branchIds: [] } });
    expect(invite.status).toBe(201);

    const pending = await api<{ items: Array<{ id: string; user: { email: string } }>; counts: Record<string, number> }>({
      path: '/api/v1/organizations/members?status=INVITED&search=pending',
      user: owner,
    });
    expect(pending.body.items.map((m) => m.user.email)).toEqual([email]);
    expect(pending.body.counts.INVITED).toBeGreaterThanOrEqual(1);
    const membershipId = pending.body.items[0]!.id;

    const assigned = await api<{ branchAssignments: Array<{ branch: { id: string } }> }>({
      path: `/api/v1/organizations/members/${membershipId}/branches`,
      method: 'PATCH',
      user: owner,
      body: { branchIds: [branchId] },
    });
    expect(assigned.body.branchAssignments.map((a) => a.branch.id)).toEqual([branchId]);
    const byBranch = await api<{ items: Array<{ id: string }> }>({ path: `/api/v1/organizations/members?branchId=${branchId}`, user: owner });
    expect(byBranch.body.items.map((m) => m.id)).toContain(membershipId);

    const resent = await api<{ invitationToken: string }>({ path: `/api/v1/organizations/members/${membershipId}/invite/resend`, method: 'POST', user: owner });
    expect(resent.status).toBe(200);
    expect(resent.body.invitationToken).not.toBe(invite.body.invitationToken);

    const stale = await api({ path: '/api/v1/auth/invitations/accept', body: { token: invite.body.invitationToken, password: 'Pending12345', fullName: 'Pending Person' } });
    expect(stale.status).toBe(400);

    expect((await api({ path: `/api/v1/organizations/members/${membershipId}/invite`, method: 'DELETE', user: owner })).status).toBe(204);
    const revoked = await api({ path: '/api/v1/auth/invitations/accept', body: { token: resent.body.invitationToken, password: 'Pending12345', fullName: 'Pending Person' } });
    expect(revoked.status).toBe(400);

    const ownerRow = await api<{ items: Array<{ id: string; isOwner: boolean }> }>({ path: '/api/v1/organizations/members?status=ACTIVE', user: owner });
    const ownerId = ownerRow.body.items.find((m) => m.isOwner)!.id;
    expect((await api({ path: `/api/v1/organizations/members/${ownerId}/invite`, method: 'DELETE', user: owner })).status).toBe(409);
  });
});

describe('Settings and billing', () => {
  it('requires a GSTIN for regular taxpayers and validates settings', async () => {
    const missing = await api<ErrorBody>({ path: '/api/v1/organizations', method: 'PATCH', user: owner, body: { gstRegistrationStatus: 'COMPOSITION', gstin: '' } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details?.[0]?.field).toBe('gstin');

    const fy = await api<{ financialYearStartMonth: number }>({ path: '/api/v1/organizations', method: 'PATCH', user: owner, body: { financialYearStartMonth: 1 } });
    expect(fy.body.financialYearStartMonth).toBe(1);
    await api({ path: '/api/v1/organizations', method: 'PATCH', user: owner, body: { financialYearStartMonth: 4 } });

    const longFooter = await api<ErrorBody>({ path: '/api/v1/organizations/settings', method: 'PATCH', user: owner, body: { receiptFooter: 'x'.repeat(501) } });
    expect(longFooter.status).toBe(400);
    const ok = await api<Record<string, unknown>>({ path: '/api/v1/organizations/settings', method: 'PATCH', user: owner, body: { receiptFooter: 'Get well soon', invoiceTerms: 'Goods once sold will not be taken back.' } });
    expect(ok.body.receiptFooter).toBe('Get well soon');
  });

  it('lists subscription events', async () => {
    const events = await api<Array<{ eventType: string; fromPlan: string | null; toPlan: string | null; notes: string | null }>>({ path: '/api/v1/organizations/subscription/events', user: owner });
    expect(events.status).toBe(200);
    expect(events.body[0]).toMatchObject({ eventType: 'PLAN_CHANGED', toPlan: expect.any(String) as string, notes: 'Annual plan' });
  });

  it('filters platform tenants by plan, status and suspension', async () => {
    const business = await api<{ items: Array<{ id: string }> }>({ path: '/api/v1/platform/tenants?planKey=BUSINESS&status=ACTIVE&search=Admin%20Suite', user: admin });
    expect(business.body.items.map((t) => t.id)).toEqual([owner.organizationId]);
    const notSuspended = await api<{ items: Array<{ id: string }> }>({ path: '/api/v1/platform/tenants?suspended=false&search=Admin%20Suite', user: admin });
    expect(notSuspended.body.items.length).toBe(2);
    const suspended = await api<{ items: Array<{ id: string }> }>({ path: '/api/v1/platform/tenants?suspended=true&search=Admin%20Suite', user: admin });
    expect(suspended.body.items.length).toBe(0);
    expect((await api({ path: '/api/v1/platform/tenants?planKey=GOLD', user: admin })).status).toBe(400);
  });
});
