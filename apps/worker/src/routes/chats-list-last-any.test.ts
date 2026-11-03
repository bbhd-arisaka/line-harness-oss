import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { chats } from './chats.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

// トーク一覧の「友だちごとの最後のメッセージ」は、履歴を全部数え直す書き方から、
// 部分インデックスで1人1行だけ引く書き方に変えた(D1 の読み取り行数を減らすため)。結果が同じで、インデックスが使われることを確かめる。
const OLD_LAST_ANY = `
  SELECT friend_id, MAX(created_at) AS last_message_at
  FROM messages_log
  WHERE (delivery_type IS NULL OR delivery_type != 'test')
    AND (broadcast_id IS NULL AND COALESCE(source, '') != 'broadcast')
    AND friend_id IN (SELECT id FROM friends WHERE line_account_id = ?)
  GROUP BY friend_id ORDER BY friend_id`;
const NEW_LAST_ANY = `
  SELECT friend_id, last_message_at FROM (
    SELECT f.id AS friend_id,
      (SELECT m.created_at FROM messages_log m
        WHERE m.friend_id = f.id
          AND (m.delivery_type IS NULL OR m.delivery_type != 'test')
          AND (m.broadcast_id IS NULL AND COALESCE(m.source, '') != 'broadcast')
        ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
    FROM friends f
    WHERE f.line_account_id = ?
  ) WHERE last_message_at IS NOT NULL ORDER BY friend_id`;

describe('トーク一覧の最後のメッセージ(部分インデックス)', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c1','A','t','s'),('b','c2','B','t','s');
      INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES
        ('f1','U1','a','x'),('f2','U2','a','x'),('f3','U3','a','x'),('f4','U4','a','メッセージなし'),('f5','U5','a','配信だけ'),('f6','U6','b','別アカウント');
      INSERT INTO broadcasts(id,title,message_type,message_content,target_type,line_account_id) VALUES('bc','配信','text','本文','all','a');
      INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,delivery_type,source,created_at) VALUES
        ('1','f1','incoming','text','a',NULL,NULL,'user','2026-10-01T10:00:00.000+09:00'),
        ('2','f1','outgoing','text','b',NULL,'test','manual','2026-10-09T10:00:00.000+09:00'),
        ('3','f1','outgoing','text','c','bc',NULL,'broadcast','2026-10-10T10:00:00.000+09:00'),
        ('4','f2','outgoing','text','d',NULL,NULL,NULL,'2026-10-02T10:00:00.000'),
        ('5','f2','incoming','text','e',NULL,NULL,'user','2026-10-03T10:00:00.000+09:00'),
        ('6','f3','outgoing','text','f',NULL,'reply','auto_reply','2026-10-04T10:00:00.000+09:00'),
        ('7','f5','outgoing','text','g','bc',NULL,'broadcast','2026-10-10T10:00:00.000+09:00'),
        ('8','f5','outgoing','text','h',NULL,'test','broadcast','2026-10-10T11:00:00.000+09:00'),
        ('9','f6','incoming','text','i',NULL,NULL,'user','2026-10-05T10:00:00.000+09:00');
    `);
  });
  afterEach(() => fixture.sqlite.close());

  it('以前の書き方と同じ結果(テスト送信・一斉配信は除く/メッセージのない人は出ない/別アカウントは混ざらない)', () => {
    const oldRows = fixture.sqlite.prepare(OLD_LAST_ANY).all('a');
    const newRows = fixture.sqlite.prepare(NEW_LAST_ANY).all('a');
    expect(newRows).toEqual(oldRows);
    expect(newRows).toEqual([
      { friend_id: 'f1', last_message_at: '2026-10-01T10:00:00.000+09:00' },
      { friend_id: 'f2', last_message_at: '2026-10-03T10:00:00.000+09:00' },
      { friend_id: 'f3', last_message_at: '2026-10-04T10:00:00.000+09:00' },
    ]);
  });

  it('友だちごとに部分インデックスを1回引くだけで、履歴を走査しない', () => {
    const plan = fixture.sqlite.prepare(`EXPLAIN QUERY PLAN ${NEW_LAST_ANY}`).all('a').map((r) => (r as { detail: string }).detail).join('\n');
    expect(plan).toContain('idx_messages_log_chat_last (friend_id=?)');
  });

  it('一覧のAPIに実際に使われる(新しい書き方でも同じ並び)', async () => {
    const app = new Hono();
    app.route('/', chats);
    const res = await app.request('/api/chats?lineAccountId=a', {}, { DB: fixture.db });
    const body = (await res.json()) as { data: Array<{ friendId: string; lastMessageAt: string }> };
    expect(body.data.map((c) => c.friendId)).toEqual(['f3', 'f2', 'f1']);
    expect(body.data.map((c) => c.lastMessageAt)).toEqual(['2026-10-04T10:00:00.000+09:00', '2026-10-03T10:00:00.000+09:00', '2026-10-01T10:00:00.000+09:00']);
  });
});
