import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const closes: Array<() => void> = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
  vi.restoreAllMocks();
  vi.resetModules();
});

const jst = (offsetHours: number) => new Date(Date.now() + 9 * 3600_000 + offsetHours * 3600_000).toISOString();

function setup() {
  const { db, sqlite } = sqliteD1();
  closes.push(() => sqlite.close());
  sqlite.exec(schema);
  sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,is_active) VALUES('a','a','a','tok','sec',1)");
  /** 配信済みの配信1件と、その開封の集計の行 */
  function broadcast(id: string, o: { sentHoursAgo: number; requestId?: string | null; unit?: string | null; success?: number; insight: 'pending' | 'ready'; fetchedHoursAgo?: number }) {
    sqlite
      .prepare(
        `INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,sent_at,total_count,success_count,line_account_id,line_request_id,aggregation_unit)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, id, 'text', 'x', 'all', 'sent', jst(-o.sentHoursAgo), o.success ?? 100, o.success ?? 100, 'a', o.requestId ?? null, o.unit ?? null);
    sqlite
      .prepare(`INSERT INTO broadcast_insights(id,broadcast_id,status,fetched_at,delivered,unique_impression) VALUES(?,?,?,?,?,?)`)
      .run(`i-${id}`, id, o.insight, o.fetchedHoursAgo == null ? null : jst(-o.fetchedHoursAgo), o.insight === 'ready' ? 100 : null, o.insight === 'ready' ? 10 : null);
  }
  const row = (id: string) => sqlite.prepare('SELECT * FROM broadcast_insights WHERE broadcast_id = ?').get(id) as Record<string, unknown>;
  return { db, broadcast, row };
}

async function run(db: D1Database) {
  // 1日1回の間引きはモジュール内の変数なので、テストごとに読み込み直す
  vi.resetModules();
  const { processInsightFetch: fresh } = await import('./insight-fetcher.js');
  const client = new LineClient('tok');
  await fresh(db, new Map([['a', client]]), client);
}

describe('processInsightFetch(開封数の取得)', () => {
  it('全員配信は、配信の翌日から取りに行き、開封率を出す', async () => {
    const s = setup();
    s.broadcast('b1', { sentHoursAgo: 30, requestId: 'req1', insight: 'pending' });
    const spy = vi.spyOn(LineClient.prototype, 'getMessageEventInsight').mockResolvedValue({ overview: { delivered: 200, uniqueImpression: 80, uniqueClick: 20 } });
    await run(s.db);
    expect(spy).toHaveBeenCalledWith('req1');
    const r = s.row('b1');
    expect(r.status).toBe('ready');
    expect(r.unique_impression).toBe(80);
    expect(r.open_rate).toBeCloseTo(0.4);
    expect(r.click_rate).toBeCloseTo(0.1);
  });

  it('配信から1日たっていない配信は、まだ取りに行かない', async () => {
    const s = setup();
    s.broadcast('b1', { sentHoursAgo: 5, requestId: 'req1', insight: 'pending' });
    const spy = vi.spyOn(LineClient.prototype, 'getMessageEventInsight').mockResolvedValue({});
    await run(s.db);
    expect(spy).not.toHaveBeenCalled();
    expect(s.row('b1').status).toBe('pending');
  });

  it('タグ・条件指定の配信は、送れた人数で開封率を出す(unitの集計には配信数が無い)', async () => {
    const s = setup();
    s.broadcast('b1', { sentHoursAgo: 30, unit: 'u1', success: 50, insight: 'pending' });
    vi.spyOn(LineClient.prototype, 'getUnitInsight').mockResolvedValue({ messages: [{ uniqueImpression: 25, uniqueClick: 5 }] });
    await run(s.db);
    const r = s.row('b1');
    expect(r.status).toBe('ready');
    expect(r.delivered).toBe(50);
    expect(r.open_rate).toBeCloseTo(0.5);
    expect(r.click_rate).toBeCloseTo(0.1);
  });

  it('LINEの集計がまだ空なら、確定せずに翌日またやり直す(3回で諦める)', async () => {
    const s = setup();
    s.broadcast('b1', { sentHoursAgo: 30, requestId: 'req1', insight: 'pending' });
    vi.spyOn(LineClient.prototype, 'getMessageEventInsight').mockResolvedValue({ overview: { delivered: 200 } });
    await run(s.db);
    let r = s.row('b1');
    expect(r.status).toBe('pending');
    expect(r.retry_count).toBe(1);
    expect(r.unique_impression).toBeNull();
    await s.db.prepare('UPDATE broadcast_insights SET retry_count = 2 WHERE broadcast_id = ?').bind('b1').run();
    await run(s.db);
    r = s.row('b1');
    expect(r.status).toBe('failed');
  });

  it('取れた配信は、1週間は1日おきに取り直す。空の結果では上書きしない', async () => {
    const s = setup();
    s.broadcast('fresh', { sentHoursAgo: 60, requestId: 'r-fresh', insight: 'ready', fetchedHoursAgo: 2 });
    s.broadcast('stale', { sentHoursAgo: 60, requestId: 'r-stale', insight: 'ready', fetchedHoursAgo: 30 });
    s.broadcast('old', { sentHoursAgo: 24 * 12, requestId: 'r-old', insight: 'ready', fetchedHoursAgo: 24 * 10 });
    const spy = vi.spyOn(LineClient.prototype, 'getMessageEventInsight').mockResolvedValue({ overview: { delivered: 100, uniqueImpression: 40 } });
    await run(s.db);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['r-stale']);
    expect(s.row('stale').unique_impression).toBe(40);
    expect(s.row('fresh').unique_impression).toBe(10);
    expect(s.row('old').unique_impression).toBe(10);

    // 取り直しの結果が空でも、すでにある数字は消さない
    spy.mockResolvedValue({ overview: {} });
    await s.db.prepare("UPDATE broadcast_insights SET fetched_at = ? WHERE broadcast_id = 'stale'").bind(jst(-30)).run();
    await run(s.db);
    expect(s.row('stale').unique_impression).toBe(40);
    expect(s.row('stale').status).toBe('ready');
  });
});
