import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { chats } from './chats.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('トークのピン留め', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('acc','ch','A','t','s');
      INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES
        ('f1','U1','acc','一番上'),('f2','U2','acc','二番目'),('f3','U3','acc','三番目');
      INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,created_at) VALUES
        ('m1','f1','incoming','text','a','user','2026-10-15T10:00:00.000+09:00'),
        ('m2','f2','incoming','text','b','user','2026-10-15T09:00:00.000+09:00'),
        ('m3','f3','incoming','text','c','user','2026-10-15T08:00:00.000+09:00');
      INSERT INTO chats(id,friend_id,status) VALUES('c1','f1','unread'),('c2','f2','in_progress'),('c3','f3','resolved');
    `);
    app = new Hono();
    app.route('/', chats);
  });
  afterEach(() => fixture.sqlite.close());

  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: fixture.db });
  const list = async (qs = '') => ((await (await call('GET', `/api/chats?lineAccountId=acc${qs}`)).json()) as { data: Array<{ friendId: string; pinned: boolean }> }).data;

  it('ピン留め・解除。一覧の各行に pinned が付く', async () => {
    expect((await list()).map((c) => c.pinned)).toEqual([false, false, false]);
    expect((await call('PUT', '/api/chats/c3/pin', { pinned: true })).status).toBe(200);
    const rows = await list();
    expect(rows.find((c) => c.friendId === 'f3')?.pinned).toBe(true);
    expect(rows.filter((c) => c.pinned)).toHaveLength(1);
    await call('PUT', '/api/chats/c3/pin', { pinned: false });
    expect((await list()).some((c) => c.pinned)).toBe(false);
  });
  it('友だちIDでも留められる(トークの行がまだ無い友だちは、作られる)', async () => {
    fixture.sqlite.exec("DELETE FROM chats WHERE id='c2'");
    expect((await call('PUT', '/api/chats/f2/pin', { pinned: true })).status).toBe(200);
    expect(fixture.sqlite.prepare("SELECT pinned_at FROM chats WHERE friend_id='f2'").get()).toMatchObject({ pinned_at: expect.any(String) });
    expect((await call('PUT', '/api/chats/nope/pin', { pinned: true })).status).toBe(404);
  });
  it('pinned=only は留めたものだけ(新しく留めたのが上)。pinned=exclude はそれ以外。対応状況の絞り込みとも組み合わせられる', async () => {
    await call('PUT', '/api/chats/c3/pin', { pinned: true });
    await new Promise((r) => setTimeout(r, 5));
    await call('PUT', '/api/chats/c1/pin', { pinned: true });
    expect((await list('&pinned=only')).map((c) => c.friendId)).toEqual(['f1', 'f3']);
    expect((await list('&pinned=exclude')).map((c) => c.friendId)).toEqual(['f2']);
    expect((await list('&pinned=only&status=resolved')).map((c) => c.friendId)).toEqual(['f3']);
    expect((await list('&pinned=exclude&status=unread')).map((c) => c.friendId)).toEqual([]);
  });
  it('トークの取得にも pinned が付く', async () => {
    await call('PUT', '/api/chats/c2/pin', { pinned: true });
    const d = (await (await call('GET', '/api/chats/f2')).json()) as { data: { pinned: boolean } };
    expect(d.data.pinned).toBe(true);
    const o = (await (await call('GET', '/api/chats/f1')).json()) as { data: { pinned: boolean } };
    expect(o.data.pinned).toBe(false);
  });
});
