import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@medicore/shared-types';
import { api, bootTestServer, registerOrg, uniqueEmail, type TestUser } from './harness.js';

let owner: TestUser;
let roleId: string;

type Invitation = { email: string; fullName: string; organizationName: string; roleName: string; expiresAt: string; accountExists: boolean };

async function sql(query: string, params: unknown[]): Promise<void> {
  const client = new pg.Client({ host: 'localhost', port: 5433, user: 'medicore', database: 'medicore_test' });
  await client.connect();
  await client.query(query, params);
  await client.end();
}

async function invite(email: string, fullName = 'Invited Person'): Promise<string> {
  const res = await api<{ invitationToken: string }>({ path: '/api/v1/organizations/members/invite', user: owner, body: { email, fullName, roleId, branchIds: [] } });
  expect(res.status).toBe(201);
  return res.body.invitationToken;
}

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg({ name: 'Auth Flows Pharmacy' });
  const roles = await api<Array<{ id: string; key: string | null }>>({ path: '/api/v1/organizations/roles', user: owner });
  roleId = roles.body.find((r) => r.key === 'CASHIER')!.id;
});

describe('Invitation preview and acceptance', () => {
  it('previews a live invitation and rejects bad, used or short tokens', async () => {
    const email = uniqueEmail();
    const token = await invite(email, 'New Cashier');

    const preview = await api<Invitation>({ path: `/api/v1/auth/invitations/${token}` });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ email, fullName: 'New Cashier', organizationName: 'Auth Flows Pharmacy', roleName: 'Cashier', accountExists: false });

    expect((await api({ path: '/api/v1/auth/invitations/short' })).status).toBe(400);
    expect((await api({ path: `/api/v1/auth/invitations/${'x'.repeat(43)}` })).status).toBe(400);

    const accept = await api({ path: '/api/v1/auth/invitations/accept', body: { token, password: 'Cashier12345', fullName: 'New Cashier' } });
    expect(accept.status).toBe(200);
    expect((await api({ path: `/api/v1/auth/invitations/${token}` })).status).toBe(400);
  });

  it('lets an existing account join with its current password without overwriting it', async () => {
    const other = await registerOrg({ name: 'Second Shop', password: 'Original1234' });
    const token = await invite(other.email);

    const preview = await api<Invitation>({ path: `/api/v1/auth/invitations/${token}` });
    expect(preview.body.accountExists).toBe(true);

    const wrong = await api<{ error: { code: string } }>({ path: '/api/v1/auth/invitations/accept', body: { token, password: 'Hijacked1234', fullName: 'Someone Else' } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const ok = await api({ path: '/api/v1/auth/invitations/accept', body: { token, password: 'Original1234', fullName: 'Someone Else' } });
    expect(ok.status).toBe(200);

    expect((await api({ path: '/api/v1/auth/login', body: { email: other.email, password: 'Original1234' } })).status).toBe(200);
    expect((await api({ path: '/api/v1/auth/login', body: { email: other.email, password: 'Hijacked1234' } })).status).toBe(401);
    const me = await api<SessionUser>({ path: '/api/v1/auth/me', user: other });
    expect(me.body.fullName).toBe('Test Founder');
    expect(me.body.memberships.map((m) => m.organizationName).sort()).toEqual(['Auth Flows Pharmacy', 'Second Shop']);
  });
});

describe('Email verification', () => {
  it('refuses to resend for a verified address', async () => {
    const res = await api<{ error: { code: string } }>({ path: '/api/v1/auth/email/verify/resend', method: 'POST', user: owner });
    expect(res.status).toBe(409);
  });

  it('issues a fresh link, verifies once and burns older links', async () => {
    const user = await registerOrg({ name: 'Unverified Shop' });
    await sql(`UPDATE "User" SET "emailVerifiedAt" = NULL WHERE email = $1`, [user.email]);
    expect((await api<SessionUser>({ path: '/api/v1/auth/me', user })).body.emailVerified).toBe(false);

    const first = await api<{ verificationToken: string }>({ path: '/api/v1/auth/email/verify/resend', method: 'POST', user });
    const second = await api<{ verificationToken: string }>({ path: '/api/v1/auth/email/verify/resend', method: 'POST', user });
    expect(second.status).toBe(200);

    expect((await api({ path: '/api/v1/auth/email/verify', body: { token: first.body.verificationToken } })).status).toBe(400);
    expect((await api({ path: '/api/v1/auth/email/verify', body: { token: second.body.verificationToken } })).status).toBe(204);
    expect((await api({ path: '/api/v1/auth/email/verify', body: { token: second.body.verificationToken } })).status).toBe(400);
    expect((await api<SessionUser>({ path: '/api/v1/auth/me', user })).body.emailVerified).toBe(true);
  });

  it('never gives owners platform-scope permission keys', async () => {
    const me = await api<SessionUser>({ path: '/api/v1/auth/me', user: owner });
    const perms = me.body.memberships[0]!.permissions;
    expect(perms.length).toBeGreaterThan(10);
    expect(perms.some((p) => p.startsWith('platform.'))).toBe(false);
  });
});
