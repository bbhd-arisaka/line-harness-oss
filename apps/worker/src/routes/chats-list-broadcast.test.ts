import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { chats } from './chats.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

// 一斉配信の記録は、個別トークの並び順・一覧の最後のメッセージ・新着の合図に使わない(2026-10-15・ユーザー指摘)。
// 一斉配信すると配信先の全員に同じ時刻の記録が入り、全員が一斉に先頭へ動いて順番がバラバラになるため。
describe('個別トーク一覧と一斉配信', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
        VALUES('acc','ch','A','t','s');
      INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES
        ('f1','U1','acc','一番上のはず'),('f2','U2','acc','二番目'),('f3','U3','acc','三番目');
      -- お客様とのやり取り: f1(10:00) > f2(09:00) > f3(08:00)
      INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,created_at) VALUES
        ('m1','f1','incoming','text','f1のメッセージ','user','2026-10-15T10:00:00.000+09:00'),
        ('m2','f2','incoming','text','f2のメッセージ','user','2026-10-15T09:00:00.000+09:00'),
        ('m3','f3','incoming','text','f3のメッセージ','user','2026-10-15T08:00:00.000+09:00');
      -- そのあと(12:00)に、全員へ一斉配信
      INSERT INTO broadcasts(id,title,message_type,message_content,target_type,line_account_id) VALUES('b1','配信','text','一斉配信の本文','all','acc');
      INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,source,line_account_id,created_at) VALUES
        ('b-f3','f3','outgoing','text','一斉配信の本文','b1','broadcast','acc','2026-10-15T12:00:00.000+09:00'),
        ('b-f2','f2','outgoing','text','一斉配信の本文','b1','broadcast','acc','2026-10-15T12:00:00.000+09:00'),
        ('b-f1','f1','outgoing','text','一斉配信の本文','b1','broadcast','acc','2026-10-15T12:00:00.000+09:00');
    `);
    app = new Hono();
    app.route('/', chats);
  });
  afterEach(() => fixture.sqlite.close());

  it('一斉配信しても、並び順と一覧の最後のメッセージは変わらない', async () => {
    const res = await app.request('/api/chats?lineAccountId=acc', {}, { DB: fixture.db });
    const body = (await res.json()) as { data: Array<{ friendId: string; lastMessageAt: string; lastMessageContent: string | null }> };
    expect(body.data.map((c) => c.friendId)).toEqual(['f1', 'f2', 'f3']);
    expect(body.data.map((c) => c.lastMessageContent)).toEqual(['f1のメッセージ', 'f2のメッセージ', 'f3のメッセージ']);
    expect(body.data[0].lastMessageAt).toBe('2026-10-15T10:00:00.000+09:00');
  });

  it('個別トークの中身(履歴)には、一斉配信のメッセージが今までどおり出る', async () => {
    const res = await app.request('/api/chats/f3', {}, { DB: fixture.db });
    const body = (await res.json()) as { data: { messages: Array<{ content: string }> } };
    expect(body.data.messages.map((m) => m.content)).toContain('一斉配信の本文');
  });

  it('スタッフの手動返信(source=manual)は、今までどおり並び順に使う', async () => {
    fixture.sqlite.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,created_at)
      VALUES('man','f3','outgoing','text','手動の返信','manual','2026-10-15T13:00:00.000+09:00')`);
    const res = await app.request('/api/chats?lineAccountId=acc', {}, { DB: fixture.db });
    const body = (await res.json()) as { data: Array<{ friendId: string }> };
    expect(body.data.map((c) => c.friendId)).toEqual(['f3', 'f1', 'f2']);
  });

  it('新着の合図(pulse)にも、一斉配信は数えない', async () => {
    const res = await app.request('/api/chats/pulse', {}, { DB: fixture.db });
    expect(((await res.json()) as { data: { latest: string } }).data.latest).toBe('2026-10-15T10:00:00.000+09:00');
  });

  it('移行106: 一斉配信の記録しかない人にも、トークの行を作る(何度流しても同じ)', () => {
    fixture.sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,created_at) VALUES('f4','U4','acc','配信だけの人','2026-10-01T09:00:00.000+09:00')`);
    fixture.sqlite.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,source,created_at)
      VALUES('b-f4','f4','outgoing','text','本文','b1','broadcast','2026-10-15T12:00:00.000+09:00')`);
    const sql = readFileSync(new URL('../../../../packages/db/migrations/106_chats_backfill_for_broadcast_only.sql', import.meta.url), 'utf8');
    fixture.sqlite.exec(sql);
    fixture.sqlite.exec(sql);
    const rows = fixture.sqlite.prepare("SELECT friend_id,status,last_message_at,line_account_id FROM chats WHERE friend_id='f4'").all();
    expect(rows).toEqual([{ friend_id: 'f4', status: 'resolved', last_message_at: '2026-10-01T09:00:00.000+09:00', line_account_id: 'acc' }]);
  });
});
