import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { loadInflowAnalytics } from './inflow-analytics.js';

const NOW = Date.parse('2026-10-18T12:00:00+09:00');

describe('流入経路分析', () => {
  const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
  let fixture: ReturnType<typeof sqliteD1>;
  beforeEach(() => {
    fixture = sqliteD1();
    const db = fixture.sqlite;
    db.exec(schema);
    for (const id of ['a1', 'a2']) db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run(id, `c-${id}`, id, 'tok', 'sec');
    for (const [id, acc] of [['f1', 'a1'], ['f2', 'a1'], ['f3', 'a2']]) db.prepare('INSERT INTO friends(id,line_user_id,line_account_id) VALUES(?,?,?)').run(id, `u-${id}`, acc);
    db.prepare('INSERT INTO entry_route_folders(id,line_account_id,name,display_order,created_at) VALUES(?,?,?,?,?)').run('fo1', 'a1', '広告', 1, 'x');
    const route = db.prepare('INSERT INTO entry_routes(id,ref_code,name,line_account_id,folder_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    route.run('R1', 'c1', 'ホットペッパー', 'a1', 'fo1', 'x', 'x');
    route.run('R2', 'c2', 'Instagram', 'a1', null, 'x', 'x');
    route.run('R3', 'c3', '読み取りなし', 'a1', null, 'x', 'x');
    route.run('R4', 'c4', '別アカウント', 'a2', null, 'x', 'x');
    const hit = db.prepare('INSERT INTO ref_tracking(id,ref_code,friend_id,entry_route_id,created_at) VALUES(?,?,?,?,?)');
    hit.run('h1', 'c1', 'f1', 'R1', '2026-09-20T10:00:00.000+09:00'); // f1 の最初(9月)
    hit.run('h2', 'c1', 'f1', 'R1', '2026-10-02T10:00:00.000+09:00'); // 同じ人の2回目: 回数には数えるが、人数には数えない
    hit.run('h3', 'c1', 'f2', 'R1', '2026-10-05T10:00:00.000+09:00');
    hit.run('h4', 'c1', null, 'R1', '2026-10-06T10:00:00.000+09:00'); // 友だち未確定: 回数だけ
    hit.run('h5', 'c2', 'f2', 'R2', '2026-10-07T10:00:00.000+09:00');
    hit.run('h6', 'c4', 'f3', 'R4', '2026-10-07T10:00:00.000+09:00');
  });

  it('経路×月(日本時間)の人数と回数。同じ人は最初の月にだけ数える。読み取りのない経路・別アカウントは入らない', async () => {
    const r = await loadInflowAnalytics(fixture.db, 'a1', NOW);
    expect(r.currentMonth).toBe('2026-10');
    const sorted = [...r.routes].sort((a, b) => a.id.localeCompare(b.id));
    expect(sorted).toEqual([
      { id: 'R1', name: 'ホットペッパー', folder: '広告', people: { '2026-09': 1, '2026-10': 1 }, times: { '2026-09': 1, '2026-10': 3 } },
      { id: 'R2', name: 'Instagram', folder: null, people: { '2026-10': 1 }, times: { '2026-10': 1 } },
    ]);
  });
});
