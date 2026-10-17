import { LineClient } from '@line-crm/line-sdk';
import { countAccountMonthlyMessages, monthStartJst } from './quota.js';

/**
 * ホーム(トップ)画面の集計。アプリ・Web が同じ数字を見る(Lステップの「トップ」と同じ項目 + 運用の指標 + 重要なお知らせ)。
 *
 * 【読み取りを少なくする】D1 の読み取り行数に気をつける。1アカウントぶんを、数本の集計の問い合わせだけで作り、
 * 結果は短い間(45秒)覚える(route 側)。友だちの数の推移は、messages_log や friend_events ではなく friends の列から出す
 * (登録=first_followed_at、ブロック=last_unfollowed_at)。友だち1アカウントぶんの行を読むだけで済む。
 */

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertTarget = { kind: 'chats'; status: 'unread' } | { kind: 'broadcasts' } | { kind: 'friends' };

export interface HomeAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  /** タイトルを補う短い文(なくてよい) */
  detail?: string;
  /** タップしたときに開く画面 */
  target?: AlertTarget;
}

export interface TrendRow {
  /** YYYY-MM-DD(日本時間) */
  date: string;
  /** 登録数(新しく友だちになった人) */
  added: number;
  /** ブロックされた数 */
  blocked: number;
  /** 前日比(登録 − ブロック) */
  delta: number;
  /** その日の終わりの、有効な友だち数 */
  active: number;
}

export interface ChatStatusCounts {
  unread: number;
  in_progress: number;
  resolved: number;
}

export interface QuotaSummary {
  type: 'limited' | 'none';
  limit: number | null;
  consumption: number | null;
  remaining: number | null;
}

export interface HomeSummary {
  accountId: string;
  generatedAt: string;
  friends: { active: number; blocked: number; total: number };
  chatStatus: ChatStatusCounts;
  /** 未対応のうち、24時間以上たっているもの */
  unreadOver24h: number;
  /** 未対応のうち、いちばん古いものの経過時間(時間) */
  oldestUnreadHours: number | null;
  /** LINE の送信可能数。取得できなかったときは null */
  quota: QuotaSummary | null;
  /** 今月送った通数(beyond line から送った分の概算) */
  sentThisMonth: number;
  trend: TrendRow[];
  ops: {
    /** 直近7日の、最初の返信までの平均時間(分)。返信が1件もなければ null */
    avgFirstReplyMinutes: number | null;
    /** 上の平均に使った件数 */
    repliedCount: number;
    receivedThisMonth: number;
    formAnswersThisMonth: number;
    addedThisMonth: number;
    blockedThisMonth: number;
    /** ブロック数 ÷ 友だち総数(%)。総数 0 なら null */
    blockRatePct: number | null;
  };
  /** 今月の新しい友だちの、流入経路ごとの人数(多い順・上位5) */
  routes: Array<{ key: string; label: string; count: number }>;
  alerts: HomeAlert[];
}

// ── 日付(日本時間) ──

const DAY_MS = 86_400_000;

/** 日本時間の YYYY-MM-DD を、古い順に days 個(最後が今日) */
export function jstDateKeys(nowMs: number, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(nowMs + 9 * 3600_000 - i * DAY_MS).toISOString().slice(0, 10));
  }
  return out;
}

/** 日本時間の「いまから hours 時間前」を、created_at と比べられる形(YYYY-MM-DDTHH:MM)で */
export function jstHoursAgo(nowMs: number, hours: number): string {
  return new Date(nowMs + 9 * 3600_000 - hours * 3600_000).toISOString().slice(0, 16);
}

/**
 * 友だち数の推移(14日など)。有効な友だち数は、いまの数から、さかのぼって計算する:
 *   その日の終わり = いまの数 − (その翌日以降の登録) + (その翌日以降のブロック)
 */
export function buildTrend(keys: string[], added: ReadonlyMap<string, number>, blocked: ReadonlyMap<string, number>, activeNow: number): TrendRow[] {
  const rows: TrendRow[] = keys.map((date) => {
    const a = added.get(date) ?? 0;
    const b = blocked.get(date) ?? 0;
    return { date, added: a, blocked: b, delta: a - b, active: 0 };
  });
  let running = activeNow;
  for (let i = rows.length - 1; i >= 0; i--) {
    rows[i].active = Math.max(0, running);
    running = running - rows[i].added + rows[i].blocked;
  }
  return rows;
}

// ── 重要なお知らせ ──

export const UNREAD_WARN_HOURS = 24;
export const UNREAD_CRITICAL_HOURS = 72;

interface AlertInput {
  unreadOver24h: number;
  oldestUnreadHours: number | null;
  quota: QuotaSummary | null;
  activeFriends: number;
  trend: TrendRow[];
  totalFriends: number;
  /** 直近7日の一斉配信で、止まっている・届いていない人がいるもの */
  brokenBroadcasts: number;
  lastAddedDaysAgo: number | null;
  tokenExpiresInDays: number | null;
}

function hoursLabel(h: number): string {
  return h >= 48 ? `${Math.floor(h / 24)}日` : `${Math.floor(h)}時間`;
}

/** お知らせを組み立てる(重要度の高い順) */
export function buildAlerts(input: AlertInput): HomeAlert[] {
  const out: HomeAlert[] = [];

  if (input.unreadOver24h > 0) {
    const oldest = input.oldestUnreadHours ?? UNREAD_WARN_HOURS;
    out.push({
      id: 'unread-over-24h',
      severity: oldest >= UNREAD_CRITICAL_HOURS ? 'critical' : 'warning',
      title: `${UNREAD_WARN_HOURS}時間以上、未対応のトークが${input.unreadOver24h.toLocaleString('ja-JP')}件`,
      detail: `いちばん古いもの: ${hoursLabel(oldest)}`,
      target: { kind: 'chats', status: 'unread' },
    });
  }

  const q = input.quota;
  if (q && q.type === 'limited' && q.remaining !== null) {
    if (q.remaining === 0) {
      out.push({ id: 'quota-empty', severity: 'critical', title: '今月の送信可能数が0通', detail: '一斉配信は送れません' });
    } else if (input.activeFriends > 0 && q.remaining < input.activeFriends) {
      out.push({
        id: 'quota-short',
        severity: 'warning',
        title: `送信可能数(残り${q.remaining.toLocaleString('ja-JP')}通)が、友だち数より少ない`,
        detail: '全員への一斉配信は送れません',
      });
    } else if (q.limit && q.remaining / q.limit < 0.1) {
      out.push({ id: 'quota-low', severity: 'info', title: `送信可能数が残り${q.remaining.toLocaleString('ja-JP')}通`, detail: `上限の${Math.round((q.remaining / q.limit) * 100)}%` });
    }
  }

  if (input.brokenBroadcasts > 0) {
    out.push({
      id: 'broadcast-problem',
      severity: 'warning',
      title: `届いていない一斉配信が${input.brokenBroadcasts.toLocaleString('ja-JP')}件`,
      detail: '直近7日',
      target: { kind: 'broadcasts' },
    });
  }

  // ブロックの急増: 今日が5人以上で、直近7日の平均の2倍以上
  const today = input.trend[input.trend.length - 1];
  const prior = input.trend.slice(-8, -1);
  if (today && prior.length > 0) {
    const avg = prior.reduce((s, r) => s + r.blocked, 0) / prior.length;
    if (today.blocked >= 5 && today.blocked >= avg * 2) {
      out.push({ id: 'block-spike', severity: 'warning', title: `今日のブロックが${today.blocked}人`, detail: `直近7日の平均は${avg.toFixed(1)}人`, target: { kind: 'friends' } });
    }
  }

  // 新しい友だちが、7日以上いない(流入が止まっている)。友だちがいるアカウントだけ
  if (input.totalFriends >= 50 && input.lastAddedDaysAgo !== null && input.lastAddedDaysAgo >= 7) {
    out.push({ id: 'no-new-friends', severity: 'info', title: `新しい友だちが${input.lastAddedDaysAgo}日間いません` });
  }

  // LINEの接続(トークン)は、期限の7日前から自動で更新される(services/token-refresh.ts)。
  // 3日前になっても残っているときだけ、自動更新が失敗しているとみなして知らせる(7〜14日前に出すと、ただの雑音になる)
  if (input.tokenExpiresInDays !== null && input.tokenExpiresInDays <= 3) {
    out.push({
      id: 'token-expiring',
      severity: 'critical',
      title: input.tokenExpiresInDays <= 0 ? 'LINEの接続の有効期限が切れています' : `LINEの接続の有効期限まで、あと${input.tokenExpiresInDays}日`,
      detail: '自動で更新できていません',
    });
  }

  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ── データの読み取り ──

interface CountRow {
  d: string | null;
  n: number;
}

function toMap(rows: CountRow[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows ?? []) if (r.d) m.set(r.d, (m.get(r.d) ?? 0) + r.n);
  return m;
}

/** LINE の送信可能数(プランの上限と、今月の消費)。短い間だけ覚える */
const quotaCache = new Map<string, { at: number; value: QuotaSummary | null }>();
const QUOTA_TTL_MS = 5 * 60_000;

export async function loadQuota(accountId: string, token: string, nowMs: number, client: Pick<LineClient, 'getMessageQuota' | 'getMessageQuotaConsumption'> = new LineClient(token)): Promise<QuotaSummary | null> {
  const hit = quotaCache.get(accountId);
  if (hit && nowMs - hit.at < QUOTA_TTL_MS) return hit.value;
  let value: QuotaSummary | null = null;
  try {
    const [quota, usage] = await Promise.all([client.getMessageQuota(), client.getMessageQuotaConsumption()]);
    const limit = quota?.type === 'limited' && typeof quota.value === 'number' ? quota.value : null;
    const consumption = typeof usage?.totalUsage === 'number' ? usage.totalUsage : null;
    value =
      quota?.type === 'none'
        ? { type: 'none', limit: null, consumption, remaining: null }
        : { type: 'limited', limit, consumption, remaining: limit !== null && consumption !== null ? Math.max(0, limit - consumption) : null };
  } catch {
    value = null; // 取れなかったときは、画面に「取得できません」と出す(0通と見せない)
  }
  quotaCache.set(accountId, { at: nowMs, value });
  return value;
}

export function resetQuotaCache(): void {
  quotaCache.clear();
}

export interface AccountForHome {
  id: string;
  channel_access_token: string;
  token_expires_at?: string | null;
}

export async function loadHomeSummary(db: D1Database, account: AccountForHome, nowMs: number = Date.now(), quotaLoader: typeof loadQuota = loadQuota): Promise<HomeSummary> {
  const id = account.id;
  const keys = jstDateKeys(nowMs, 14);
  const since14 = keys[0];
  const monthStart = monthStartJst(new Date(nowMs));
  const month = monthStart.slice(0, 10);
  const ago7 = jstDateKeys(nowMs, 8)[0];
  const over24 = jstHoursAgo(nowMs, UNREAD_WARN_HOURS);

  const [friendsRow, addedRows, blockedRows, chatRows, unreadAge, replyRow, receivedRow, formRow, routeRows, brokenRow, lastAddedRow, quota, sent] = await Promise.all([
    db
      .prepare(`SELECT COALESCE(SUM(CASE WHEN is_following = 1 THEN 1 ELSE 0 END), 0) AS active, COALESCE(SUM(CASE WHEN is_following = 0 THEN 1 ELSE 0 END), 0) AS blocked, COUNT(*) AS total FROM friends WHERE line_account_id = ?`)
      .bind(id)
      .first<{ active: number; blocked: number; total: number }>(),
    db
      .prepare(`SELECT substr(COALESCE(first_followed_at, created_at), 1, 10) AS d, COUNT(*) AS n FROM friends WHERE line_account_id = ? AND COALESCE(first_followed_at, created_at) >= ? GROUP BY d`)
      .bind(id, since14)
      .all<CountRow>(),
    db
      .prepare(`SELECT substr(last_unfollowed_at, 1, 10) AS d, COUNT(*) AS n FROM friends WHERE line_account_id = ? AND last_unfollowed_at >= ? GROUP BY d`)
      .bind(id, since14)
      .all<CountRow>(),
    // 友だちごとの、いちばん新しいトークの状態(トーク一覧・下バーの数字と同じ数え方)
    db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM (
           SELECT c.status AS status, MAX(c.created_at) AS created_at
           FROM chats c JOIN friends f ON f.id = c.friend_id
           WHERE f.line_account_id = ?
           GROUP BY c.friend_id
         ) GROUP BY status`,
      )
      .bind(id)
      .all<{ status: string; n: number }>(),
    // 未対応のうち 24時間以上たっているもの・いちばん古いもの(最後の受信の時刻 = chats.last_message_at)
    db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN last_at < ? THEN 1 ELSE 0 END) AS over, MIN(last_at) AS oldest FROM (
           SELECT c.status AS status, MAX(c.created_at) AS created_at, COALESCE(c.last_message_at, c.created_at) AS last_at
           FROM chats c JOIN friends f ON f.id = c.friend_id
           WHERE f.line_account_id = ?
           GROUP BY c.friend_id
         ) WHERE status = 'unread'`,
      )
      .bind(over24, id)
      .first<{ total: number; over: number | null; oldest: string | null }>(),
    // 直近7日: お客様のメッセージのうち、直前が自分たちの送信(または最初)のものについて、その後の最初の手動返信までの時間
    db
      .prepare(
        `SELECT AVG((julianday(reply_at) - julianday(at)) * 1440.0) AS avg_min, COUNT(*) AS n FROM (
           SELECT i.created_at AS at,
                  (SELECT MIN(o.created_at) FROM messages_log o WHERE o.friend_id = i.friend_id AND o.direction = 'outgoing' AND o.source = 'manual' AND o.created_at > i.created_at) AS reply_at
           FROM messages_log i JOIN friends f ON f.id = i.friend_id
           WHERE i.direction = 'incoming' AND f.line_account_id = ? AND i.created_at >= ?
             AND COALESCE((SELECT p.direction FROM messages_log p WHERE p.friend_id = i.friend_id AND p.created_at < i.created_at ORDER BY p.created_at DESC LIMIT 1), 'outgoing') = 'outgoing'
         ) WHERE reply_at IS NOT NULL AND (julianday(reply_at) - julianday(at)) < 7`,
      )
      .bind(id, ago7)
      .first<{ avg_min: number | null; n: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM messages_log m JOIN friends f ON f.id = m.friend_id WHERE m.direction = 'incoming' AND f.line_account_id = ? AND m.created_at >= ?`)
      .bind(id, month)
      .first<{ n: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM form_submissions s JOIN friends f ON f.id = s.friend_id WHERE f.line_account_id = ? AND s.created_at >= ?`)
      .bind(id, month)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COALESCE(NULLIF(f.ref_code, ''), '') AS ref, COUNT(*) AS n FROM friends f
         WHERE f.line_account_id = ? AND COALESCE(f.first_followed_at, f.created_at) >= ?
         GROUP BY ref ORDER BY n DESC LIMIT 6`,
      )
      .bind(id, month)
      .all<{ ref: string; n: number }>(),
    // 直近7日の一斉配信で、止まっている(エラーあり)・届いた割合が9割未満のもの
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM broadcasts WHERE line_account_id = ? AND substr(created_at, 1, 10) >= ?
           AND ((last_error IS NOT NULL AND status IN ('scheduled', 'sending')) OR (status = 'sent' AND total_count > 0 AND success_count * 10 < total_count * 9))`,
      )
      .bind(id, ago7)
      .first<{ n: number }>(),
    db
      .prepare(`SELECT MAX(COALESCE(first_followed_at, created_at)) AS last_at FROM friends WHERE line_account_id = ?`)
      .bind(id)
      .first<{ last_at: string | null }>(),
    quotaLoader(id, account.channel_access_token, nowMs),
    countAccountMonthlyMessages(db, id, new Date(nowMs)).catch(() => 0),
  ]);

  const active = friendsRow?.active ?? 0;
  const blocked = friendsRow?.blocked ?? 0;
  const total = friendsRow?.total ?? 0;
  const status: ChatStatusCounts = { unread: 0, in_progress: 0, resolved: 0 };
  for (const r of chatRows.results ?? []) if (r.status in status) status[r.status as keyof ChatStatusCounts] = r.n;

  const unreadOver24h = unreadAge?.over ?? 0;
  const oldestUnreadHours = unreadAge?.oldest ? Math.max(0, (nowMs - parseJstMs(unreadAge.oldest)) / 3600_000) : null;

  const trend = buildTrend(keys, toMap(addedRows.results), toMap(blockedRows.results), active);
  const monthTrendAdded = await countSince(db, 'added', id, month);
  const monthBlocked = await countSince(db, 'blocked', id, month);

  // 流入経路の名前(entry_routes の ref_code → 名前)
  const refs = (routeRows.results ?? []).map((r) => r.ref).filter((r) => r !== '');
  const names = new Map<string, string>();
  if (refs.length > 0) {
    const named = await db
      .prepare(`SELECT ref_code, name FROM entry_routes WHERE ref_code IN (${refs.map(() => '?').join(',')})`)
      .bind(...refs)
      .all<{ ref_code: string; name: string }>();
    for (const r of named.results ?? []) names.set(r.ref_code, r.name);
  }
  const routes = (routeRows.results ?? [])
    .map((r) => ({ key: r.ref || '(none)', label: r.ref === '' ? '経路の記録なし' : (names.get(r.ref) ?? r.ref), count: r.n }))
    .slice(0, 5);

  const lastAddedDaysAgo = lastAddedRow?.last_at ? Math.floor((nowMs - parseJstMs(lastAddedRow.last_at)) / DAY_MS) : null;
  const tokenExpiresInDays = account.token_expires_at ? Math.floor((parseJstMs(account.token_expires_at) - nowMs) / DAY_MS) : null;

  const alerts = buildAlerts({
    unreadOver24h,
    oldestUnreadHours,
    quota,
    activeFriends: active,
    trend,
    totalFriends: total,
    brokenBroadcasts: brokenRow?.n ?? 0,
    lastAddedDaysAgo,
    tokenExpiresInDays,
  });

  return {
    accountId: id,
    generatedAt: new Date(nowMs).toISOString(),
    friends: { active, blocked, total },
    chatStatus: status,
    unreadOver24h,
    oldestUnreadHours,
    quota,
    sentThisMonth: sent,
    trend,
    ops: {
      avgFirstReplyMinutes: replyRow?.avg_min != null ? Math.round(replyRow.avg_min) : null,
      repliedCount: replyRow?.n ?? 0,
      receivedThisMonth: receivedRow?.n ?? 0,
      formAnswersThisMonth: formRow?.n ?? 0,
      addedThisMonth: monthTrendAdded,
      blockedThisMonth: monthBlocked,
      blockRatePct: total > 0 ? Math.round((blocked / total) * 1000) / 10 : null,
    },
    routes,
    alerts,
  };
}

async function countSince(db: D1Database, kind: 'added' | 'blocked', accountId: string, since: string): Promise<number> {
  const sql =
    kind === 'added'
      ? `SELECT COUNT(*) AS n FROM friends WHERE line_account_id = ? AND COALESCE(first_followed_at, created_at) >= ?`
      : `SELECT COUNT(*) AS n FROM friends WHERE line_account_id = ? AND last_unfollowed_at >= ?`;
  const row = await db.prepare(sql).bind(accountId, since).first<{ n: number }>();
  return row?.n ?? 0;
}

/** DB の時刻の文字列(日本時間。+09:00 が付く・付かないの両方)を、ミリ秒にする */
export function parseJstMs(s: string): number {
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  const iso = hasZone ? s : `${s.length === 10 ? `${s}T00:00:00` : s}+09:00`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.now() : ms;
}
