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

describe('GET /api/chats/message-search(トーク内容の検索)', () => {
  const get = (q: string, account = 'acc-a') => app().request(`/api/chats/message-search?lineAccountId=${account}&q=${encodeURIComponent(q)}`, {}, env);
  beforeEach(() => {
    sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('acc-b','ch-b','B店','s','t')`);
    sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f3','U3','acc-b','別店のお客様')`);
    sqlite.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES
      ('m1','f1','incoming','text','来週の土曜日にまつげパーマの予約をお願いしたいです','2026-10-01T09:00:00.000'),
      ('m2','f1','outgoing','text','ご予約を承りました。まつげパーマ、お待ちしております','2026-10-01T09:05:00.000'),
      ('m3','f2','incoming','text','ネイルの予約は可能ですか','2026-10-02T09:00:00.000'),
      ('m4','f3','incoming','text','まつげパーマの料金を教えてください','2026-10-03T09:00:00.000'),
      ('m5','f1','outgoing','flex','{"type":"bubble","text":"まつげパーマ"}','2026-10-04T09:00:00.000')`);
    sqlite.exec(`UPDATE messages_log SET delivery_type='test' WHERE id='m3'`);
  });

  test('本文に検索語を含む友だちを、友だちごとに新しい該当1件と該当数で返す(同じ公式アカウントの中だけ)', async () => {
    const body = await json(await get('まつげパーマ'));
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ friendId: 'f1', name: 'たろう', hits: 2, direction: 'outgoing' });
    expect(body.data.items[0].snippet).toContain('まつげパーマ');
  });
  test('一覧の各行に、該当メッセージのIDを付ける(トークを開いたときに、その位置へ移動するため)', async () => {
    const body = await json(await get('まつげパーマ'));
    expect(body.data.items[0].messageId).toBe('m2');
  });
  test('friendId を付けると、その友だちの該当メッセージを新しい順にすべて返す(別の公式アカウントの友だちは空)', async () => {
    const one = (friendId: string, account = 'acc-a') =>
      app().request(`/api/chats/message-search?lineAccountId=${account}&q=${encodeURIComponent('まつげパーマ')}&friendId=${friendId}`, {}, env);
    const body = await json(await one('f1'));
    expect(body.data.items.map((i: { messageId: string }) => i.messageId)).toEqual(['m2', 'm1']);
    expect(body.data.items[0]).toMatchObject({ direction: 'outgoing', content: expect.stringContaining('まつげパーマ') });
    expect((await json(await one('f3'))).data.items).toEqual([]);
  });
  test('テスト配信・カード(flex)は探さない。2文字未満は探さない', async () => {
    expect((await json(await get('ネイル'))).data.items).toEqual([]);
    expect((await json(await get('ま'))).data.items).toEqual([]);
  });
  test('% や _ は、ふつうの文字として探す', async () => {
    expect((await json(await get('%%'))).data.items).toEqual([]);
  });
});
