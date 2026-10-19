import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { friends } from './friends.js';
import { buildSegmentQuery } from '../services/segment-query.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('友だち詳細: 流入経路を見る・つける・外す', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a1','c1','大門','t','s'),('a2','c2','土岐','t','s');
      INSERT INTO friends(id,line_user_id,line_account_id,display_name,ref_code) VALUES('f1','U1','a1','はなこ','HPB111'),('f2','U2','a1','たろう',NULL);
      INSERT INTO entry_routes(id,ref_code,name,line_account_id,actions) VALUES('r1','HPB111','HPB経由','a1','[]'),('r2','INS222','インスタ','a1','[]'),('r3','TOK333','土岐用','a2','[]');
    `);
    app = new Hono();
    app.route('/', friends);
  });
  afterEach(() => fixture.sqlite.close());
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: fixture.db });
  const detail = async (id: string) => ((await (await call('GET', `/api/friends/${id}`)).json()) as { data: { refCode: string | null; inflowRoute: { id: string; name: string } | null } }).data;

  it('詳細に、流入経路の名前が出る。無ければ null', async () => {
    expect(await detail('f1')).toMatchObject({ refCode: 'HPB111', inflowRoute: { id: 'r1', name: 'HPB経由' } });
    expect((await detail('f2')).inflowRoute).toBeNull();
  });
  it('つける・付け替える・外す。出来事のログも残る', async () => {
    expect((await call('PUT', '/api/friends/f2/inflow-route', { routeId: 'r2' })).status).toBe(200);
    expect(await detail('f2')).toMatchObject({ refCode: 'INS222', inflowRoute: { name: 'インスタ' } });
    await call('PUT', '/api/friends/f2/inflow-route', { routeId: 'r1' });
    expect((await detail('f2')).refCode).toBe('HPB111');
    await call('PUT', '/api/friends/f2/inflow-route', { routeId: null });
    expect(await detail('f2')).toMatchObject({ refCode: null, inflowRoute: null });
    const events = fixture.sqlite.prepare("SELECT text FROM friend_events WHERE friend_id='f2' ORDER BY created_at").all() as Array<{ text: string }>;
    expect(events.map((e) => e.text)).toEqual(['流入経路を設定しました', '流入経路を設定しました', '流入経路を外しました']);
  });
  it('同じなら何も記録しない。ほかの公式アカウントの流入経路・存在しない流入経路は付けられない', async () => {
    await call('PUT', '/api/friends/f1/inflow-route', { routeId: 'r1' });
    expect(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM friend_events WHERE friend_id='f1'").get()).toEqual({ n: 0 });
    expect((await call('PUT', '/api/friends/f1/inflow-route', { routeId: 'r3' })).status).toBe(400);
    expect((await call('PUT', '/api/friends/f1/inflow-route', { routeId: 'nope' })).status).toBe(404);
    expect((await call('PUT', '/api/friends/zzz/inflow-route', { routeId: 'r1' })).status).toBe(404);
    expect((await detail('f1')).refCode).toBe('HPB111');
  });
  it('一斉配信の条件: 流入経路である・ではない(ref_code が無い人は「ではない」に入る)', () => {
    const is = buildSegmentQuery({ operator: 'AND', rules: [{ type: 'ref_code', value: 'HPB111' }] });
    const not = buildSegmentQuery({ operator: 'AND', rules: [{ type: 'ref_code_not', value: 'HPB111' }] });
    const ids = (q: { sql: string; bindings: unknown[] }) => (fixture.sqlite.prepare(q.sql).all(...(q.bindings as never[])) as Array<{ id: string }>).map((r) => r.id);
    expect(ids(is)).toEqual(['f1']);
    expect(ids(not)).toEqual(['f2']);
    expect(() => buildSegmentQuery({ operator: 'AND', rules: [{ type: 'ref_code_not', value: true }] })).toThrow();
  });
});
