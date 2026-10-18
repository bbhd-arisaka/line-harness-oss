import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEntryRouteById } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { ignoresFriendAddSettings, isFirstFriendAdd, runInflowRoute } from './inflow-route-runtime.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('流入経路を読み取った友だちへの実行', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  const sql = () => fixture.sqlite;
  const now = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 23);

  beforeEach(() => {
    fixture = sqliteD1();
    sql().exec(schema);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sql().prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a1','2008163446','大門','t','s')").run();
    sql().prepare("INSERT INTO tags(id,name,color) VALUES('t1','HPB','#fff')").run();
    sql().prepare("INSERT INTO friend_field_definitions(id,field_key,label,field_type) VALUES('d1','cid','キャンペーン','text')").run();
  });

  const friend = (id: string, firstFollowedAt: string = now()) =>
    sql().prepare('INSERT INTO friends(id,line_user_key,line_user_id,line_account_id,display_name,first_followed_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id, `k${id}`, `u${id}`, 'a1', 'はなこ', firstFollowedAt, firstFollowedAt);
  const route = (extra: Record<string, unknown> = {}) => {
    const r = {
      id: 'r1',
      ref_code: 'AbC234',
      actions: JSON.stringify([{ type: 'tag', params: { op: 'add', tagIds: ['t1'] }, condition: null }]),
      action_mode: 'first',
      ad_import_mode: 'always',
      ad_param_map: JSON.stringify([{ param: 'campaign_id', fieldKey: 'cid' }]),
      ...extra,
    };
    sql().prepare('INSERT INTO entry_routes(id,ref_code,name,line_account_id,actions,action_mode,ad_import_mode,ad_param_map) VALUES(?,?,?,?,?,?,?,?)').run(r.id, r.ref_code, '経路', 'a1', r.actions, r.action_mode, r.ad_import_mode, r.ad_param_map);
  };
  const hit = (friendId: string, n = 1) => {
    for (let i = 0; i < n; i++) sql().prepare('INSERT INTO ref_tracking(id,ref_code,friend_id,entry_route_id,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(), 'AbC234', friendId, 'r1', now());
  };
  const tagged = (friendId: string) => !!sql().prepare("SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = 't1'").get(friendId);
  const run = async (friendId: string, queryParams: Record<string, string> | null = null) => {
    const r = await getEntryRouteById(fixture.db, 'r1');
    await runInflowRoute(fixture.db, {}, r!, friendId, { queryParams });
  };

  it('初回の友だち追加時のみ: 友だちになったばかりで、初めて読み取ったときだけ実行する', async () => {
    route();
    friend('new');
    hit('new');
    await run('new');
    expect(tagged('new')).toBe(true);

    friend('old', '2025-01-01T00:00:00.000');
    hit('old');
    await run('old');
    expect(tagged('old')).toBe(false); // 前から友だちの人が、あとから読み取っても実行しない

    friend('again');
    hit('again', 2);
    await run('again');
    expect(tagged('again')).toBe(false); // 2回目以降
  });
  it('いつでも: 前から友だちの人も、何回読み取っても実行する', async () => {
    route({ action_mode: 'always' });
    friend('old', '2025-01-01T00:00:00.000');
    hit('old', 3);
    await run('old');
    expect(tagged('old')).toBe(true);
  });
  it('広告連携: パラメータを友だち情報欄に入れる。「初回のみ」なら初回だけ', async () => {
    route();
    friend('f1', '2025-01-01T00:00:00.000');
    hit('f1', 2);
    await run('f1', { campaign_id: 'C-100' });
    expect(JSON.parse((sql().prepare('SELECT metadata FROM friends WHERE id = ?').get('f1') as { metadata: string }).metadata)).toEqual({ cid: 'C-100' });

    sql().prepare("UPDATE entry_routes SET ad_import_mode = 'first' WHERE id = 'r1'").run();
    await run('f1', { campaign_id: 'C-200' });
    expect(JSON.parse((sql().prepare('SELECT metadata FROM friends WHERE id = ?').get('f1') as { metadata: string }).metadata).cid).toBe('C-100'); // 初回ではないので、そのまま

    friend('f2');
    hit('f2');
    await run('f2', { campaign_id: 'C-300' });
    expect(JSON.parse((sql().prepare('SELECT metadata FROM friends WHERE id = ?').get('f2') as { metadata: string }).metadata).cid).toBe('C-300');
  });
  it('並行運用中のアカウントでは、何もしない(LINEへ送らない・タグも変えない)', async () => {
    route();
    sql().prepare("UPDATE line_accounts SET lstep_forward_url = 'https://example.com/fwd' WHERE id = 'a1'").run();
    friend('new');
    hit('new');
    await run('new');
    expect(tagged('new')).toBe(false);
  });
  it('初回かどうかの判定と、「友だち追加時設定を無視する」', async () => {
    route();
    friend('new');
    hit('new');
    expect(await isFirstFriendAdd(fixture.db, 'r1', 'new')).toBe(true);
    expect(await isFirstFriendAdd(fixture.db, 'r1', 'new', Date.now() + 25 * 3600_000)).toBe(false);
    expect(ignoresFriendAddSettings({ actions: '[]', ignore_friend_add_settings: 1 })).toBe(true);
    expect(ignoresFriendAddSettings({ actions: '[]', ignore_friend_add_settings: 0 })).toBe(false);
    expect(ignoresFriendAddSettings({ actions: null, ignore_friend_add_settings: 1 })).toBe(false); // 旧来の流入経路
  });
});
