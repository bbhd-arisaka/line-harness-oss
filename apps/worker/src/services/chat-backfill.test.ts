import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const backfill = readFileSync(new URL('../../../../packages/db/migrations/097_backfill_chats_for_new_friends.sql', import.meta.url), 'utf8');

describe('友だち追加だけの人を、個別トークの一覧に出す(補完)', () => {
  test('直近14日にフォローした、トークの行が無い人にだけ、対応済みの行を作る', () => {
    const { sqlite } = sqliteD1();
    sqlite.exec(schema);
    sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','A店','s','t')`);
    const recent = new Date(Date.now() + 9 * 3600 * 1000 - 2 * 86_400_000).toISOString().slice(0, 23);
    const old = new Date(Date.now() + 9 * 3600 * 1000 - 40 * 86_400_000).toISOString().slice(0, 23);
    sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,is_following,current_follow_started_at,created_at) VALUES
      ('new','U1','a','ここな',1,'${recent}','${recent}'),
      ('old','U2','a','古い人',1,'${old}','${old}'),
      ('blocked','U3','a','ブロック',0,'${recent}','${recent}'),
      ('has','U4','a','行あり',1,'${recent}','${recent}')`);
    sqlite.exec(`INSERT INTO chats(id,friend_id,status) VALUES('c-has','has','in_progress')`);
    sqlite.exec(backfill);
    const rows = sqlite.prepare('SELECT friend_id, status FROM chats ORDER BY friend_id').all();
    expect(rows).toEqual([
      { friend_id: 'has', status: 'in_progress' },
      { friend_id: 'new', status: 'resolved' },
    ]);
    // 2回流しても増えない
    sqlite.exec(backfill);
    expect(sqlite.prepare('SELECT COUNT(*) c FROM chats').get()).toEqual({ c: 2 });
  });
});
