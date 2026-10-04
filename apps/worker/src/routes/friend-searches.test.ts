import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { friendSearches } from './friend-searches.js';
import type { Env } from '../index.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup(allowed: string[] | null) {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','A店','s','t'),('b','ch-b','B店','s','t')`);
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('allowedAccountIds', allowed);
    c.set('staff', { id: 's1', name: 'スタッフ', role: 'admin', external: false } as never);
    await next();
  });
  app.route('/', friendSearches);
  const call = (path: string, init: RequestInit = {}) => app.request(path, init, { DB: db } as unknown as Env['Bindings']);
  const post = (body: unknown) => call('/api/friend-searches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { call, post };
}

const FILTER = { and: [{ type: 'tag', mode: 'any', tagIds: ['t1'] }], or: [] };

describe('保存した検索(アカウントごと)', () => {
  test('保存・一覧・削除ができ、アカウントごとに分かれる。条件は検証される', async () => {
    const { call, post } = setup(null);
    const created = await post({ lineAccountId: 'a', name: 'VIPの人', filter: FILTER });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    await post({ lineAccountId: 'b', name: '別の店', filter: FILTER });
    const listA = (await (await call('/api/friend-searches?lineAccountId=a')).json()) as { data: { name: string; filter: unknown }[] };
    expect(listA.data.map((x) => x.name)).toEqual(['VIPの人']);
    expect(listA.data[0].filter).toMatchObject({ and: [{ type: 'tag', mode: 'any', tagIds: ['t1'] }], showFollowing: true });
    expect((await post({ lineAccountId: 'a', name: 'x', filter: { and: [{ type: 'nope' }] } })).status).toBe(400);
    expect((await post({ lineAccountId: 'a', name: '', filter: FILTER })).status).toBe(400);
    expect((await post({ lineAccountId: 'zzz', name: 'x', filter: FILTER })).status).toBe(404);
    expect((await call(`/api/friend-searches/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/api/friend-searches/${id}`, { method: 'DELETE' })).status).toBe(404);
  });

  test('見られるアカウントが制限されたスタッフは、許可されたアカウントの分だけ', async () => {
    const owner = setup(null);
    const created = await owner.post({ lineAccountId: 'b', name: 'B店用', filter: FILTER });
    expect(created.status).toBe(201);
    const restricted = setup(['a']);
    expect((await restricted.call('/api/friend-searches?lineAccountId=b')).status).toBe(403);
    expect((await restricted.post({ lineAccountId: 'b', name: 'x', filter: FILTER })).status).toBe(403);
    expect((await restricted.call('/api/friend-searches?lineAccountId=a')).status).toBe(200);
    expect((await restricted.post({ lineAccountId: 'a', name: 'ok', filter: FILTER })).status).toBe(201);
  });
});
