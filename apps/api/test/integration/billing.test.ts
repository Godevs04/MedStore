/**
 * Plan payments: checkout validation, signature checks and the Razorpay webhook.
 * These never call Razorpay: they cover everything the server decides on its own.
 */
import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, bootTestServer, registerOrg, TEST_BASE, type TestUser } from './harness.js';

let tenant: TestUser;

const errCode = (body: unknown): string | undefined => (body as { error?: { code?: string } }).error?.code;
const sign = (raw: string, secret = 'dummy_webhook_secret') => createHmac('sha256', secret).update(raw).digest('hex');

async function webhook(raw: string, signature?: string) {
  const res = await fetch(`${TEST_BASE}/api/v1/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signature ? { 'x-razorpay-signature': signature } : {}) },
    body: raw,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await bootTestServer();
  tenant = await registerOrg({ name: 'Payer Pharmacy' });
});

describe('Subscription view', () => {
  it('reports that online payment is available and in test mode', async () => {
    const res = await api<{ payments: { enabled: boolean; mode: string } }>({ path: '/api/v1/organizations/subscription', user: tenant });
    expect(res.status).toBe(200);
    expect(res.body.payments).toEqual({ enabled: true, mode: 'test' });
  });
});

describe('Checkout', () => {
  it('requires a signed-in user', async () => {
    const res = await fetch(`${TEST_BASE}/api/v1/organizations/subscription/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-organization-id': tenant.organizationId },
      body: JSON.stringify({ planKey: 'STARTER', interval: 'MONTHLY' }),
    });
    expect(res.status).toBe(401);
  });

  it('only sells self-serve plans', async () => {
    for (const planKey of ['TRIAL', 'ENTERPRISE', 'NOPE']) {
      const res = await api({ path: '/api/v1/organizations/subscription/checkout', method: 'POST', user: tenant, body: { planKey, interval: 'MONTHLY' } });
      expect(res.status, planKey).toBe(400);
      expect(errCode(res.body)).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects an unknown billing interval', async () => {
    const res = await api({ path: '/api/v1/organizations/subscription/checkout', method: 'POST', user: tenant, body: { planKey: 'STARTER', interval: 'WEEKLY' } });
    expect(res.status).toBe(400);
  });
});

describe('Payment verification', () => {
  const body = { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'deadbeef' };

  it('rejects a forged signature without changing the plan', async () => {
    const res = await api({ path: '/api/v1/organizations/subscription/verify', method: 'POST', user: tenant, body });
    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe('VALIDATION_ERROR');
    const sub = await api<{ subscription: { planKey: string } }>({ path: '/api/v1/organizations/subscription', user: tenant });
    expect(sub.body.subscription.planKey).toBe('TRIAL');
  });

  it('rejects missing fields', async () => {
    const res = await api({ path: '/api/v1/organizations/subscription/verify', method: 'POST', user: tenant, body: { razorpay_order_id: 'order_x' } });
    expect(res.status).toBe(400);
  });
});

describe('Razorpay webhook', () => {
  const captured = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', status: 'captured', amount: 100 } } } });

  it('rejects a missing or wrong signature', async () => {
    expect((await webhook(captured)).status).toBe(400);
    expect((await webhook(captured, 'f'.repeat(64))).status).toBe(400);
    expect((await webhook(captured, sign(captured, 'another_secret'))).status).toBe(400);
  });

  it('acknowledges authentic events it does not act on', async () => {
    const failed = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_2', order_id: 'order_2' } } } });
    const res = await webhook(failed, sign(failed));
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe('payment.failed');

    const other = JSON.stringify({ event: 'refund.created' });
    expect((await webhook(other, sign(other))).body.ignored).toBe('refund.created');
  });

  it('ignores a captured event that is not marked captured', async () => {
    const pending = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_3', order_id: 'order_3', status: 'authorized', amount: 100 } } } });
    const res = await webhook(pending, sign(pending));
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe('not a captured payment');
  });
});
