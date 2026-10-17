import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { buildAlerts, buildTrend, jstDateKeys, jstHoursAgo, loadHomeSummary, parseJstMs, type QuotaSummary } from './home-summary.js';

const NOW = Date.parse('2026-10-18T12:00:00+09:00');

describe('日付(日本時間)', () => {
  it('古い順に並び、最後が今日', () => {
    expect(jstDateKeys(NOW, 3)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18']);
  });
  it('日本時間の日付をまたぐ直前・直後でも、日本時間の今日になる', () => {
    expect(jstDateKeys(Date.parse('2026-10-18T23:30:00+09:00'), 1)).toEqual(['2026-10-18']);
    expect(jstDateKeys(Date.parse('2026-10-19T00:10:00+09:00'), 1)).toEqual(['2026-10-19']);
  });
  it('n時間前を、created_at と比べられる形で', () => {
    expect(jstHoursAgo(NOW, 24)).toBe('2026-10-17T12:00');
  });
  it('DB の時刻(オフセットあり・なし・日付だけ)を読む', () => {
    expect(parseJstMs('2026-10-18T12:00:00.000')).toBe(NOW);
    expect(parseJstMs('2026-10-18T12:00:00.000+09:00')).toBe(NOW);
    expect(parseJstMs('2026-10-18')).toBe(Date.parse('2026-10-18T00:00:00+09:00'));
  });
});

describe('友だち数の推移', () => {
  it('その日の終わりの有効な友だち数は、いまの数から、さかのぼって出す', () => {
    const keys = ['2026-10-16', '2026-10-17', '2026-10-18'];
    const rows = buildTrend(keys, new Map([['2026-10-17', 2], ['2026-10-18', 1]]), new Map([['2026-10-18', 1]]), 10);
    expect(rows.map((r) => r.active)).toEqual([8, 10, 10]);
    expect(rows.map((r) => r.delta)).toEqual([0, 2, 0]);
    expect(rows[2]).toMatchObject({ date: '2026-10-18', added: 1, blocked: 1 });
  });
  it('0未満にはならない', () => {
    const rows = buildTrend(['2026-10-17', '2026-10-18'], new Map([['2026-10-18', 50]]), new Map(), 3);
    expect(rows[0].active).toBe(0);
  });
});

describe('重要なお知らせ', () => {
  const base = { unreadOver24h: 0, oldestUnreadHours: null, quota: null, activeFriends: 100, trend: [], totalFriends: 100, brokenBroadcasts: 0, lastAddedDaysAgo: 0, tokenExpiresInDays: null };
  const limited = (remaining: number): QuotaSummary => ({ type: 'limited', limit: 1000, consumption: 1000 - remaining, remaining });
  it('問題がなければ、お知らせは出ない', () => {
    expect(buildAlerts(base)).toEqual([]);
  });
  it('24時間以上の未対応: 件数と最長の経過、タップで未対応のトーク一覧へ。72時間を超えたら重要度が上がる', () => {
    const w = buildAlerts({ ...base, unreadOver24h: 3, oldestUnreadHours: 30 });
    expect(w).toEqual([
      expect.objectContaining({ id: 'unread-over-24h', severity: 'warning', title: '24時間以上、未対応のトークが3件', detail: 'いちばん古いもの: 30時間', target: { kind: 'chats', status: 'unread' } }),
    ]);
    const c = buildAlerts({ ...base, unreadOver24h: 1, oldestUnreadHours: 80 });
    expect(c[0]).toMatchObject({ severity: 'critical', detail: 'いちばん古いもの: 3日' });
  });
  it('送信可能数: 0通は重要・友だち数より少ないと警告・1割未満は情報。足りていれば出ない。上限なしのプランは出ない', () => {
    expect(buildAlerts({ ...base, quota: limited(0) })[0]).toMatchObject({ id: 'quota-empty', severity: 'critical' });
    expect(buildAlerts({ ...base, quota: limited(50) })[0]).toMatchObject({ id: 'quota-short', severity: 'warning' });
    expect(buildAlerts({ ...base, activeFriends: 10, quota: limited(50) })[0]).toMatchObject({ id: 'quota-low', severity: 'info' });
    expect(buildAlerts({ ...base, activeFriends: 10, quota: limited(500) })).toEqual([]);
    expect(buildAlerts({ ...base, quota: { type: 'none', limit: null, consumption: 5, remaining: null } })).toEqual([]);
    expect(buildAlerts({ ...base, quota: null })).toEqual([]);
  });
  it('ブロックの急増: 今日5人以上で、直近の平均の2倍以上', () => {
    const mk = (today: number, prior: number) =>
      Array.from({ length: 8 }, (_, i) => ({ date: `d${i}`, added: 0, blocked: i === 7 ? today : prior, delta: 0, active: 0 }));
    expect(buildAlerts({ ...base, trend: mk(6, 1) })[0]).toMatchObject({ id: 'block-spike' });
    expect(buildAlerts({ ...base, trend: mk(6, 4) })).toEqual([]);
    expect(buildAlerts({ ...base, trend: mk(4, 0) })).toEqual([]);
  });
  it('新しい友だちが7日以上いない(友だちが50人以上のアカウントだけ)・接続の期限・届いていない配信', () => {
    expect(buildAlerts({ ...base, lastAddedDaysAgo: 9 })[0]).toMatchObject({ id: 'no-new-friends', severity: 'info' });
    expect(buildAlerts({ ...base, totalFriends: 10, lastAddedDaysAgo: 9 })).toEqual([]);
    expect(buildAlerts({ ...base, tokenExpiresInDays: 2 })[0]).toMatchObject({ id: 'token-expiring', severity: 'critical' });
    expect(buildAlerts({ ...base, tokenExpiresInDays: -1 })[0]).toMatchObject({ id: 'token-expiring', title: 'LINEの接続の有効期限が切れています' });
    // 7日前から自動で更新される。3日より前は、知らせない
    expect(buildAlerts({ ...base, tokenExpiresInDays: 10 })).toEqual([]);
    expect(buildAlerts({ ...base, tokenExpiresInDays: 5 })).toEqual([]);
    expect(buildAlerts({ ...base, brokenBroadcasts: 2 })[0]).toMatchObject({ id: 'broadcast-problem', target: { kind: 'broadcasts' } });
  });
  it('重要度の高い順に並ぶ', () => {
    const a = buildAlerts({ ...base, unreadOver24h: 1, oldestUnreadHours: 80, quota: limited(0), lastAddedDaysAgo: 9, brokenBroadcasts: 1 });
    expect(a.map((x) => x.severity)).toEqual(['critical', 'critical', 'warning', 'info']);
  });
});

describe('ホームの集計(DB)', () => {
  const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
  let fixture: ReturnType<typeof sqliteD1>;
  beforeEach(() => {
    fixture = sqliteD1();
    const db = fixture.sqlite;
    db.exec(schema);
    db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('a1', 'c1', '店A', 'tok', 'sec');
    db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('a2', 'c2', '店B', 'tok', 'sec');
    const friend = (id: string, acc: string, following: number, first: string, unfollowed: string | null, ref: string | null) =>
      db
        .prepare('INSERT INTO friends(id,line_user_key,line_user_id,line_account_id,display_name,is_following,first_followed_at,created_at,last_unfollowed_at,ref_code) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, `k-${id}`, `u-${id}`, acc, id, following, first, first, unfollowed, ref);
    friend('f1', 'a1', 1, '2026-10-18T09:00:00.000', null, 'abc');
    friend('f2', 'a1', 1, '2026-10-17T10:00:00.000', null, null);
    friend('f3', 'a1', 1, '2026-09-01T00:00:00.000', null, null);
    friend('f4', 'a1', 0, '2026-08-01T00:00:00.000', '2026-10-18T08:00:00.000', null);
    friend('f5', 'a1', 0, '2026-08-02T00:00:00.000', '2026-10-10T08:00:00.000', null);
    friend('f9', 'a2', 1, '2026-10-18T09:00:00.000', null, null);
    db.prepare('INSERT INTO entry_routes(id,ref_code,name) VALUES(?,?,?)').run('r1', 'abc', 'インスタ');
    const chat = (id: string, f: string, status: string, last: string) =>
      db.prepare('INSERT INTO chats(id,friend_id,status,last_message_at,created_at) VALUES(?,?,?,?,?)').run(id, f, status, last, last);
    chat('c-f1', 'f1', 'unread', '2026-10-18T09:00:00.000');
    chat('c-f2', 'f2', 'unread', '2026-10-16T10:00:00.000');
    chat('c-f3', 'f3', 'in_progress', '2026-10-17T10:00:00.000');
    chat('c-f4', 'f4', 'resolved', '2026-10-01T10:00:00.000');
    chat('c-f9', 'f9', 'unread', '2026-10-16T10:00:00.000');
    const msg = (id: string, f: string, dir: string, src: string | null, at: string) =>
      db.prepare("INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,created_at) VALUES(?,?,?,'text','x',?,?)").run(id, f, dir, src, at);
    msg('m1', 'f1', 'incoming', null, '2026-10-18T09:00:00.000');
    msg('m2', 'f1', 'outgoing', 'manual', '2026-10-18T09:30:00.000');
    msg('m3', 'f2', 'incoming', null, '2026-10-17T10:00:00.000');
    msg('m4', 'f2', 'incoming', null, '2026-10-17T10:05:00.000');
    msg('m5', 'f2', 'outgoing', 'manual', '2026-10-17T12:00:00.000');
    msg('m6', 'f3', 'incoming', null, '2026-10-17T10:00:00.000');
    msg('m7', 'f3', 'outgoing', 'auto_reply', '2026-10-17T10:00:01.000');
    db.prepare("INSERT INTO forms(id,name) VALUES('fm1','質問')").run();
    db.prepare("INSERT INTO form_submissions(id,form_id,friend_id,created_at) VALUES('s1','fm1','f1','2026-10-18T10:00:00.000')").run();
    db.prepare("INSERT INTO broadcasts(id,title,message_type,message_content,status,line_account_id,created_at,last_error) VALUES('b1','配信','text','x','scheduled','a1','2026-10-17T10:00:00','失敗')").run();
  });

  const load = (id = 'a1', quota: QuotaSummary | null = { type: 'limited', limit: 1000, consumption: 990, remaining: 10 }) =>
    loadHomeSummary(fixture.db, { id, channel_access_token: 'tok' }, NOW, async () => quota);

  it('友だち数: 有効・ブロック・総数(別のアカウントは数えない)', async () => {
    expect((await load()).friends).toEqual({ active: 3, blocked: 2, total: 5 });
  });
  it('対応状況: 未対応・対応中・対応済みの人数(別のアカウントは数えない)', async () => {
    expect((await load()).chatStatus).toEqual({ unread: 2, in_progress: 1, resolved: 1 });
  });
  it('24時間以上の未対応と、いちばん古い経過時間', async () => {
    const s = await load();
    expect(s.unreadOver24h).toBe(1);
    expect(Math.round(s.oldestUnreadHours ?? 0)).toBe(50);
  });
  it('推移: 今日の登録1・ブロック1、昨日の登録1。今日の終わりの有効数は、いまの数と同じ', async () => {
    const s = await load();
    expect(s.trend).toHaveLength(14);
    expect(s.trend[13]).toMatchObject({ date: '2026-10-18', added: 1, blocked: 1, delta: 0, active: 3 });
    expect(s.trend[12]).toMatchObject({ date: '2026-10-17', added: 1, blocked: 0 });
    expect(s.trend.find((r) => r.date === '2026-10-10')).toMatchObject({ blocked: 1 });
  });
  it('運用の指標: 返信までの平均(手動の返信だけ・続けての受信は1回)・今月の受信・フォーム・ブロック率', async () => {
    const s = await load();
    expect(s.ops.avgFirstReplyMinutes).toBe(75);
    expect(s.ops.repliedCount).toBe(2);
    expect(s.ops.receivedThisMonth).toBe(4);
    expect(s.ops.formAnswersThisMonth).toBe(1);
    expect(s.ops.addedThisMonth).toBe(2);
    expect(s.ops.blockedThisMonth).toBe(2);
    expect(s.ops.blockRatePct).toBe(40);
  });
  it('流入経路: 今月の新しい友だちを経路の名前ごとに(記録のない人は「経路の記録なし」)', async () => {
    const s = await load();
    expect(s.routes).toEqual(expect.arrayContaining([{ key: 'abc', label: 'インスタ', count: 1 }, { key: '(none)', label: '経路の記録なし', count: 1 }]));
  });
  it('お知らせ: 24時間以上の未対応・届いていない配信・送信可能数のわずか', async () => {
    expect((await load()).alerts.map((a) => a.id).sort()).toEqual(['broadcast-problem', 'quota-low', 'unread-over-24h']);
  });
  it('送信可能数が取れなかったとき(null)は、お知らせを出さず、quota も null のまま', async () => {
    const s = await load('a1', null);
    expect(s.quota).toBeNull();
    expect(s.alerts.map((a) => a.id)).not.toContain('quota-low');
  });
  it('友だちがいないアカウントでも、0で返る(割り算でエラーにならない)', async () => {
    fixture.sqlite.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('a3', 'c3', '空', 'tok', 'sec');
    const s = await load('a3');
    expect(s.friends).toEqual({ active: 0, blocked: 0, total: 0 });
    expect(s.chatStatus).toEqual({ unread: 0, in_progress: 0, resolved: 0 });
    expect(s.ops.blockRatePct).toBeNull();
    expect(s.ops.avgFirstReplyMinutes).toBeNull();
    expect(s.routes).toEqual([]);
  });
});
