import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { FriendAddSettingError, getFriendAddSettings, parseFriendAddActions, resolveDeferredRunAt, saveFriendAddSetting } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { applyFriendAddSettings, friendMatchesCondition, processDeferredFriendAddActions } from '../services/friend-add-settings.js';
import { friendAddSettings } from './friend-add-settings.js';
import type { Env } from '../index.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','A店','s','t'),('b','ch-b','B店','s','t')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,metadata) VALUES('f1','U1','a','たろう','{"points":"10"}')`);
  sqlite.exec(`INSERT INTO tags(id,name) VALUES('t1','新規'),('t2','VIP')`);
  sqlite.exec(`INSERT INTO scenarios(id,name,trigger_type,is_active,line_account_id) VALUES('sc-a','A用','manual',1,'a'),('sc-b','B用','manual',1,'b')`);
  return { db, sqlite };
}

describe('友だち追加時設定(Lステップのアクション設定)', () => {
  test('アクションの入力: 種類ごとに検証し、形が違うもの・未対応のものは断る', () => {
    const parsed = parseFriendAddActions([
      { type: 'rich_menu', params: { menu: 'default' } },
      { type: 'text', params: { content: 'こんにちは' }, timing: { mode: 'delay', amount: 10, unit: 'minutes' } },
      { type: 'tag', params: { op: 'add', tagIds: ['t1', 't1', 't2'] }, condition: { and: [] } },
      { type: 'friend_field', params: { fieldKey: 'points', op: 'add', value: '5' } },
      { type: 'reminder', params: { op: 'start', reminderId: 'r1' } },
      { type: 'conversion', params: { conversionPointId: 'c1' } },
    ]);
    expect(parsed.map((a) => a.type)).toEqual(['rich_menu', 'text', 'tag', 'friend_field', 'reminder', 'conversion']);
    expect(parsed[2].params).toEqual({ op: 'add', tagIds: ['t1', 't2'] });
    expect(parsed[0].condition).toBeNull();
    expect(() => parseFriendAddActions([{ type: 'text', params: { content: '  ' } }])).toThrow(FriendAddSettingError);
    expect(() => parseFriendAddActions([{ type: 'tag', params: { op: 'add', tagIds: [] } }])).toThrow(/タグ/);
    expect(() => parseFriendAddActions([{ type: 'friend_field', params: { fieldKey: 'p', op: 'add', value: 'abc' } }])).toThrow(/数字/);
    expect(() => parseFriendAddActions([{ type: 'text', params: { content: 'x' }, timing: { mode: 'at', days: 1, time: '9:00' } }])).toThrow(/09:00/);
    expect(() => parseFriendAddActions([{ type: 'send_webhook', params: {} }])).toThrow(/未対応/);
  });

  test('送信タイミング: 遅らせる・時刻を指定する(日本時間)', () => {
    const base = new Date('2026-10-07T00:30:00Z'); // 日本時間 09:30
    expect(resolveDeferredRunAt({ mode: 'now' }, base)).toBeNull();
    expect(resolveDeferredRunAt({ mode: 'delay', amount: 90, unit: 'minutes' }, base)).toBe('2026-10-07T11:00:00.000');
    expect(resolveDeferredRunAt({ mode: 'at', days: 1, time: '10:00' }, base)).toBe('2026-10-08T10:00:00.000');
    expect(resolveDeferredRunAt({ mode: 'at', days: 0, time: '12:00' }, base)).toBe('2026-10-07T12:00:00.000');
    // 今日の時刻がすでに過ぎていれば、翌日
    expect(resolveDeferredRunAt({ mode: 'at', days: 0, time: '09:00' }, base)).toBe('2026-10-08T09:00:00.000');
  });

  test('保存と取得: 2区分は別々。別のアカウントのシナリオは選べない', async () => {
    const { db } = setup();
    expect((await getFriendAddSettings(db, 'a')).new).toMatchObject({ scenarioId: null, actions: [] });
    await saveFriendAddSetting(db, 'a', 'new', { scenarioId: 'sc-a', actions: [{ type: 'tag', params: { op: 'add', tagIds: ['t1'] } }] });
    const s = await getFriendAddSettings(db, 'a');
    expect(s.new).toMatchObject({ scenarioId: 'sc-a', actions: [{ type: 'tag', params: { op: 'add', tagIds: ['t1'] } }] });
    expect(s.returning.scenarioId).toBeNull();
    await expect(saveFriendAddSetting(db, 'a', 'returning', { scenarioId: 'sc-b' })).rejects.toThrow(/シナリオ/);
    await saveFriendAddSetting(db, 'a', 'new', { scenarioId: '', actions: [] }); // 設定解除
    expect((await getFriendAddSettings(db, 'a')).new).toMatchObject({ scenarioId: null, actions: [] });
  });

  test('追加されたとき: シナリオに登録し、タグ・友だち情報・条件つきアクションを上から順に実行する。区分が違えば何もしない', async () => {
    const { db, sqlite } = setup();
    await saveFriendAddSetting(db, 'a', 'new', {
      scenarioId: 'sc-a',
      actions: [
        { type: 'tag', params: { op: 'add', tagIds: ['t1'] } },
        { type: 'friend_field', params: { fieldKey: 'points', op: 'add', value: '5' } },
        { type: 'friend_field', params: { fieldKey: 'rank', op: 'set', value: 'A' } },
        // 条件つき: VIPタグがある人だけ(この友だちには付いていない → 実行されない)
        { type: 'tag', params: { op: 'add', tagIds: ['t2'] }, condition: { and: [{ type: 'tag', tagIds: ['t2'], mode: 'any' }], or: [], showFollowing: true, showBlocked: false } },
      ],
    });
    const enrolled: string[] = [];
    const onEnrolled = async (id: string) => {
      enrolled.push(id);
    };
    await applyFriendAddSettings(db, { kind: 'returning', friendId: 'f1', lineAccountId: 'a', onEnrolled });
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_tags').get()).toEqual({ c: 0 });
    await applyFriendAddSettings(db, { kind: 'new', friendId: 'f1', lineAccountId: 'a', onEnrolled });
    expect(enrolled).toEqual(['sc-a']);
    expect(sqlite.prepare("SELECT tag_id FROM friend_tags WHERE friend_id='f1'").all()).toEqual([{ tag_id: 't1' }]);
    expect(JSON.parse((sqlite.prepare("SELECT metadata FROM friends WHERE id='f1'").get() as { metadata: string }).metadata)).toEqual({ points: '15', rank: 'A' });
    // もう一度(すでに登録済み)でも、シナリオは二重には送らない
    await applyFriendAddSettings(db, { kind: 'new', friendId: 'f1', lineAccountId: 'a', onEnrolled });
    expect(enrolled).toEqual(['sc-a']);
  });

  test('条件: 友だちが条件に合うかを見る', async () => {
    const { db, sqlite } = setup();
    sqlite.exec(`INSERT INTO friend_tags(friend_id, tag_id) VALUES('f1','t2')`);
    const has = { and: [{ type: 'tag', tagIds: ['t2'], mode: 'any' }], or: [], showFollowing: true, showBlocked: false };
    const hasNot = { and: [{ type: 'tag', tagIds: ['t1'], mode: 'any' }], or: [], showFollowing: true, showBlocked: false };
    expect(await friendMatchesCondition(db, 'f1', has)).toBe(true);
    expect(await friendMatchesCondition(db, 'f1', hasNot)).toBe(false);
  });

  test('送信を遅らせる: 時刻が来るまで預かり、来たら実行する。条件は実行時に見る', async () => {
    const { db, sqlite } = setup();
    await saveFriendAddSetting(db, 'a', 'new', {
      actions: [{ type: 'text', params: { content: 'ようこそ' }, timing: { mode: 'delay', amount: 1, unit: 'days' } }],
    });
    await applyFriendAddSettings(db, { kind: 'new', friendId: 'f1', lineAccountId: 'a' });
    expect(sqlite.prepare("SELECT COUNT(*) c FROM friend_add_deferred_actions WHERE status='pending'").get()).toEqual({ c: 1 });
    // まだ時刻が来ていない
    expect(await processDeferredFriendAddActions(db)).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) c FROM friend_add_deferred_actions WHERE status='pending'").get()).toEqual({ c: 1 });
    // 時刻が来た(LINEの認証情報が無いテスト環境では、送れずに failed になる=二重に取り直さない)
    sqlite.exec(`UPDATE friend_add_deferred_actions SET run_at = '2000-01-01T00:00:00.000'`);
    await processDeferredFriendAddActions(db);
    expect(sqlite.prepare("SELECT status FROM friend_add_deferred_actions").get()).toMatchObject({ status: 'failed' });
  });

  test('API: 保存と取得。区分が不正なら400。条件の形が不正なら400', async () => {
    const { db } = setup();
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff' as never, { id: 's', role: 'owner', name: 'o' } as never);
      await next();
    });
    app.route('/', friendAddSettings);
    const env = { DB: db } as unknown as Env['Bindings'];
    const put = await app.request('/api/friend-add-settings/new?lineAccountId=a', { method: 'PUT', body: JSON.stringify({ scenarioId: 'sc-a', actions: [] }) }, env);
    expect(put.status).toBe(200);
    expect((await app.request('/api/friend-add-settings/bad?lineAccountId=a', { method: 'PUT', body: '{}' }, env)).status).toBe(400);
    const badCond = await app.request(
      '/api/friend-add-settings/new?lineAccountId=a',
      { method: 'PUT', body: JSON.stringify({ actions: [{ type: 'tag', params: { op: 'add', tagIds: ['t1'] }, condition: { and: [{ type: 'nope' }] } }] }) },
      env,
    );
    expect(badCond.status).toBe(400);
    const get = (await (await app.request('/api/friend-add-settings?lineAccountId=a', {}, env)).json()) as { data: { new: { scenarioId: string } } };
    expect(get.data.new.scenarioId).toBe('sc-a');
  });
});
