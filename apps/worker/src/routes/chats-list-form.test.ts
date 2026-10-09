import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

vi.mock('@line-crm/db', () => ({
  getOperators: vi.fn(),
  getOperatorById: vi.fn(),
  createOperator: vi.fn(),
  updateOperator: vi.fn(),
  deleteOperator: vi.fn(),
  getChats: vi.fn(),
  getChatById: vi.fn(),
  createChat: vi.fn(),
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  updateChat: vi.fn(),
  jstNow: vi.fn(() => '2026-08-12T21:00:00.000+09:00'),
}));

import { chats } from './chats.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

type Row = { friendId: string; status: string; lastMessageAt: string; lastMessageContent: string | null; lastMessageDirection: string | null; lastMessageType: string | null };

async function list(): Promise<Row[]> {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('A','ca','A','t','s')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f1','u1','A','one'),('f2','u2','A','two'),('f3','u3','A','three')`);
  // f1: 古いメッセージのあとに、フォーム回答(新しい)
  sqlite.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,created_at) VALUES('m1','f1','incoming','text','古いメッセージ','user','2026-08-10T10:00:00.000+09:00')`);
  sqlite.exec(`INSERT INTO friend_events(id,friend_id,line_account_id,event_type,text,actor,created_at) VALUES('e1','f1','A','form_submitted','フォーム「アンケート」に回答しました','フォーム','2026-08-12T09:00:00.000+09:00')`);
  sqlite.exec(`INSERT INTO chats(id,friend_id,status,last_message_at) VALUES('c1','f1','unread','2026-08-12T09:00:00.000+09:00')`);
  // f2: フォーム回答のあとに、新しいメッセージ
  sqlite.exec(`INSERT INTO friend_events(id,friend_id,line_account_id,event_type,text,actor,created_at) VALUES('e2','f2','A','form_submitted','フォーム「別」に回答しました','フォーム','2026-08-11T09:00:00.000+09:00')`);
  sqlite.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,created_at) VALUES('m2','f2','incoming','text','新しいメッセージ','user','2026-08-12T08:00:00.000+09:00')`);
  // f3: メッセージだけ
  sqlite.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,created_at) VALUES('m3','f3','outgoing','text','返信','user','2026-08-09T08:00:00.000+09:00')`);
  const app = new Hono();
  app.route('/', chats);
  const res = await app.request(new Request('http://worker.test/api/chats?lineAccountId=A'), {}, { DB: db } as never);
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Row[] }).data;
}

describe('GET /api/chats: フォーム回答の表示', () => {
  test('メッセージより新しいフォーム回答は、一覧の最新の内容として出て、並びも一番上', async () => {
    const rows = await list();
    expect(rows.map((r) => r.friendId)).toEqual(['f1', 'f2', 'f3']);
    expect(rows[0]).toMatchObject({
      lastMessageAt: '2026-08-12T09:00:00.000+09:00',
      lastMessageContent: 'フォーム「アンケート」に回答しました',
      lastMessageDirection: 'incoming',
      lastMessageType: 'text',
      status: 'unread',
    });
  });
  test('フォーム回答のあとに来たメッセージが新しければ、メッセージのまま', async () => {
    const rows = await list();
    expect(rows[1]).toMatchObject({ lastMessageContent: '新しいメッセージ', lastMessageDirection: 'incoming' });
  });
  test('フォーム回答が無い友だちは、今までどおり', async () => {
    const rows = await list();
    expect(rows[2]).toMatchObject({ lastMessageContent: '返信', lastMessageDirection: 'outgoing' });
  });
});

describe('GET /api/chats: 回答結果を見るカードの表示', () => {
  test('カードは一覧では、見出しの文(通常の受信メッセージ)として出る', async () => {
    const { db, sqlite } = sqliteD1();
    sqlite.exec(schema);
    sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('A','ca','A','t','s')`);
    sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f1','u1','A','one')`);
    sqlite.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,created_at) VALUES('m1','f1','incoming','form_answer','{"title":"アンケートに回答しました","body":"","buttonLabel":"回答結果を見る"}','form','2026-08-12T10:00:00.000+09:00')`);
    const app = new Hono();
    app.route('/', chats);
    const res = await app.request(new Request('http://worker.test/api/chats?lineAccountId=A'), {}, { DB: db } as never);
    const rows = ((await res.json()) as { data: Row[] }).data;
    expect(rows[0]).toMatchObject({ lastMessageContent: 'アンケートに回答しました', lastMessageType: 'text', lastMessageDirection: 'incoming' });
  });
});
