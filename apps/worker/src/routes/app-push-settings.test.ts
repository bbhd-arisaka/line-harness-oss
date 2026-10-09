import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { appAuth } from './app-auth.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO staff_members(id,name,role,api_key,is_active) VALUES('st','st','owner','k',1)`);
  sqlite.exec(`INSERT INTO app_sessions(id,staff_id,token_hash,expires_at) VALUES('s1','st','h1','2099-01-01T00:00:00.000+09:00')`);
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set(k: string, v: unknown): void }).set('appSessionId', 's1');
    await next();
  });
  app.route('/', appAuth);
  const call = async (method: 'GET' | 'PUT', body?: unknown) => {
    const res = await app.request(
      new Request('http://worker.test/api/app/push-settings', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      {},
      { DB: db } as never,
    );
    return { status: res.status, json: (await res.json()) as { success: boolean; data?: { mutedAccountIds: string[]; mutedKinds: string[]; kinds: { key: string; label: string }[] } } };
  };
  return { call, sqlite };
}

describe('/api/app/push-settings(アプリの設定画面だけで完結する通知設定)', () => {
  it('最初は何も止めていない。通知の種類の一覧(新着メッセージ・フォームの回答)も返す', async () => {
    const { call } = setup();
    const r = await call('GET');
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ mutedAccountIds: [], mutedKinds: [] });
    expect(r.json.data?.kinds.map((k) => k.key)).toEqual(['message', 'form_answered']);
    expect(r.json.data?.kinds.map((k) => k.label)).toEqual(['新着メッセージ', 'フォームの回答']);
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
  it('知らない種類・何も送らない・形が違う値は 400', async () => {
    const { call } = setup();
    expect((await call('PUT', { mutedKinds: ['unknown'] })).status).toBe(400);
    expect((await call('PUT', { mutedKinds: 'message' })).status).toBe(400);
    expect((await call('PUT', {})).status).toBe(400);
    expect((await call('PUT', { mutedAccountIds: 'A' })).status).toBe(400);
  });
});
