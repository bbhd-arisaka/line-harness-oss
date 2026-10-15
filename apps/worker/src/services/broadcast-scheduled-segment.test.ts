import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { LineClient, type Message } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { broadcasts } from '../routes/broadcasts.js';
import { processQueuedBroadcasts, processScheduledBroadcasts } from './broadcast.js';

vi.mock('./stealth.js', () => ({ sleep: async () => {}, calculateStaggerDelay: () => 0, addMessageVariation: (s: string) => s }));
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const closes: Array<() => void> = [];
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  for (const close of closes.splice(0)) close();
  vi.restoreAllMocks();
});

// アプリからの予約配信(2026-10-15): 「条件で絞り込む」配信も、予約の時刻に、その条件に合う人だけへ送る
function setup() {
  const { db, sqlite } = sqliteD1(); closes.push(() => sqlite.close()); sqlite.exec(schema);
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run<T>()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network forbidden'));
  vi.spyOn(LineClient.prototype, 'getMessageQuota').mockResolvedValue({ type: 'none' });
  vi.spyOn(LineClient.prototype, 'getMessageQuotaConsumption').mockResolvedValue({ totalUsage: 0 });
  const multicast = vi.spyOn(LineClient.prototype, 'multicast').mockResolvedValue({ data: {}, requestId: 'r' } as never);
  const sendAll = vi.spyOn(LineClient.prototype, 'broadcast').mockResolvedValue({ data: {}, requestId: 'r' } as never);
  const app = new Hono(); app.route('/', broadcasts);
  sqlite.exec(`INSERT INTO tags(id,name) VALUES('vip','VIP');
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','A','tok-a','sec');`);
  const friend = (i: number, vip: boolean) => {
    sqlite.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following) VALUES(?,?,?,?,1)').run(`f${i}`, `U${i}`, `n${i}`, 'a');
    if (vip) sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?, 'vip')").run(`f${i}`);
  };
  const create = async (body: Record<string, unknown>) => {
    const r = await app.request('/api/broadcasts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 't', targetType: 'all', lineAccountId: 'a', trackLinks: false, ...body }) }, { DB: db });
    return { status: r.status, json: (await r.json()) as { success: boolean; error?: string; data?: { id: string; status: string; scheduledAt: string | null; segmentConditions: unknown } } };
  };
  const row = (id: string) => sqlite.prepare('SELECT status, scheduled_at, segment_conditions, success_count, total_count FROM broadcasts WHERE id = ?').get(id) as Record<string, unknown>;
  return { db, sqlite, friend, create, row, multicast, sendAll, app };
}

const VIP = { operator: 'AND', rules: [{ type: 'tag_exists', value: 'vip' }] };
const PAST = '2020-01-01T00:00:00.000+09:00';
const FUTURE = '2999-01-01T09:00:00.000+09:00';

describe('作成(予約+条件)', () => {
  it('予約の日時と条件を保存し、状態は「予約中」', async () => {
    const s = setup();
    const r = await s.create({ messages: [{ type: 'text', content: 'お知らせ' }], scheduledAt: FUTURE, segmentConditions: VIP });
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ status: 'scheduled', scheduledAt: FUTURE, segmentConditions: VIP });
  });
  it('条件の形が正しくないとき・対象が全員でないときは断る', async () => {
    const s = setup();
    expect((await s.create({ messages: [{ type: 'text', content: 'x' }], scheduledAt: FUTURE, segmentConditions: { operator: 'XOR', rules: [] } })).status).toBe(400);
    expect((await s.create({ messages: [{ type: 'text', content: 'x' }], scheduledAt: FUTURE, segmentConditions: { operator: 'AND', rules: [] } })).status).toBe(400);
    const tagged = await s.create({ targetType: 'tag', targetTagId: 'vip', messages: [{ type: 'text', content: 'x' }], segmentConditions: VIP });
    expect(tagged.status).toBe(400);
  });
  it('下書きに、あとから予約と条件を付けられる(テスト送信した下書きを、そのまま予約する流れ)', async () => {
    const s = setup();
    const d = await s.create({ messages: [{ type: 'text', content: 'お知らせ' }] });
    expect(d.json.data?.status).toBe('draft');
    const put = await s.app.request(`/api/broadcasts/${d.json.data!.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduledAt: FUTURE, segmentConditions: VIP }) }, { DB: s.db });
    expect(put.status).toBe(200);
    expect(s.row(d.json.data!.id)).toMatchObject({ status: 'scheduled', scheduled_at: FUTURE });
  });
});

describe('予約の時刻になったとき', () => {
  it('条件つきは、その条件に合う人だけに、順番待ち(キュー)経由で送る', async () => {
    const s = setup(); s.friend(1, true); s.friend(2, false); s.friend(3, true);
    const r = await s.create({ messages: [{ type: 'text', content: 'VIPだけへ' }, { type: 'text', content: '2通目' }], scheduledAt: PAST, segmentConditions: VIP });
    const id = r.json.data!.id;
    await processScheduledBroadcasts(s.db, new LineClient('test-default'));
    // 予約の時刻になったら、条件つきは「送信中(キュー待ち)」になり、まだ送られない
    expect(s.row(id).status).toBe('sending');
    expect(s.multicast).not.toHaveBeenCalled();
    await processQueuedBroadcasts(s.db, new LineClient('test-default'));
    expect(s.multicast).toHaveBeenCalledTimes(1);
    expect((s.multicast.mock.calls[0][0] as string[]).sort()).toEqual(['U1', 'U3']);
    expect((s.multicast.mock.calls[0][1] as Message[]).map((m) => (m.type === 'text' ? m.text : m.type))).toEqual(['VIPだけへ', '2通目']);
    expect(s.row(id)).toMatchObject({ status: 'sent', total_count: 2 });
    expect(s.sendAll).not.toHaveBeenCalled();
  });
  it('条件なしの予約は、これまでどおり(友だち全員へ broadcast)', async () => {
    const s = setup(); s.friend(1, true); s.friend(2, false);
    const r = await s.create({ messages: [{ type: 'text', content: '全員へ' }], scheduledAt: PAST });
    await processScheduledBroadcasts(s.db, new LineClient('test-default'));
    expect(s.sendAll).toHaveBeenCalledTimes(1);
    expect(s.row(r.json.data!.id).status).toBe('sent');
  });
  it('まだ時刻になっていない予約は送らない', async () => {
    const s = setup(); s.friend(1, true);
    const r = await s.create({ messages: [{ type: 'text', content: 'x' }], scheduledAt: FUTURE, segmentConditions: VIP });
    await processScheduledBroadcasts(s.db, new LineClient('test-default'));
    await processQueuedBroadcasts(s.db, new LineClient('test-default'));
    expect(s.multicast).not.toHaveBeenCalled();
    expect(s.row(r.json.data!.id).status).toBe('scheduled');
  });
});
