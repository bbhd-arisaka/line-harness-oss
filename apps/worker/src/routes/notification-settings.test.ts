import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { notificationSettings } from './notification-settings.js';
import type { Env } from '../index.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const ENV = { BEYOND_ADMIN_URL: 'https://admin.example.test', BEYOND_ADMIN_INTERNAL_TOKEN: 'secret', BEYOND_ADMIN_ALLOWED_TENANT_IDS: 'tenant-1' };

function setup(role: 'owner' | 'admin' | 'staff' = 'admin', allowed: string[] | null = null) {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','A店','s','t'),('b','ch-b','B店','s','t')`);
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('allowedAccountIds', allowed);
    c.set('staff', { id: 's1', name: 'スタッフ', role, external: false } as never);
    await next();
  });
  app.route('/', notificationSettings);
  const call = (path: string, init: RequestInit = {}) => app.request(path, init, { DB: db, ...ENV } as unknown as Env['Bindings']);
  const send = (method: string, path: string, body?: unknown) => call(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { sqlite, call, send };
}

describe('通知設定のAPI', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/line/destinations')) return new Response(JSON.stringify({ ok: true, destinations: [{ id: 'dl-1', displayName: 'サロンのタブレット' }] }), { status: 200 });
      if (u.includes('/mail/destinations')) return new Response(JSON.stringify({ ok: true, destinations: [{ id: 'dm-1', displayName: 'shop@example.com' }] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  test('管理者以上だけ。スタッフは使えない', async () => {
    const { call } = setup('staff');
    expect((await call('/api/notification-settings?lineAccountId=a')).status).toBe(403);
    expect((await call('/api/notification-destinations')).status).toBe(403);
  });

  test('一覧: 1つも無い古いアカウントは、標準の設定(オフ)を作る。通知先の候補は beyond admin の宛先', async () => {
    const { send, call } = setup();
    const list = (await (await call('/api/notification-settings?lineAccountId=a')).json()) as { data: { title: string; status: string }[]; adminLinked: boolean };
    expect(list.adminLinked).toBe(true);
    expect(list.data.map((s) => [s.title, s.status])).toEqual([['チャット通知', 'off'], ['友だち追加通知', 'off']]);
    const dests = (await (await call('/api/notification-destinations')).json()) as { data: { available: boolean; line: unknown[]; mail: unknown[] } };
    expect(dests.data).toMatchObject({ available: true, line: [{ kind: 'line', id: 'dl-1' }], mail: [{ kind: 'mail', id: 'dm-1' }] });
    // 通知先を選んでオンにできる
    const id = (list.data[0] as unknown as { id: string }).id;
    const res = await send('PUT', `/api/notification-settings/${id}`, { status: 'on', destinations: [{ kind: 'line', id: 'dl-1', name: 'サロンのタブレット' }] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { status: string } }).data.status).toBe('on');
  });

  test('作成: beyond admin に登録されていない通知先は断る。登録済みなら作れる。削除もできる', async () => {
    const { send } = setup();
    const base = { lineAccountId: 'a', title: '新着', timings: ['message'] };
    const bad = await send('POST', '/api/notification-settings', { ...base, destinations: [{ kind: 'mail', id: 'nope', name: 'x@example.com' }] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/beyond admin/);
    const ok = await send('POST', '/api/notification-settings', { ...base, destinations: [{ kind: 'mail', id: 'dm-1', name: 'shop@example.com' }] });
    expect(ok.status).toBe(201);
    const id = ((await ok.json()) as { data: { id: string } }).data.id;
    expect((await send('POST', '/api/notification-settings', { ...base, timings: ['send_count_warning'], destinations: [{ kind: 'line', id: 'dl-1', name: '' }] })).status).toBe(400);
    expect((await send('DELETE', `/api/notification-settings/${id}`)).status).toBe(200);
    expect((await send('DELETE', `/api/notification-settings/${id}`)).status).toBe(404);
  });

  test('beyond admin につながらないときは、新しい通知先を受け付けない(理由を返す)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const { send } = setup();
    const res = await send('POST', '/api/notification-settings', { lineAccountId: 'a', title: 'x', timings: ['message'], destinations: [{ kind: 'line', id: 'dl-1', name: '' }] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/確認できません/);
  });

  test('見られるアカウントが制限されたスタッフは、許可されたアカウントの分だけ。テスト送信は結果を返す', async () => {
    const { send, call } = setup('admin', ['a']);
    expect((await call('/api/notification-settings?lineAccountId=b')).status).toBe(403);
    expect((await send('POST', '/api/notification-settings', { lineAccountId: 'b', title: 'x', timings: ['message'], destinations: [{ kind: 'line', id: 'dl-1', name: '' }] })).status).toBe(403);
    const created = await send('POST', '/api/notification-settings', { lineAccountId: 'a', title: 'x', timings: ['message'], destinations: [{ kind: 'line', id: 'dl-1', name: 'タブレット' }] });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    const test = (await (await send('POST', `/api/notification-settings/${id}/test`)).json()) as { data: { kind: string; ok: boolean }[] };
    expect(test.data).toEqual([expect.objectContaining({ kind: 'line', ok: true })]);
    expect(((await (await call('/api/notification-settings/catalog')).json()) as { data: unknown[] }).data.length).toBeGreaterThan(5);
  });
});
