import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { isDemoLineUserId } from './demo-friend.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const demo = readFileSync(new URL('../../../../packages/db/migrations/101_demo_review_data.sql', import.meta.url), 'utf8');
const ACCOUNT = 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8';

describe('App Store 審査用のデモデータ', () => {
  test('「beyond-line運営」に、ダミーの友だち・トーク・タグが入り、何度流しても増えない', () => {
    const { sqlite } = sqliteD1();
    sqlite.exec(schema);
    sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('${ACCOUNT}','c','beyond-line運営','s','t')`);
    sqlite.exec(demo);
    sqlite.exec(demo);
    const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
    expect(count(`SELECT COUNT(*) n FROM friends WHERE line_account_id='${ACCOUNT}'`)).toBe(6);
    expect(count('SELECT COUNT(*) n FROM chats')).toBe(6);
    expect(count('SELECT COUNT(*) n FROM messages_log')).toBe(10);
    expect(count('SELECT COUNT(*) n FROM friend_tags')).toBe(5);
    expect(count(`SELECT COUNT(*) n FROM friends WHERE line_user_id NOT LIKE 'Udemo%'`)).toBe(0);
    expect(count(`SELECT COUNT(*) n FROM chats WHERE status='unread'`)).toBe(2);
  });

  test('アカウントが無い環境では、何も入らない', () => {
    const { sqlite } = sqliteD1();
    sqlite.exec(schema);
    sqlite.exec(demo);
    expect((sqlite.prepare('SELECT COUNT(*) n FROM friends').get() as { n: number }).n).toBe(0);
  });

  test('デモの友だちの判定', () => {
    expect(isDemoLineUserId('Udemo000000000000000000000000001')).toBe(true);
    expect(isDemoLineUserId('U1234567890abcdef')).toBe(false);
    expect(isDemoLineUserId(null)).toBe(false);
  });
});
