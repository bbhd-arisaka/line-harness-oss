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

// アプリの下バー「トーク」の数字: その公式アカウントの「未対応」のトーク数(一覧の「未対応」と同じ数え方)
describe('新着の合図(pulse)の未対応数', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES
        ('acc','ch','A','t','s'),('other','ch2','B','t','s');
      INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES
        ('f1','U1','acc','a'),('f2','U2','acc','b'),('f3','U3','acc','c'),('f4','U4','acc','d'),('x1','U9','other','別アカウント');
      INSERT INTO chats(id,friend_id,status,created_at,updated_at) VALUES
        ('c1','f1','unread','2026-10-10T00:00:00.000','2026-10-10T00:00:00.000'),
        ('c2','f2','in_progress','2026-10-10T00:00:00.000','2026-10-10T00:00:00.000'),
        ('c3','f3','resolved','2026-10-10T00:00:00.000','2026-10-10T00:00:00.000'),
        ('c4','f4','resolved','2026-10-10T00:00:00.000','2026-10-10T00:00:00.000'),
        ('cx','x1','unread','2026-10-10T00:00:00.000','2026-10-10T00:00:00.000');
    `);
  });
  afterEach(() => fixture.sqlite.close());

  function appWith(allowed: string[] | null) {
    const a = new Hono<{ Variables: { allowedAccountIds: string[] | null } }>();
    a.use('*', async (c, next) => {
      c.set('allowedAccountIds', allowed);
      await next();
    });
    a.route('/', chats as never);
    return a;
  }

  it('最新のトークの状態が「未対応」の人だけを、その公式アカウント分だけ数える', async () => {
    const res = await appWith(null).request('/api/chats/pulse?unread=1&lineAccountId=acc', {}, { DB: fixture.db });
    const body = (await res.json()) as { data: { unreadCount: number } };
    expect(body.data.unreadCount).toBe(1); // f1 のみ(f2=対応中・f3/f4=対応済み・別アカウントは数えない)
  });

  it('unread=1 でなければ数えない(軽い確認のまま)', async () => {
    const res = await appWith(null).request('/api/chats/pulse?lineAccountId=acc', {}, { DB: fixture.db });
    expect(((await res.json()) as { data: Record<string, unknown> }).data).not.toHaveProperty('unreadCount');
  });

  it('見てよい公式アカウントの範囲外は数えない(403)', async () => {
    const res = await appWith(['other']).request('/api/chats/pulse?unread=1&lineAccountId=acc', {}, { DB: fixture.db });
    expect(res.status).toBe(403);
  });
});
