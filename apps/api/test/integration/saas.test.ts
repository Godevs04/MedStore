/**
 * SaaS access policy: subscription view, plan entitlements, lapsed
 * subscriptions (read-only), platform suspension and the platform console.
 */
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, bootTestServer, registerOrg, TEST_BASE, type TestUser } from './harness.js';

let tenant: TestUser;
let admin: TestUser;

const errCode = (body: unknown): string | undefined => (body as { error?: { code?: string } }).error?.code;

async function relogin(user: TestUser): Promise<TestUser> {
  const res = await fetch(`${TEST_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  return { ...user, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
}

async function assign(planKey: string, status: string, periodDays = 30) {
  return api({ path: `/api/v1/platform/tenants/${tenant.organizationId}/subscription`, method: 'POST', user: admin, body: { planKey, status, periodDays } });
}

beforeAll(async () => {
  await bootTestServer();
  tenant = await registerOrg({ name: 'Subscriber Pharmacy' });
  admin = await registerOrg({ name: 'MediCore Platform' });
  const client = new pg.Client({ host: 'localhost', port: 5433, user: 'medicore', database: 'medicore_test' });
  await client.connect();
  await client.query(`UPDATE "User" SET "isPlatformSuperadmin" = true WHERE email = $1`, [admin.email]);
  await client.end();
});

describe('Subscription view', () => {
  it('a new organization starts on a full-feature trial with metered usage', async () => {
    const res = await api<{
      suspended: boolean;
      subscription: { planKey: string; status: string; daysLeft: number; lapsed: boolean; modules: string[] };
      usage: { branches: { used: number; limit: number | null }; invoicesThisMonth: { used: number; limit: number | null } };
      plans: Array<{ key: string }>;
    }>({ path: '/api/v1/organizations/subscription', user: tenant });
    expect(res.status).toBe(200);
    expect(res.body.subscription.planKey).toBe('TRIAL');
    expect(res.body.subscription.status).toBe('TRIALING');
    expect(res.body.subscription.lapsed).toBe(false);
    expect(res.body.subscription.daysLeft).toBeGreaterThanOrEqual(13);
    expect(res.body.subscription.modules).toContain('*');
    expect(res.body.usage.branches).toEqual({ used: 1, limit: 1 });
    expect(res.body.usage.invoicesThisMonth.used).toBe(0);
    expect(res.body.plans.map((p) => p.key)).toEqual(expect.arrayContaining(['TRIAL', 'STARTER', 'ENTERPRISE']));
  });

  it('tenant settings merge and cannot set the platform suspension flag', async () => {
    const res = await api({ path: '/api/v1/organizations/settings', method: 'PATCH', user: tenant, body: { receiptFooter: 'Get well soon', suspended: true } });
    expect(res.status).toBe(200);
    await api({ path: '/api/v1/organizations/settings', method: 'PATCH', user: tenant, body: { expiryAlertDays: 60 } });
    const org = await api<{ settings: Record<string, unknown> }>({ path: '/api/v1/organizations', user: tenant });
    expect(org.body.settings.receiptFooter).toBe('Get well soon');
    expect(org.body.settings.expiryAlertDays).toBe(60);
    expect(org.body.settings.suspended).toBe(false);
    const bad = await api({ path: '/api/v1/organizations/settings', method: 'PATCH', user: tenant, body: [1, 2] });
    expect(bad.status).toBe(400);
  });

  it('audit entries made by a user always name the actor', async () => {
    const audit = await api<{ items: Array<{ actorUserId: string | null; actorEmail: string | null }> }>({ path: '/api/v1/audit?page=1&pageSize=50', user: tenant });
    expect(audit.status).toBe(200);
    const byUser = audit.body.items.filter((r) => r.actorUserId);
    expect(byUser.length).toBeGreaterThan(0);
    expect(byUser.every((r) => r.actorEmail === tenant.email)).toBe(true);
  });
});

describe('Platform console', () => {
  it('is restricted to platform superadmins', async () => {
    expect((await api({ path: '/api/v1/platform/overview', user: tenant })).status).toBe(403);
    const overview = await api<{ tenants: number; byPlan: unknown[] }>({ path: '/api/v1/platform/overview', user: admin });
    expect(overview.status).toBe(200);
    expect(overview.body.tenants).toBeGreaterThanOrEqual(2);
    const tenants = await api<{ items: Array<{ id: string; suspended: boolean; subscription: { planKey: string } }> }>({ path: '/api/v1/platform/tenants?search=Subscriber', user: admin });
    const row = tenants.body.items.find((t) => t.id === tenant.organizationId)!;
    expect(row.suspended).toBe(false);
    expect(row.subscription.planKey).toBe('TRIAL');
    const paged = await api<{ items: unknown[]; pageInfo: { pageSize: number } }>({ path: '/api/v1/platform/tenants?page=abc&pageSize=5000', user: admin });
    expect(paged.status).toBe(200);
    expect(paged.body.pageInfo.pageSize).toBe(100);
  });

  it('auth and platform routes ignore a stale foreign tenant header (shared browser)', async () => {
    const foreign = { 'x-organization-id': admin.organizationId };
    const me = await api<{ email: string }>({ path: '/api/v1/auth/me', user: tenant, headers: foreign });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(tenant.email);
    expect((await api({ path: '/api/v1/platform/overview', user: admin, headers: { 'x-organization-id': tenant.organizationId } })).status).toBe(200);
    expect((await api({ path: '/api/v1/catalog/products', user: tenant, headers: foreign })).status).toBe(404);
  });

  it('validates plan limits and rejects invalid subscription assignments', async () => {
    const badLimits = await api({
      path: '/api/v1/platform/plans/limits',
      method: 'POST',
      user: admin,
      body: { planKey: 'STARTER', limits: { monthlyInvoiceLimit: 'lots', maxUsers: 5, maxBranches: 1, maxWarehouses: 1, modules: ['pos'] } },
    });
    expect(badLimits.status).toBe(400);
    const badModule = await api({
      path: '/api/v1/platform/plans/limits',
      method: 'POST',
      user: admin,
      body: { planKey: 'STARTER', limits: { monthlyInvoiceLimit: 10, maxUsers: 5, maxBranches: 1, maxWarehouses: 1, modules: ['teleport'] } },
    });
    expect(badModule.status).toBe(400);
    expect((await assign('STARTER', 'ACTIVE', 0)).status).toBe(400);
    expect((await assign('GOLD', 'ACTIVE')).status).toBe(400);
  });

  it('plan entitlements gate modules server-side', async () => {
    expect((await assign('STARTER', 'ACTIVE')).status).toBe(201);
    const po = await api({ path: '/api/v1/purchasing/purchase-orders', user: tenant });
    expect(po.status).toBe(403);
    expect(errCode(po.body)).toBe('FEATURE_NOT_ENTITLED');
    const journals = await api({ path: '/api/v1/accounting/journals', user: tenant });
    expect(errCode(journals.body)).toBe('FEATURE_NOT_ENTITLED');
    expect((await api({ path: '/api/v1/catalog/products?page=1&pageSize=5', user: tenant })).status).toBe(200);

    expect((await assign('BUSINESS', 'ACTIVE')).status).toBe(201);
    expect((await api({ path: '/api/v1/purchasing/purchase-orders', user: tenant })).status).toBe(200);
  });

  it('a lapsed subscription leaves the workspace readable but blocks postings', async () => {
    expect((await assign('BUSINESS', 'EXPIRED')).status).toBe(201);
    expect((await api({ path: '/api/v1/catalog/products?page=1&pageSize=5', user: tenant })).status).toBe(200);
    const write = await api({
      path: '/api/v1/partners/customers',
      method: 'POST',
      user: tenant,
      body: { name: 'Blocked Clinic', phone: '9822099999' },
    });
    expect(write.status).toBe(402);
    expect(errCode(write.body)).toBe('SUBSCRIPTION_INACTIVE');
    const view = await api<{ subscription: { lapsed: boolean } }>({ path: '/api/v1/organizations/subscription', user: tenant });
    expect(view.body.subscription.lapsed).toBe(true);

    await assign('PROFESSIONAL', 'ACTIVE', 365);
    const ok = await api({ path: '/api/v1/partners/customers', method: 'POST', user: tenant, body: { name: 'Renewed Clinic', phone: '9822099998' } });
    expect(ok.status).toBe(201);
  });

  it('suspension revokes sessions and locks the tenant out until reactivated, preserving settings', async () => {
    const suspend = await api({ path: `/api/v1/platform/tenants/${tenant.organizationId}/status`, method: 'POST', user: admin, body: { suspended: true } });
    expect(suspend.status).toBe(201);
    expect((await api({ path: '/api/v1/catalog/products', user: tenant })).status).toBe(401);

    tenant = await relogin(tenant);
    const locked = await api({ path: '/api/v1/catalog/products', user: tenant });
    expect(locked.status).toBe(403);
    expect(errCode(locked.body)).toBe('SUBSCRIPTION_INACTIVE');
    const view = await api<{ suspended: boolean }>({ path: '/api/v1/organizations/subscription', user: tenant });
    expect(view.status).toBe(200);
    expect(view.body.suspended).toBe(true);

    await api({ path: `/api/v1/platform/tenants/${tenant.organizationId}/status`, method: 'POST', user: admin, body: { suspended: false } });
    expect((await api({ path: '/api/v1/catalog/products', user: tenant })).status).toBe(200);
    const org = await api<{ settings: Record<string, unknown> }>({ path: '/api/v1/organizations', user: tenant });
    expect(org.body.settings.receiptFooter).toBe('Get well soon');
  });
});
