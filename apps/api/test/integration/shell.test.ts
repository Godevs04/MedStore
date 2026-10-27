import { beforeAll, describe, expect, it } from 'vitest';
import { api, bootTestServer, registerOrg, type TestUser } from './harness.js';

let owner: TestUser;

type Hit = { type: string; title: string; href: string };

beforeAll(async () => {
  await bootTestServer();
  owner = await registerOrg();
  await api({
    path: '/api/v1/catalog/products',
    method: 'POST',
    user: owner,
    body: { name: 'Paletteamol 650', sku: 'PAL-650', hsnCode: '3004', mrp: '30.00', sellingPrice: '28.00' },
  });
  await api({ path: '/api/v1/partners/customers', method: 'POST', user: owner, body: { name: 'Palette Clinic', phone: '9876501234' } });
});

describe('global search', () => {
  it('finds products and customers by partial name', async () => {
    const res = await api<{ items: Hit[] }>({ path: '/api/v1/search?q=palette', user: owner });
    expect(res.status).toBe(200);
    const types = res.body.items.map((h) => h.type);
    expect(types).toEqual(expect.arrayContaining(['product', 'customer']));
    const product = res.body.items.find((h) => h.type === 'product')!;
    expect(product.href).toMatch(/^\/products\?focus=/);
  });

  it('matches products by SKU', async () => {
    const res = await api<{ items: Hit[] }>({ path: '/api/v1/search?q=PAL-650', user: owner });
    expect(res.body.items.some((h) => h.type === 'product')).toBe(true);
  });

  it('rejects one-character queries with a field error', async () => {
    const res = await api<{ error: { details: Array<{ field: string }> } }>({ path: '/api/v1/search?q=p', user: owner });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toContain('q');
  });
});

describe('notifications read-all', () => {
  it('marks every unread notification as read', async () => {
    await api({ path: '/api/v1/reports/notifications/generate', method: 'POST', user: owner });
    const res = await api<{ updated: number }>({ path: '/api/v1/reports/notifications/read-all', method: 'POST', user: owner });
    expect(res.status).toBe(201);
    expect(typeof res.body.updated).toBe('number');
    const unread = await api<{ pageInfo: { totalItems: number } }>({ path: '/api/v1/reports/notifications?unreadOnly=true', user: owner });
    expect(unread.body.pageInfo.totalItems).toBe(0);
  });
});
