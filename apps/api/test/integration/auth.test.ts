import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_BASE, api, bootTestServer, registerOrg, uniqueEmail, type TestUser } from './harness.js';

let owner: TestUser;

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg();
});

afterAll(async () => {
  // Server process is reaped by process exit hook in harness.
});

describe('auth', () => {
  it('rejects unauthenticated access to protected endpoints', async () => {
    const res = await api({ path: '/api/v1/auth/me' });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects invalid credentials without revealing account existence', async () => {
    const res = await api({
      path: '/api/v1/auth/login',
      body: { email: uniqueEmail(), password: 'Whatever123' },
    });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after 5 failed logins', async () => {
    const target = await registerOrg();
    for (let i = 0; i < 5; i++) {
      const res = await api({
        path: '/api/v1/auth/login',
        body: { email: target.email, password: 'WrongPass123' },
      });
      expect(res.status).toBe(401);
    }
    const locked = await api({
      path: '/api/v1/auth/login',
      body: { email: target.email, password: 'TestPass123' },
    });
    expect(locked.status).toBe(423);
    expect((locked.body as { error: { code: string } }).error.code).toBe('ACCOUNT_LOCKED');
  });

  it('issues a session cookie on login and revokes it on logout', async () => {
    const res = await api({
      path: '/api/v1/auth/login',
      body: { email: owner.email, password: owner.password },
    });
    expect(res.status).toBe(200);

    const me = await api({ path: '/api/v1/auth/me', user: owner });
    expect(me.status).toBe(200);
    expect((me.body as { email: string }).email).toBe(owner.email);

    const logout = await api({ path: '/api/v1/auth/logout', method: 'POST', user: owner });
    expect(logout.status).toBe(204);
    const afterLogout = await api({ path: '/api/v1/auth/me', user: owner });
    expect(afterLogout.status).toBe(401);

    // Restore a fresh session for subsequent tests (the old cookie is revoked).
    const reLogin = await fetch(`${TEST_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: owner.email, password: owner.password }),
    });
    expect(reLogin.status).toBe(200);
    owner.cookie = (reLogin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  });

  it('enforces password policy on registration', async () => {
    const res = await api({
      path: '/api/v1/auth/register',
      body: {
        email: uniqueEmail(),
        password: 'short',
        fullName: 'Weak Password',
        organizationName: 'Weak Org',
      },
    });
    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string; details?: Array<{ field?: string }> } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.some((d) => d.field === 'password')).toBe(true);
  });

  it('blocks duplicate organization emails', async () => {
    const res = await api({
      path: '/api/v1/auth/register',
      body: {
        email: owner.email,
        password: 'TestPass123',
        fullName: 'Duplicate',
        organizationName: 'Dup Org',
      },
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('DUPLICATE_ENTITY');
  });
});

describe('tenant isolation', () => {
  it('prevents cross-tenant access with an unknown organization id', async () => {
    const res = await api({
      path: '/api/v1/organizations/branches',
      user: owner,
      headers: { 'x-organization-id': '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.status).toBe(404);
  });

  it('rejects a branch id from another organization', async () => {
    const other = await registerOrg();
    const res = await api({
      path: '/api/v1/organizations/branches',
      user: owner,
      headers: { 'x-branch-id': other.branchId },
    });
    expect([403, 404]).toContain(res.status);
  });

  it('requires permissions: limited role cannot manage users', async () => {
    // Create a custom role with only products.read.
    const roleRes = await api({
      path: '/api/v1/organizations/roles',
      user: owner,
      body: { name: 'Viewer Only', permissionKeys: ['products.read'] },
    });
    expect(roleRes.status).toBe(201);
    const roleId = (roleRes.body as { id: string }).id;

    // Invite a member under that role (test env returns the invitation token).
    const inviteEmail = uniqueEmail();
    const inviteRes = await api({
      path: '/api/v1/organizations/members/invite',
      user: owner,
      body: { email: inviteEmail, fullName: 'Limited Viewer', roleId, branchIds: [] },
    });
    expect(inviteRes.status).toBe(201);
    const inviteBody = inviteRes.body as { invitationEmailQueued: boolean; invitationToken?: string };
    expect(inviteBody.invitationEmailQueued).toBe(true);
    expect(typeof inviteBody.invitationToken).toBe('string');

    // Accept the invitation and sign in.
    const acceptRes = await api({
      path: '/api/v1/auth/invitations/accept',
      body: {
        token: inviteBody.invitationToken,
        password: 'ViewerPass123',
        fullName: 'Limited Viewer',
      },
    });
    expect(acceptRes.status).toBe(200);
    const loginRes = await api({
      path: '/api/v1/auth/login',
      body: { email: inviteEmail, password: 'ViewerPass123' },
    });
    expect(loginRes.status).toBe(200);

    // Sign in via fetch to capture the session cookie.
    const res = await fetch(`${TEST_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, password: 'ViewerPass123' }),
    });
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    // The limited member's role only has products.read — everything below
    // must be denied with the stable FORBIDDEN code (positive grants for the
    // owner earlier in this test prove the permission system grants too).
    const branchesRes = await api({
      path: '/api/v1/organizations/branches',
      headers: { Cookie: cookie, 'x-organization-id': owner.organizationId },
    });
    expect(branchesRes.status).toBe(403);
    expect((branchesRes.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    // ...but cannot invite users (users.manage missing) — 403, not 500.
    const forbiddenRes = await api({
      path: '/api/v1/organizations/members/invite',
      headers: { Cookie: cookie, 'x-organization-id': owner.organizationId },
      body: { email: uniqueEmail(), fullName: 'Should Fail', roleId: null, branchIds: [] },
    });
    expect(forbiddenRes.status).toBe(403);
    expect((forbiddenRes.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    // ...and cannot create roles either.
    const rolesRes = await api({
      path: '/api/v1/organizations/roles',
      method: 'POST',
      headers: { Cookie: cookie, 'x-organization-id': owner.organizationId },
      body: { name: 'Escalation Attempt', permissionKeys: ['users.manage'] },
    });
    expect(rolesRes.status).toBe(403);
  });
});
