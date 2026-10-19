import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { recordRefTracking } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('流入経路が踏まれたら、個別トークの履歴に出来事として残る', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a1','c1','大門','t','s');
      INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f1','U1','a1','はなこ'),('f2','U2','a1','たろう');
      INSERT INTO entry_routes(id,ref_code,name,line_account_id,actions) VALUES('r1','HPB111','HPB経由','a1','[]');
    `);
  });
  const events = (friendId: string) =>
    fixture.sqlite.prepare("SELECT event_type, text, actor FROM friend_events WHERE friend_id = ? ORDER BY created_at, rowid").all(friendId) as Array<{ event_type: string; text: string; actor: string }>;

  it('踏まれたら「流入経路「◯◯」を読み取りました」が1行残る。流入経路が無い記録・友だちが分からない記録では残さない', async () => {
    await recordRefTracking(fixture.db, { refCode: 'HPB111', friendId: 'f1', entryRouteId: 'r1' });
    expect(events('f1')).toEqual([{ event_type: 'inflow_route', text: '流入経路「HPB経由」を読み取りました', actor: '流入経路' }]);
    await recordRefTracking(fixture.db, { refCode: 'xyz', friendId: 'f2', entryRouteId: null });
    await recordRefTracking(fixture.db, { refCode: 'HPB111', friendId: null, entryRouteId: 'r1' });
    expect(events('f2')).toEqual([]);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_events').get()).toEqual({ n: 1 });
  });
  it('ほぼ同時に2回記録されても、行は1つ。時間をおいた2回目は「もう一度」', async () => {
    await recordRefTracking(fixture.db, { refCode: 'HPB111', friendId: 'f1', entryRouteId: 'r1' });
    await recordRefTracking(fixture.db, { refCode: 'HPB111', friendId: 'f1', entryRouteId: 'r1' });
    expect(events('f1')).toHaveLength(1);
    fixture.sqlite.exec("UPDATE friend_events SET created_at = '2020-01-01T00:00:00.000'");
    await recordRefTracking(fixture.db, { refCode: 'HPB111', friendId: 'f1', entryRouteId: 'r1' });
    expect(events('f1').map((e) => e.text)).toEqual(['流入経路「HPB経由」を読み取りました', '流入経路「HPB経由」をもう一度読み取りました']);
  });
});
