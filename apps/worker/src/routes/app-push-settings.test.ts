import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { appAuth } from './app-auth.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup(allowed: string[] | null = null) {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO staff_members(id,name,role,api_key,is_active) VALUES('st','st','owner','k',1)`);
  sqlite.exec(`INSERT INTO app_sessions(id,staff_id,token_hash,expires_at) VALUES('s1','st','h1','2099-01-01T00:00:00.000+09:00')`);
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set(k: string, v: unknown): void }).set('appSessionId', 's1');
    (c as unknown as { set(k: string, v: unknown): void }).set('allowedAccountIds', allowed);
    await next();
  });
  app.route('/', appAuth);
  const call = async (method: 'GET' | 'PUT', body?: unknown, query = '') => {
    const res = await app.request(
      new Request(`http://worker.test/api/app/push-settings${query}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      {},
      { DB: db } as never,
    );
    return { status: res.status, json: (await res.json()) as { success: boolean; data?: { mutedAccountIds: string[]; mutedKinds: string[]; accountMuted?: boolean; accountId?: string; kinds: { key: string; label: string }[] } } };
  };
  return { call, sqlite };
}

describe('/api/app/push-settings(アプリの設定画面だけで完結する通知設定)', () => {
  it('最初は、初期オフの「友だち再追加」以外は止めていない。通知の種類の一覧も返す', async () => {
    const { call } = setup();
    const r = await call('GET');
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ mutedAccountIds: [], mutedKinds: ['friend_readded'] });
    expect(r.json.data?.kinds.map((k) => k.key)).toEqual(['message', 'form_answered', 'friend_added', 'friend_readded']);
    expect(r.json.data?.kinds.map((k) => k.label)).toEqual(['新着メッセージ', 'フォームの回答', '友だち追加', '友だち再追加']);
  });
  it('友だち再追加は、止めている種類の一覧から外すとオンになり、入れるとオフに戻る(古いアプリの送り方のまま)', async () => {
    const { call } = setup();
    const on = await call('PUT', { mutedKinds: [] });
    expect(on.json.data?.mutedKinds).toEqual([]);
    const other = await call('PUT', { mutedKinds: ['message'] });
    expect(other.json.data?.mutedKinds).toEqual(['message']);
    const off = await call('PUT', { mutedKinds: ['message', 'friend_readded'] });
    expect(off.json.data?.mutedKinds.sort()).toEqual(['friend_readded', 'message']);
    // 公式アカウントだけ送っても、種類の設定(再追加のオン・オフも)は変わらない
    await call('PUT', { mutedKinds: [] });
    const acc = await call('PUT', { mutedAccountIds: ['A'] });
    expect(acc.json.data?.mutedKinds).toEqual([]);
  });
  it('止める種類だけを保存できる。公式アカウントの設定は変わらない(古いアプリとの互換)', async () => {
    const { call } = setup();
    await call('PUT', { mutedAccountIds: ['A'] });
    const r = await call('PUT', { mutedKinds: ['form_answered'] });
    expect(r.json.data).toMatchObject({ mutedAccountIds: ['A'], mutedKinds: ['form_answered'] });
    // 古いアプリが公式アカウントだけ送っても、種類の設定は残る
    const r2 = await call('PUT', { mutedAccountIds: [] });
    expect(r2.json.data).toMatchObject({ mutedAccountIds: [], mutedKinds: ['form_answered'] });
    // 空にすると、すべて受け取る
    const r3 = await call('PUT', { mutedKinds: [] });
    expect(r3.json.data?.mutedKinds).toEqual([]);
  });
  it('公式アカウントごとの設定: そのアカウントの通知だけを止められ、ほかのアカウントには影響しない', async () => {
    const { call } = setup();
    const a = await call('PUT', { accountId: 'A', accountMuted: true });
    expect(a.json.data).toMatchObject({ accountId: 'A', accountMuted: true });
    const b = await call('GET', undefined, '?accountId=B');
    expect(b.json.data).toMatchObject({ accountId: 'B', accountMuted: false });
    const a2 = await call('GET', undefined, '?accountId=A');
    expect(a2.json.data?.accountMuted).toBe(true);
    // もう一度オンにする
    const on = await call('PUT', { accountId: 'A', accountMuted: false });
    expect(on.json.data?.accountMuted).toBe(false);
  });
  it('通知する内容も、公式アカウントごと。ほかのアカウント・端末全体の設定は変わらない。設定が無いアカウントは、端末全体の設定に従う', async () => {
    const { call } = setup();
    await call('PUT', { mutedKinds: ['form_answered'] }); // 端末全体(これまでの設定)
    const initialB = await call('GET', undefined, '?accountId=B');
    expect(initialB.json.data?.mutedKinds.sort()).toEqual(['form_answered']);
    const a = await call('PUT', { accountId: 'A', mutedKinds: ['message'] });
    expect(a.json.data?.mutedKinds.sort()).toEqual(['message']);
    // B は、A の変更の影響を受けない(端末全体の設定のまま)
    expect((await call('GET', undefined, '?accountId=B')).json.data?.mutedKinds.sort()).toEqual(['form_answered']);
    // 端末全体の設定も変わらない
    expect((await call('GET')).json.data?.mutedKinds.sort()).toEqual(['form_answered']);
    // 初期オフの「友だち再追加」: そのアカウントでオンにできる
    const on = await call('PUT', { accountId: 'A', mutedKinds: [] });
    expect(on.json.data?.mutedKinds).toEqual([]);
    expect((await call('GET', undefined, '?accountId=B')).json.data?.mutedKinds).toContain('form_answered');
  });
  it('見られないアカウントの設定は、読めない・変えられない(403)。形が違う値は 400', async () => {
    const { call } = setup(['A']);
    expect((await call('GET', undefined, '?accountId=X')).status).toBe(403);
    expect((await call('PUT', { accountId: 'X', accountMuted: true })).status).toBe(403);
    expect((await call('PUT', { accountId: 'A', accountMuted: 'yes' })).status).toBe(400);
    expect((await call('PUT', { accountId: 'A' })).status).toBe(400);
    expect((await call('PUT', { accountId: 'A', mutedKinds: ['unknown'] })).status).toBe(400);
    expect((await call('PUT', { accountId: 'A', accountMuted: true })).status).toBe(200);
  });
  it('知らない種類・何も送らない・形が違う値は 400', async () => {
    const { call } = setup();
    expect((await call('PUT', { mutedKinds: ['unknown'] })).status).toBe(400);
    expect((await call('PUT', { mutedKinds: 'message' })).status).toBe(400);
    expect((await call('PUT', {})).status).toBe(400);
    expect((await call('PUT', { mutedAccountIds: 'A' })).status).toBe(400);
  });
});
