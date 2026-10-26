/**
 * Integration test bootstrap: runs the real Nest application against a
 * dedicated test database (medicore_test), isolated per test file run.
 * The database is reset between suites via TRUNCATE of all tables.
 */
import { randomBytes } from 'node:crypto';

export const TEST_BASE = process.env.TEST_API_URL ?? 'http://localhost:3101';

export interface TestUser {
  id?: string;
  email: string;
  password: string;
  fullName: string;
  organizationId: string;
  branchId: string;
  cookie: string;
}


// Unique email per test run so parallel suites never collide.
export function uniqueEmail(): string {
  return `t-${randomBytes(6).toString('hex')}@test.local`;
}

async function truncateAll(): Promise<void> {
  // TRUNCATE all public tables between suites (test DB only).
  const admin = await import('pg');
  const client = new admin.default.Client({
    host: 'localhost',
    port: 5433,
    user: 'medicore',
    database: 'medicore_test',
  });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`,
  );
  if (rows.length > 0) {
    const list = rows.map((r) => `"${r.tablename}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  await client.end();
}

let bootPromise: Promise<void> | null = null;

/** Applies migrations + seed to the test database (idempotent). */
async function migrateTestDb(): Promise<void> {
  const { spawnSync } = await import('node:child_process');
  const path = await import('node:path');
  const cwd = path.resolve(import.meta.dirname, '../..');
  const env = { ...process.env, DATABASE_URL: 'postgresql://medicore@localhost:5433/medicore_test' };
  const migrate = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd,
    env,
    stdio: process.env.TEST_VERBOSE ? 'inherit' : 'ignore',
    shell: process.platform === 'win32',
  });
  if (migrate.status !== 0) {
    throw new Error(`prisma migrate deploy failed against medicore_test (status ${migrate.status})`);
  }
  const seed = spawnSync('pnpm', ['exec', 'tsx', 'prisma/seed.ts'], {
    cwd,
    env,
    stdio: process.env.TEST_VERBOSE ? 'inherit' : 'ignore',
    shell: process.platform === 'win32',
  });
  if (seed.status !== 0) {
    throw new Error(`prisma seed failed against medicore_test (status ${seed.status})`);
  }
}

/** Kills any leftover process listening on the test port (orphan from a prior run). */
function killPortHolders(): void {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  spawnSync('bash', ['-c', `lsof -ti tcp:3101 | xargs kill -9 2>/dev/null || true`], { stdio: 'ignore' });
}

/**
 * Boots a fresh API server on port 3101 against medicore_test with a clean DB.
 * Subsequent calls reuse the running server.
 */
export async function bootTestServer(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    killPortHolders();
    await new Promise((r) => setTimeout(r, 500));
    await truncateAll();
    await migrateTestDb();
    const { spawn } = await import('node:child_process');
    const path = await import('node:path');
    const cwd = path.resolve(import.meta.dirname, '../..');
    const child = spawn(
      process.execPath,
      ['dist/main.js'],
      {
        cwd,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PORT: '3101',
          DATABASE_URL: 'postgresql://medicore@localhost:5433/medicore_test',
          SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789abcdef',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout?.on('data', (d) => process.env.TEST_VERBOSE && process.stdout.write(`[api] ${d}`));
    child.stderr?.on('data', (d) => process.stderr.write(`[api] ${d}`));
    process.on('exit', () => child.kill('SIGTERM'));

    // Wait for readiness.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${TEST_BASE}/api/v1/health`);
        if (res.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('Test API server failed to start within 30s');
  })();
  return bootPromise;
}

export async function registerOrg(params?: {
  email?: string;
  password?: string;
  name?: string;
}): Promise<TestUser> {
  await bootTestServer();
  const email = params?.email ?? uniqueEmail();
  const password = params?.password ?? 'TestPass123';
  const name = params?.name ?? 'Test Org';

  const res = await fetch(`${TEST_BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, fullName: 'Test Founder', organizationName: name }),
  });
  if (!res.ok) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { userId: string; organizationId: string };
  const setCookie = res.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0] ?? '';

  // The registration flow creates a default branch; fetch it.
  const branchesRes = await fetch(`${TEST_BASE}/api/v1/organizations/branches`, {
    headers: { Cookie: cookie, 'x-organization-id': body.organizationId },
  });
  const branchesText = await branchesRes.text();
  if (!branchesRes.ok) {
    throw new Error(`branch fetch failed: ${branchesRes.status} ${branchesText}`);
  }
  const branches = JSON.parse(branchesText) as Array<{ id: string; name: string }>;
  const branchId = branches[0]?.id;
  if (!branchId) throw new Error(`no branch after register: ${branchesText}`);

  return {
    id: body.userId,
    email,
    password,
    fullName: 'Test Founder',
    organizationId: body.organizationId,
    branchId,
    cookie,
  };
}

export interface RequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  user?: TestUser;
  branchId?: string;
  headers?: Record<string, string>;
}

export async function api<T = unknown>(opts: RequestOptions): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.user) {
    headers.Cookie = opts.user.cookie;
    headers['x-organization-id'] = opts.user.organizationId;
    headers['x-branch-id'] = opts.branchId ?? opts.user.branchId;
  }
  // Explicit per-call headers win over user-derived defaults (needed for
  // negative authorization tests that deliberately send wrong scopes).
  Object.assign(headers, opts.headers ?? {});
  const res = await fetch(`${TEST_BASE}${opts.path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const body = (text ? JSON.parse(text) : null) as T;
  return { status: res.status, body };
}
