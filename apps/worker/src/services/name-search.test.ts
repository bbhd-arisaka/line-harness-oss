import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { chats } from '../routes/chats.js';
import { FRIEND_NAME_COLUMNS, nameSearchCondition } from './name-search.js';

describe('nameSearchCondition', () => {
  it('空の検索・空白だけの検索は、条件なし', () => {
    expect(nameSearchCondition(FRIEND_NAME_COLUMNS, '')).toBeNull();
    expect(nameSearchCondition(FRIEND_NAME_COLUMNS, ' 　 ')).toBeNull();
  });
  it('3つの名前の列のどれかに一致(OR)。空白は取り除いて比べる', () => {
    const c = nameSearchCondition(FRIEND_NAME_COLUMNS, '山田 花子');
    expect(c?.binds).toEqual(['%山田花子%', '%山田花子%', '%山田花子%']);
    expect(c?.sql.split(' OR ')).toHaveLength(3);
  });
  it('% _ \\ はワイルドカードにしない', () => {
    expect(nameSearchCondition(['f.display_name'], '100%_a\\b')?.binds).toEqual(['%100\\%\\_a\\\\b%']);
  });
});

describe('GET /api/chats?search(トーク一覧の名前検索)', () => {
  const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  beforeEach(() => {
    fixture = sqliteD1();
    const db = fixture.sqlite;
    db.exec(schema);
    db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('a1', 'c1', '店A', 't', 's');
    db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('a2', 'c2', '店B', 't', 's');
    const friend = (id: string, acc: string, display: string, real: string | null, system: string | null) =>
      db.prepare('INSERT INTO friends(id,line_user_key,line_user_id,line_account_id,display_name,real_name,system_display_name) VALUES(?,?,?,?,?,?,?)').run(id, `k-${id}`, `u-${id}`, acc, display, real, system);
    friend('f1', 'a1', 'はなこ', '山田 花子', null); // LINE名と本名が違う
    friend('f2', 'a1', 'Taro', null, null);
    friend('f3', 'a1', 'ゆう', null, '佐藤 優'); // システム表示名
    friend('f9', 'a2', 'はなこ', '山田 花子', null); // 別のアカウント
    for (const f of ['f1', 'f2', 'f3', 'f9']) {
      db.prepare("INSERT INTO chats(id,friend_id,status,last_message_at,created_at) VALUES(?,?,'unread','2026-10-18T10:00:00.000','2026-10-18T10:00:00.000')").run(`c-${f}`, f);
      db.prepare("INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES(?,?,'incoming','text','こんにちは','2026-10-18T10:00:00.000')").run(`m-${f}`, f);
    }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = new Hono();
    app.route('/', chats);
  });

  const list = async (q: string, extra = '') => {
    const res = await app.request(`/api/chats?lineAccountId=a1&search=${encodeURIComponent(q)}${extra}`, {}, { DB: fixture.db });
    const json = (await res.json()) as { success: boolean; data: Array<{ friendId: string }> };
    return json.data.map((r) => r.friendId).sort();
  };

  it('LINE名でも、本名でも、見つかる', async () => {
    expect(await list('はなこ')).toEqual(['f1']);
    expect(await list('山田')).toEqual(['f1']);
    expect(await list('Taro')).toEqual(['f2']);
    expect(await list('佐藤')).toEqual(['f3']);
  });
  it('空白の有無・全角と半角の空白に関係なく、本名が見つかる', async () => {
    expect(await list('山田花子')).toEqual(['f1']);
    expect(await list('山田 花子')).toEqual(['f1']);
    expect(await list('山田　花子')).toEqual(['f1']);
  });
  it('英字の大文字・小文字は区別しない。見つからなければ空', async () => {
    expect(await list('taro')).toEqual(['f2']);
    expect(await list('いない人')).toEqual([]);
  });
  it('検索なし・空白だけなら、そのアカウントの全員(別のアカウントは出ない)', async () => {
    expect(await list('')).toEqual(['f1', 'f2', 'f3']);
    expect(await list('  ')).toEqual(['f1', 'f2', 'f3']);
  });
  it('対応状況の絞り込みと組み合わせられる', async () => {
    fixture.sqlite.prepare("UPDATE chats SET status = 'resolved' WHERE friend_id = 'f1'").run();
    expect(await list('山田', '&status=unread')).toEqual([]);
    expect(await list('山田', '&status=resolved')).toEqual(['f1']);
  });
});
