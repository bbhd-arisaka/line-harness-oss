import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { inflowRoutes } from './inflow-routes.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const ORIGIN = 'https://worker.example';

describe('流入経路分析 API(Lステップと同じ仕様)', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  beforeEach(() => {
    fixture = sqliteD1();
    const db = fixture.sqlite;
    db.exec(schema);
    db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('a1', '2008163446', '大門', 't', 's');
    db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('a2', '2008681588', '土岐', 't', 's');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = new Hono();
    app.route('/', inflowRoutes);
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`${ORIGIN}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: fixture.db, WORKER_URL: ORIGIN });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  const create = async (extra: Record<string, unknown> = {}) => {
    const r = await call('POST', '/api/inflow/routes', { lineAccountId: 'a1', name: 'HPB経由', ...extra });
    expect(r.status).toBe(201);
    return r.json.data as { id: string; refCode: string; url: string; [k: string]: any };
  };

  it('作成: ref コードが自動で付き、URLは公式アカウントを指定した /r/<ref> になる', async () => {
    const r = await create({ qrText: '店頭用', actions: [{ type: 'tag', params: { op: 'add', tagIds: ['t1'] }, condition: null }] });
    expect(r.refCode).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(r.url).toBe(`${ORIGIN}/r/${r.refCode}?account=2008163446`);
    expect(r.qrText).toBe('店頭用');
    expect(r.actions).toHaveLength(1);
    expect(r.actionMode).toBe('first');
    expect(r.adImportMode).toBe('always');
    expect(r.ignoreFriendAddSettings).toBe(false);
    expect(r.legacy).toBe(false);
  });
  it('作成: 入力の誤りは 400 で、理由を返す。公式アカウントが無い・違うのも', async () => {
    expect((await call('POST', '/api/inflow/routes', { lineAccountId: 'a1', name: '' })).json.error).toContain('流入経路名');
    expect((await call('POST', '/api/inflow/routes', { name: 'x' })).status).toBe(400);
    expect((await call('POST', '/api/inflow/routes', { lineAccountId: 'zzz', name: 'x' })).status).toBe(404);
  });
  it('フォルダ: 作成・名前変更・一覧(件数)・別のアカウントのフォルダには入れられない・削除すると中身は未分類へ', async () => {
    const f = (await call('POST', '/api/inflow/folders', { lineAccountId: 'a1', name: 'HPB経由' })).json.data;
    const other = (await call('POST', '/api/inflow/folders', { lineAccountId: 'a2', name: '土岐' })).json.data;
    expect((await call('POST', '/api/inflow/routes', { lineAccountId: 'a1', name: 'x', folderId: other.id })).status).toBe(400);
    const r = await create({ folderId: f.id });
    await create({ name: '未分類の経路' });
    let list = (await call('GET', '/api/inflow/folders?lineAccountId=a1')).json.data;
    expect(list.folders).toEqual([{ id: f.id, name: 'HPB経由', count: 1 }]);
    expect(list.unfiledCount).toBe(1);
    expect((await call('PUT', `/api/inflow/folders/${f.id}`, { name: 'HPB' })).json.data.name).toBe('HPB');
    expect((await call('DELETE', `/api/inflow/folders/${f.id}`)).status).toBe(200);
    list = (await call('GET', '/api/inflow/folders?lineAccountId=a1')).json.data;
    expect(list.folders).toEqual([]);
    expect(list.unfiledCount).toBe(2);
    expect((await call('GET', `/api/inflow/routes/${r.id}`)).json.data.folderId).toBeNull();
  });
  it('一覧: フォルダ・名前・URLでの検索・集計(人数と回数)・ページング', async () => {
    const f = (await call('POST', '/api/inflow/folders', { lineAccountId: 'a1', name: 'F' })).json.data;
    const a = await create({ name: 'HPB経由', folderId: f.id });
    const b = await create({ name: 'インスタ経由', folderId: f.id });
    await create({ name: '別のアカウント', lineAccountId: 'a2' });
    const db = fixture.sqlite;
    db.prepare("INSERT INTO friends(id,line_user_key,line_user_id,line_account_id,display_name) VALUES('f1','k1','u1','a1','はなこ'),('f2','k2','u2','a1','たろう')").run();
    const hit = (id: string, route: string, friend: string, at: string, qp: string | null = null) =>
      db.prepare('INSERT INTO ref_tracking(id,ref_code,friend_id,entry_route_id,query_params,created_at) VALUES(?,?,?,?,?,?)').run(id, 'x', friend, route, qp, at);
    hit('h1', a.id, 'f1', '2026-10-17T10:00:00.000');
    hit('h2', a.id, 'f1', '2026-10-18T10:00:00.000', '{"utm_source":"hpb"}');
    hit('h3', a.id, 'f2', '2026-10-18T11:00:00.000');
    const list = (await call('GET', `/api/inflow/routes?lineAccountId=a1&folder=${f.id}`)).json.data;
    expect(list.total).toBe(2);
    const byName = Object.fromEntries(list.items.map((i: any) => [i.name, i]));
    expect(byName['HPB経由']).toMatchObject({ people: 2, times: 3 });
    expect(byName['インスタ経由']).toMatchObject({ people: 0, times: 0 });
    expect((await call('GET', `/api/inflow/routes?lineAccountId=a1&folder=all&q=${encodeURIComponent('インスタ')}`)).json.data.items).toHaveLength(1);
    // URL を貼って探せる
    const byUrl = (await call('GET', `/api/inflow/routes?lineAccountId=a1&folder=all&q=${encodeURIComponent(a.url)}`)).json.data.items;
    expect(byUrl.map((i: any) => i.id)).toEqual([a.id]);
    // 別のアカウントのものは出ない
    expect((await call('GET', '/api/inflow/routes?lineAccountId=a1&folder=all')).json.data.total).toBe(2);
    // ページング
    const p1 = (await call('GET', `/api/inflow/routes?lineAccountId=a1&folder=${f.id}&pageSize=1&page=1`)).json.data;
    const p2 = (await call('GET', `/api/inflow/routes?lineAccountId=a1&folder=${f.id}&pageSize=1&page=2`)).json.data;
    expect(p1.items).toHaveLength(1);
    expect(p2.items).toHaveLength(1);
    expect(p1.items[0].id).not.toBe(p2.items[0].id);
    expect(b.id).toBeTruthy();
  });
  it('集計画面: 友だち・日時(新しい順)・クエリパラメータ・対応マーク。CSV(BOMつき)', async () => {
    const a = await create();
    const db = fixture.sqlite;
    db.prepare("INSERT INTO friends(id,line_user_key,line_user_id,line_account_id,display_name,real_name) VALUES('f1','k1','u1','a1','はなこ','山田 花子')").run();
    db.prepare("INSERT INTO chats(id,friend_id,status,created_at) VALUES('c1','f1','in_progress','2026-10-18T10:00:00.000')").run();
    db.prepare("INSERT INTO ref_tracking(id,ref_code,friend_id,entry_route_id,query_params,created_at) VALUES('h1','x','f1',?,'{\"utm_source\":\"hpb\"}','2026-10-18T10:00:00.000')").run(a.id);
    const s = (await call('GET', `/api/inflow/routes/${a.id}/stats`)).json.data;
    expect(s.total).toBe(1);
    expect(s.people).toBe(1);
    expect(s.rows[0]).toMatchObject({ friendName: '山田 花子', mark: '対応中', at: '2026-10-18T10:00:00.000', queryParams: { utm_source: 'hpb' } });
    const csv = await call('GET', `/api/inflow/routes/${a.id}/export`);
    expect(csv.headers.get('Content-Type')).toContain('text/csv');
    const bytes = new Uint8Array(await (await app.request(`${ORIGIN}/api/inflow/routes/${a.id}/export`, {}, { DB: fixture.db, WORKER_URL: ORIGIN })).arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.text).toContain('"対応中","f1","山田 花子","2026-10-18 10:00:00","utm_source=hpb"');
  });
  it('更新: 名前・アクションなどは変えられるが、「アクションの実行」と広告取り込みのタイミングは変わらない', async () => {
    fixture.sqlite.prepare("INSERT INTO scenarios(id,name,trigger_type) VALUES('s1','シナリオ','friend_add')").run();
    const a = await create({ actionMode: 'always', adImportMode: 'first' });
    const r = await call('PUT', `/api/inflow/routes/${a.id}`, { name: '新しい名前', actionMode: 'first', adImportMode: 'always', scenarioId: 's1', ignoreFriendAddSettings: true, validFrom: '2026-10-20T09:00' });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ name: '新しい名前', actionMode: 'always', adImportMode: 'first', scenarioId: 's1', ignoreFriendAddSettings: true, validFrom: '2026-10-20T09:00' });
    expect((await call('PUT', `/api/inflow/routes/${a.id}`, { name: '' })).status).toBe(400);
    expect((await call('PUT', '/api/inflow/routes/nope', { name: 'x' })).status).toBe(404);
  });
  it('コピーを作成: 設定はそのまま・新しい ref コード・集計は引き継がない', async () => {
    const a = await create({ name: 'HPB経由', qrText: 'ABC', geoLat: 35, geoLng: 139, geoRadius: 100, htmlHead: '<script></script>', actionMode: 'always' });
    fixture.sqlite.prepare("INSERT INTO ref_tracking(id,ref_code,friend_id,entry_route_id,created_at) VALUES('h1','x',NULL,?,'2026-10-18T10:00:00.000')").run(a.id);
    const c = (await call('POST', `/api/inflow/routes/${a.id}/copy`)).json.data;
    expect(c.id).not.toBe(a.id);
    expect(c.refCode).not.toBe(a.refCode);
    expect(c).toMatchObject({ name: 'HPB経由のコピー', qrText: 'ABC', geoLat: 35, geoRadius: 100, htmlHead: '<script></script>', actionMode: 'always', people: 0, times: 0 });
  });
  it('友だち追加ページの文言・配色: 保存・更新・コピーで引き継ぎ・不正な色は400', async () => {
    const a = await create({ landingStyle: { title: 'ご予約はこちら', colors: { button: '#FF6600' } } });
    expect(a.landingStyle).toEqual({ title: 'ご予約はこちら', colors: { button: '#ff6600' } });
    expect((await call('POST', '/api/inflow/routes', { lineAccountId: 'a1', name: 'x', landingStyle: { colors: { button: 'red' } } })).status).toBe(400);
    const up = await call('PUT', `/api/inflow/routes/${a.id}`, { name: 'HPB経由', landingStyle: { buttonText: '開く' } });
    expect(up.json.data.landingStyle).toEqual({ buttonText: '開く' });
    const c = (await call('POST', `/api/inflow/routes/${a.id}/copy`)).json.data;
    expect(c.landingStyle).toEqual({ buttonText: '開く' });
    const none = await call('PUT', `/api/inflow/routes/${a.id}`, { name: 'HPB経由' });
    expect(none.json.data.landingStyle).toEqual({});
  });
  it('友だち追加ページのプレビュー: 保存前の設定から、実際と同じ HTML を返す。不正な設定は400', async () => {
    const r = await call('POST', '/api/inflow/landing-preview', { kind: 'mobile', style: { title: 'プレビュー見出し', bgImageUrl: 'https://example.com/bg.jpg', cardOpacity: 60, colors: { button: '#ff6600' } } });
    expect(r.status).toBe(200);
    expect(r.json.data.html).toContain('プレビュー見出し');
    expect(r.json.data.html).toContain('url("https://example.com/bg.jpg")');
    expect(r.json.data.html).toContain('#ff6600');
    const pc = await call('POST', '/api/inflow/landing-preview', { kind: 'pc', url: 'https://example.com/r/abc', style: {} });
    expect(pc.json.data.html).toContain(`${ORIGIN}/api/qr?size=240x240&amp;data=https%3A%2F%2Fexample.com%2Fr%2Fabc`);
    expect((await call('POST', '/api/inflow/landing-preview', { style: { cardOpacity: 5 } })).status).toBe(400);
  });
  it('削除: 経路は消えるが、集計の記録は残る(経路との結びつきだけ外れる)', async () => {
    const a = await create();
    fixture.sqlite.prepare("INSERT INTO ref_tracking(id,ref_code,friend_id,entry_route_id,created_at) VALUES('h1','x',NULL,?,'2026-10-18T10:00:00.000')").run(a.id);
    expect((await call('DELETE', `/api/inflow/routes/${a.id}`)).status).toBe(200);
    expect((await call('GET', `/api/inflow/routes/${a.id}`)).status).toBe(404);
    expect(fixture.sqlite.prepare('SELECT entry_route_id FROM ref_tracking WHERE id = ?').get('h1')).toEqual({ entry_route_id: null });
  });
  it('並び替え: 指定した順に並ぶ。別のフォルダへの移動', async () => {
    const a = await create({ name: 'A' });
    const b = await create({ name: 'B' });
    const c = await create({ name: 'C' });
    let names = (await call('GET', '/api/inflow/routes?lineAccountId=a1&folder=all')).json.data.items.map((i: any) => i.name);
    expect(names).toEqual(['C', 'B', 'A']); // 新しいものが上
    await call('PUT', '/api/inflow/routes/order', { ids: [a.id, c.id, b.id] });
    names = (await call('GET', '/api/inflow/routes?lineAccountId=a1&folder=all')).json.data.items.map((i: any) => i.name);
    expect(names).toEqual(['A', 'C', 'B']);
    const f = (await call('POST', '/api/inflow/folders', { lineAccountId: 'a1', name: 'F' })).json.data;
    expect((await call('PUT', `/api/inflow/routes/${a.id}/folder`, { folderId: f.id })).status).toBe(200);
    expect((await call('GET', `/api/inflow/routes/${a.id}`)).json.data.folderId).toBe(f.id);
  });
  it('旧来の流入経路(アクション未設定・どのアカウントにも結びついていない)も、一覧に出る(未分類)', async () => {
    fixture.sqlite.prepare("INSERT INTO entry_routes(id,ref_code,name) VALUES('legacy1','legacy','旧来の経路')").run();
    const list = (await call('GET', '/api/inflow/routes?lineAccountId=a1&folder=none')).json.data.items;
    expect(list.map((i: any) => i.name)).toContain('旧来の経路');
    expect(list.find((i: any) => i.name === '旧来の経路')).toMatchObject({ legacy: true, lineAccountId: null });
    // 旧来のものは、更新・コピーできない(作り直す)
    expect((await call('PUT', '/api/inflow/routes/legacy1', { name: 'x' })).status).toBe(400);
    expect((await call('POST', '/api/inflow/routes/legacy1/copy')).status).toBe(400);
  });
});
