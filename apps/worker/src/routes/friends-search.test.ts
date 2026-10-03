import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { authMiddleware } from '../middleware/auth.js';
import { friends } from './friends.js';
import type { Env } from '../index.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','ch-a','a','t','s')");
  const ins = sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name,real_name,system_display_name,created_at) VALUES(?,?,?,?,?,?,?)');
  ins.run('f1', 'u1', 'a', 'taro', '山田太郎', null, '2024-01-01');
  ins.run('f2', 'u2', 'a', 'hanako', null, 'ハナちゃん', '2024-01-02');
  ins.run('f3', 'u3', 'a', '100%OFF', null, null, '2024-01-03');
  ins.run('f4', 'u4', 'a', 'a_b', null, null, '2024-01-04');
  ins.run('f5', 'u5', 'a', 'axb', null, null, '2024-01-05');
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', friends);
  const search = async (q: string, extra = '') => {
    const res = await app.request(`/api/friends?lineAccountId=a&search=${encodeURIComponent(q)}${extra}`, { headers: { Authorization: 'Bearer k' } }, { DB: db, API_KEY: 'k' } as Env['Bindings']);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<{ id: string }>; total: number } };
    return { ids: body.data.items.map((i) => i.id), total: body.data.total };
  };
  return { search };
}

describe('GET /api/friends?search(LINE名・本名・システム表示名で検索)', () => {
  it('LINE名・本名・システム表示名のどれでも部分一致する', async () => {
    const { search } = setup();
    expect(await search('taro')).toEqual({ ids: ['f1'], total: 1 });
    expect(await search('山田')).toEqual({ ids: ['f1'], total: 1 });
    expect(await search('ハナ')).toEqual({ ids: ['f2'], total: 1 });
    expect(await search('なし')).toEqual({ ids: [], total: 0 });
  });

  it('% と _ はワイルドカードではなく、文字として探す', async () => {
    const { search } = setup();
    expect((await search('%')).ids).toEqual(['f3']);
    expect((await search('a_b')).ids).toEqual(['f4']);
  });

  it('total とページングが一致する', async () => {
    const { search } = setup();
    const p1 = await search('a', '&limit=2&offset=0');
    const p2 = await search('a', '&limit=2&offset=2');
    expect(p1.total).toBe(p2.total);
    const all = [...p1.ids, ...p2.ids];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(Math.min(4, p1.total));
  });

  it('完全一致が先に出る(本名の完全一致も)', async () => {
    const { search } = setup();
    expect((await search('山田太郎')).ids[0]).toBe('f1');
  });
});
