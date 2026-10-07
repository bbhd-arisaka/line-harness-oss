import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { FriendAddSettingError, getFriendAddSettings, parseFriendAddActions, saveFriendAddSetting } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { applyFriendAddSettings } from '../services/friend-add-settings.js';
import { friendAddSettings } from './friend-add-settings.js';
import type { Env } from '../index.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','A店','s','t'),('b','ch-b','B店','s','t')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f1','U1','a','たろう')`);
  sqlite.exec(`INSERT INTO tags(id,name) VALUES('t1','新規')`);
  sqlite.exec(`INSERT INTO scenarios(id,name,trigger_type,is_active,line_account_id) VALUES('sc-a','A用','manual',1,'a'),('sc-b','B用','manual',1,'b')`);
  return { db, sqlite };
}

describe('友だち追加時設定', () => {
  test('アクションの入力: 形が違うもの・未対応のものは断る', () => {
    expect(parseFriendAddActions([{ type: 'add_tag', params: { tagId: 't1' } }, { type: 'remove_rich_menu' }])).toEqual([
      { type: 'add_tag', params: { tagId: 't1' } },
      { type: 'remove_rich_menu', params: {} },
    ]);
    expect(() => parseFriendAddActions([{ type: 'add_tag', params: {} }])).toThrow(FriendAddSettingError);
    expect(() => parseFriendAddActions([{ type: 'send_webhook', params: {} }])).toThrow(/未対応/);
  });

  test('保存と取得: 2区分は別々。別のアカウントのシナリオは選べない', async () => {
    const { db } = setup();
    expect((await getFriendAddSettings(db, 'a')).new).toMatchObject({ scenarioId: null, actions: [] });
    await saveFriendAddSetting(db, 'a', 'new', { scenarioId: 'sc-a', actions: [{ type: 'add_tag', params: { tagId: 't1' } }] });
    const s = await getFriendAddSettings(db, 'a');
    expect(s.new).toMatchObject({ scenarioId: 'sc-a', actions: [{ type: 'add_tag', params: { tagId: 't1' } }] });
    expect(s.returning.scenarioId).toBeNull();
    await expect(saveFriendAddSetting(db, 'a', 'returning', { scenarioId: 'sc-b' })).rejects.toThrow(/シナリオ/);
    await saveFriendAddSetting(db, 'a', 'new', { scenarioId: '', actions: [] }); // 解除
    expect((await getFriendAddSettings(db, 'a')).new).toMatchObject({ scenarioId: null, actions: [] });
  });

  test('追加されたとき: シナリオに登録し、タグを付ける。区分が違えば何もしない。二重には送らない', async () => {
    const { db, sqlite } = setup();
    await saveFriendAddSetting(db, 'a', 'new', { scenarioId: 'sc-a', actions: [{ type: 'add_tag', params: { tagId: 't1' } }] });
    const enrolled: string[] = [];
    const onEnrolled = async (id: string) => {
      enrolled.push(id);
    };
    await applyFriendAddSettings(db, { kind: 'returning', friendId: 'f1', lineAccountId: 'a', onEnrolled });
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_tags').get()).toEqual({ c: 0 });
    await applyFriendAddSettings(db, { kind: 'new', friendId: 'f1', lineAccountId: 'a', onEnrolled });
    expect(enrolled).toEqual(['sc-a']);
    expect(sqlite.prepare("SELECT COUNT(*) c FROM friend_tags WHERE friend_id='f1' AND tag_id='t1'").get()).toEqual({ c: 1 });
    await applyFriendAddSettings(db, { kind: 'new', friendId: 'f1', lineAccountId: 'a', onEnrolled });
    expect(enrolled).toEqual(['sc-a']);
  });

  test('API: 保存と取得。区分が不正なら400', async () => {
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
    const get = (await (await app.request('/api/friend-add-settings?lineAccountId=a', {}, env)).json()) as { data: { new: { scenarioId: string } } };
    expect(get.data.new.scenarioId).toBe('sc-a');
  });
});
