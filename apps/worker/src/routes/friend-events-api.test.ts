import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

// 実際のDB(bootstrap.sql)で、トークの出来事のログが API に出ること・記録されることを確かめる。
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn() }));
vi.mock('../services/step-delivery.js', () => ({ buildMessage: vi.fn(), messageToLogPayload: vi.fn() }));

const { chats } = await import('./chats.js');
const { friends } = await import('./friends.js');
type Env = import('../index.js').Env;

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

let sqlite: ReturnType<typeof sqliteD1>['sqlite'];
let env: Env['Bindings'];

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 's1', name: '佐藤', role: 'admin' });
    await next();
  });
  instance.route('/', chats);
  instance.route('/', friends);
  return instance;
}

beforeEach(() => {
  const made = sqliteD1();
  sqlite = made.sqlite;
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('acc-a','ch-a','A店','s','t')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,metadata) VALUES('f1','U1','acc-a','たろう','{"phone":"080"}'),('f2','U2','acc-a','はなこ','{}')`);
  sqlite.exec(`INSERT INTO friend_field_definitions(id,field_key,label,field_type) VALUES('d1','phone','電話番号','text'),('d2','addr','住所','text')`);
  sqlite.exec(`INSERT INTO tags(id,name) VALUES('t1','SNS流入')`);
  env = { DB: made.db } as unknown as Env['Bindings'];
});

async function json(res: Response) {
  return (await res.json()) as { success: boolean; data: any };
}

describe('GET /api/chats/:id の events', () => {
  test('その友だちの出来事だけを、時刻の昇順で返す。既存のフィールドは変わらない', async () => {
    sqlite.exec(`INSERT INTO friend_events(id,friend_id,event_type,text,actor,created_at) VALUES
      ('e2','f1','tag_added','タグ「SNS流入」を追加しました','佐藤','2026-10-01T10:00:00.000'),
      ('e1','f1','blocked','ブロックされました','LINE','2026-10-01T09:00:00.000'),
      ('e3','f2','followed','友だち追加されました','LINE','2026-10-01T08:00:00.000')`);
    sqlite.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES('m1','f1','incoming','text','こんにちは','2026-10-01T09:30:00.000')`);
    const res = await app().request('/api/chats/f1', {}, env);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.events).toEqual([
      { id: 'e1', type: 'blocked', text: 'ブロックされました', actor: 'LINE', createdAt: '2026-10-01T09:00:00.000' },
      { id: 'e2', type: 'tag_added', text: 'タグ「SNS流入」を追加しました', actor: '佐藤', createdAt: '2026-10-01T10:00:00.000' },
    ]);
    // 既存のフィールド
    expect(body.data).toMatchObject({ id: 'f1', friendId: 'f1', friendName: 'たろう', status: 'resolved' });
    expect(body.data.messages).toEqual([
      { id: 'm1', direction: 'incoming', messageType: 'text', content: 'こんにちは', createdAt: '2026-10-01T09:30:00.000' },
    ]);
  });

  test('チャット行の id でも、同じ友だちの出来事を返す。出来事が無ければ空配列', async () => {
    sqlite.exec(`INSERT INTO chats(id,friend_id,status) VALUES('c1','f1','unread')`);
    sqlite.exec(`INSERT INTO friend_events(id,friend_id,event_type,text,created_at) VALUES('e1','f1','blocked','ブロックされました','2026-10-01T09:00:00.000')`);
    const viaChat = await json(await app().request('/api/chats/c1', {}, env));
    expect(viaChat.data.events.map((e: { id: string }) => e.id)).toEqual(['e1']);
    const none = await json(await app().request('/api/chats/f2', {}, env));
    expect(none.data.events).toEqual([]);
  });
});

describe('スタッフ操作の記録', () => {
  function put(path: string, body: unknown) {
    return app().request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  }
  const eventRows = (id = 'f1') =>
    sqlite.prepare('SELECT event_type, text, actor, detail FROM friend_events WHERE friend_id=? ORDER BY rowid').all(id);

  test('PUT metadata: 変わった項目だけ、ラベルで・スタッフ名つきで記録する(値は入れない)', async () => {
    const res = await put('/api/friends/f1/metadata', { phone: '080', addr: '東京都千代田区', nickname: 'たろ' });
    expect(res.status).toBe(200);
    expect(eventRows()).toEqual([
      {
        event_type: 'friend_info_changed',
        text: '友だち情報「住所」「nickname」を変更しました',
        actor: '佐藤',
        detail: '{"fields":["住所","nickname"]}',
      },
    ]);
    expect(JSON.stringify(eventRows())).not.toContain('千代田');
    // 同じ内容で保存し直しても増えない
    await put('/api/friends/f1/metadata', { phone: '080', addr: '東京都千代田区' });
    expect(eventRows()).toHaveLength(1);
  });

  test('PUT profile: 変わった項目をまとめて記録する。変わらなければ記録しない', async () => {
    await put('/api/friends/f1/profile', { realName: '山田 太郎', systemDisplayName: '山田さん', memo: 'ひみつ' });
    await put('/api/friends/f1/profile', { realName: '山田 太郎', memo: 'ひみつ' });
    expect(eventRows()).toEqual([
      {
        event_type: 'profile_changed',
        text: '本名・システム表示名・個別メモを変更しました',
        actor: '佐藤',
        detail: '{"fields":["本名","システム表示名","個別メモ"]}',
      },
    ]);
  });

  test('POST/DELETE tags: スタッフ名つきで、変化したときだけ記録する', async () => {
    const post = () =>
      app().request('/api/friends/f1/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tagId: 't1' }) }, env);
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201); // 付け直し
    expect((await app().request('/api/friends/f1/tags/t1', { method: 'DELETE' }, env)).status).toBe(200);
    expect((await app().request('/api/friends/f1/tags/t1', { method: 'DELETE' }, env)).status).toBe(200); // 外し直し
    expect(eventRows().map((e) => (e as { text: string; actor: string }).text + '/' + (e as { actor: string }).actor)).toEqual([
      'タグ「SNS流入」を追加しました/佐藤',
      'タグ「SNS流入」を削除しました/佐藤',
    ]);
  });
});
