import { afterEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const getAccount = vi.fn();
vi.mock('@line-crm/db', async (orig) => ({ ...(await orig<typeof import('@line-crm/db')>()), getLineAccountById: (...a: unknown[]) => getAccount(...a) }));
const { lineAccounts } = await import('./line-accounts.js');

function app() {
  const a = new Hono<Env>();
  a.use('*', async (c, next) => { c.set('staff', { id: 's', name: 'o', role: 'owner' } as never); await next(); });
  a.route('/', lineAccounts);
  return a;
}
const env = { DB: {} } as unknown as Env['Bindings'];
afterEach(() => { vi.restoreAllMocks(); getAccount.mockReset(); });

describe('LINEのWebhook切り替え', () => {
  test('現在のURLを読める', async () => {
    getAccount.mockResolvedValue({ id: 'a', channel_access_token: 'tok' });
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ endpoint: 'https://relay.example/x', active: true }), { status: 200 }));
    const res = await app().request('/api/line-accounts/a/webhook', {}, env);
    expect(((await res.json()) as { data: { endpoint: string } }).data.endpoint).toBe('https://relay.example/x');
    expect(f).toHaveBeenCalledWith('https://api.line.me/v2/bot/channel/webhook/endpoint', expect.objectContaining({ method: 'GET' }));
  });
  test('URLを書き換え、前のURLを返す(戻せる)。httpsでないURLは断る', async () => {
    getAccount.mockResolvedValue({ id: 'a', channel_access_token: 'tok' });
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ endpoint: 'https://relay.example/x', active: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const res = await app().request('/api/line-accounts/a/webhook', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'https://beyond-line.example/webhook' }) }, env);
    expect(((await res.json()) as { data: { previous: string } }).data.previous).toBe('https://relay.example/x');
    expect(f.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ endpoint: 'https://beyond-line.example/webhook' }) });
    const bad = await app().request('/api/line-accounts/a/webhook', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'http://x.example' }) }, env);
    expect(bad.status).toBe(400);
  });
  test('疎通テストの結果を返す', async () => {
    getAccount.mockResolvedValue({ id: 'a', channel_access_token: 'tok' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, statusCode: 200, reason: 'OK' }), { status: 200 }));
    const res = await app().request('/api/line-accounts/a/webhook-test', { method: 'POST' }, env);
    expect(((await res.json()) as { data: { ok: boolean } }).data.ok).toBe(true);
  });
});
