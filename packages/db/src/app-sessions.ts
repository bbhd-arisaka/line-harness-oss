import { jstNow } from './utils.js';
import type { StaffMember } from './staff.js';

/**
 * iOSアプリ用のログインセッション。
 * トークン本体は保存せず、SHA-256 のハッシュだけを持つ(DB が漏れても、そのままでは使えない)。
 * トークンは先頭が lhapp_ (API キーの lh_ と区別するため)。
 */

export const APP_TOKEN_PREFIX = 'lhapp_';
const SESSION_DAYS = 90;
const TOUCH_INTERVAL_MS = 10 * 60_000;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return APP_TOKEN_PREFIX + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function jstPlusDays(days: number, now = Date.now()): string {
  return new Date(now + days * 86_400_000 + 9 * 3600_000).toISOString().replace('Z', '+09:00');
}

export interface AppSessionRow {
  id: string;
  staff_id: string;
  device_name: string | null;
  apns_token: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
}

/** セッションを作り、トークン(この1回だけ返す)と有効期限を返す */
export async function createAppSession(
  db: D1Database,
  staffId: string,
  deviceName: string | null,
  now = Date.now(),
): Promise<{ token: string; sessionId: string; expiresAt: string }> {
  const token = newToken();
  const sessionId = crypto.randomUUID();
  const expiresAt = jstPlusDays(SESSION_DAYS, now);
  await db
    .prepare('INSERT INTO app_sessions (id, staff_id, token_hash, device_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(sessionId, staffId, await sha256Hex(token), deviceName ? deviceName.slice(0, 80) : null, jstNow(), expiresAt)
    .run();
  return { token, sessionId, expiresAt };
}

/** トークンから、有効なスタッフ(と、そのセッション)を返す。無効・期限切れ・取り消し済み・スタッフ停止中は null */
export async function getStaffByAppToken(
  db: D1Database,
  token: string,
  now = Date.now(),
): Promise<{ staff: StaffMember; sessionId: string } | null> {
  if (!token.startsWith(APP_TOKEN_PREFIX) || token.length > 200) return null;
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.last_used_at, m.*
         FROM app_sessions s INNER JOIN staff_members m ON m.id = s.staff_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND m.is_active = 1 AND m.deletion_requested_at IS NULL`,
    )
    .bind(await sha256Hex(token))
    .first<StaffMember & { session_id: string; expires_at: string; last_used_at: string | null }>();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now) return null;
  // 毎回は書かない(10分に1回だけ「最後に使った時刻」を更新)
  if (!row.last_used_at || now - Date.parse(row.last_used_at) > TOUCH_INTERVAL_MS) {
    await db.prepare('UPDATE app_sessions SET last_used_at = ? WHERE id = ?').bind(jstNow(), row.session_id).run();
  }
  const { session_id, expires_at: _e, last_used_at: _l, ...staff } = row;
  void _e; void _l;
  return { staff: staff as StaffMember, sessionId: session_id };
}

export async function revokeAppSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('UPDATE app_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(jstNow(), sessionId).run();
}

export async function revokeAllAppSessionsForStaff(db: D1Database, staffId: string): Promise<number> {
  const r = await db.prepare('UPDATE app_sessions SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL').bind(jstNow(), staffId).run();
  return Number(r.meta?.changes ?? 0);
}

export async function setAppSessionApnsToken(db: D1Database, sessionId: string, apnsToken: string | null): Promise<void> {
  await db.prepare('UPDATE app_sessions SET apns_token = ? WHERE id = ?').bind(apnsToken, sessionId).run();
}

/** Android 端末のプッシュ通知(FCM)の送り先。null で解除 */
export async function setAppSessionFcmToken(db: D1Database, sessionId: string, fcmToken: string | null): Promise<void> {
  await db.prepare('UPDATE app_sessions SET fcm_token = ? WHERE id = ?').bind(fcmToken, sessionId).run();
}

/** この端末が、通知を止めている公式アカウントのID */
export async function getAppSessionMutedAccounts(db: D1Database, sessionId: string): Promise<string[]> {
  const r = await db.prepare('SELECT muted_account_ids FROM app_sessions WHERE id = ?').bind(sessionId).first<{ muted_account_ids: string | null }>();
  return parseMutedAccountIds(r?.muted_account_ids ?? null);
}

export async function setAppSessionMutedAccounts(db: D1Database, sessionId: string, accountIds: string[]): Promise<void> {
  const clean = [...new Set(accountIds.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, 200);
  await db.prepare('UPDATE app_sessions SET muted_account_ids = ? WHERE id = ?').bind(clean.length ? JSON.stringify(clean) : null, sessionId).run();
}

export function parseMutedAccountIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** アプリの通知で、「何を知らせるか」の種類。設定はアプリの設定画面だけで完結する(端末ごと) */
export const APP_PUSH_KINDS = [
  { key: 'message', label: '新着メッセージ', description: 'お客様からLINEが届いたとき', defaultOn: true },
  { key: 'form_answered', label: 'フォームの回答', description: 'お客様がフォームに回答したとき', defaultOn: true },
  { key: 'friend_added', label: '友だち追加', description: 'お客様がはじめて友だち追加したとき', defaultOn: true },
  { key: 'friend_readded', label: '友だち再追加', description: 'ブロックを解除して、お客様が友だちに戻ったとき', defaultOn: false },
  { key: 'friend_blocked', label: 'ブロック', description: 'お客様にブロックされたとき', defaultOn: false },
] as const;
export type AppPushKind = (typeof APP_PUSH_KINDS)[number]['key'];
export const isAppPushKind = (x: unknown): x is AppPushKind => APP_PUSH_KINDS.some((k) => k.key === x);
/** 初期はオフの種類(端末ごとにオンにしたものだけ通知する) */
export const DEFAULT_OFF_PUSH_KINDS: AppPushKind[] = APP_PUSH_KINDS.filter((k) => !k.defaultOn).map((k) => k.key);

/**
 * この端末で、実際に止めている種類。
 * 「止めた」と保存された種類に、初期オフの種類のうち「オンにした」と保存されていないものを足す。
 * (古いアプリは、この一覧だけを見て「止めている=オフ」と表示するので、初期オフの種類は最初からオフに見える)
 */
export function effectiveMutedPushKinds(mutedRaw: string | null, enabledRaw: string | null): AppPushKind[] {
  const muted = parseMutedPushKinds(mutedRaw);
  const enabled = parseMutedPushKinds(enabledRaw); // 同じ形式(種類の JSON 配列)
  const off = DEFAULT_OFF_PUSH_KINDS.filter((k) => !enabled.includes(k));
  return [...new Set([...muted, ...off])];
}

/** 保存された JSON から、止めている種類を取り出す(知らない種類は捨てる) */
export function parseMutedPushKinds(raw: string | null): AppPushKind[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? [...new Set(v.filter(isAppPushKind))] : [];
  } catch {
    return [];
  }
}

export async function getAppSessionMutedKinds(db: D1Database, sessionId: string): Promise<AppPushKind[]> {
  const r = await db
    .prepare('SELECT muted_push_kinds, enabled_push_kinds FROM app_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ muted_push_kinds: string | null; enabled_push_kinds: string | null }>();
  return effectiveMutedPushKinds(r?.muted_push_kinds ?? null, r?.enabled_push_kinds ?? null);
}

/**
 * 「止める種類」の全体を保存する。初期オフの種類は、一覧に入っていなければ「オンにした」と覚える
 * (アプリは、止めている種類の全体を送ってくる)。
 */
export async function setAppSessionMutedKinds(db: D1Database, sessionId: string, kinds: string[]): Promise<void> {
  const clean = [...new Set(kinds.filter(isAppPushKind))];
  const muted = clean.filter((k) => !DEFAULT_OFF_PUSH_KINDS.includes(k));
  const enabled = DEFAULT_OFF_PUSH_KINDS.filter((k) => !clean.includes(k));
  await db
    .prepare('UPDATE app_sessions SET muted_push_kinds = ?, enabled_push_kinds = ? WHERE id = ?')
    .bind(muted.length ? JSON.stringify(muted) : null, enabled.length ? JSON.stringify(enabled) : null, sessionId)
    .run();
}

// ── 通知の設定を、公式アカウントごとに持つ(端末 × 公式アカウント) ──
// push_by_account: { "<公式アカウントID>": { "m": [止めている種類], "e": [オンにした初期オフの種類] } }
// その公式アカウントの設定が無ければ、これまでの端末全体の設定(muted_push_kinds / enabled_push_kinds)を使う。

export interface AccountPushEntry {
  m: AppPushKind[];
  e: AppPushKind[];
}

export function parsePushByAccount(raw: string | null): Record<string, AccountPushEntry> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, AccountPushEntry> = {};
    for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
      if (!id || id.length > 64 || !e || typeof e !== 'object') continue;
      const entry = e as { m?: unknown; e?: unknown };
      out[id] = {
        m: Array.isArray(entry.m) ? [...new Set(entry.m.filter(isAppPushKind))] : [],
        e: Array.isArray(entry.e) ? [...new Set(entry.e.filter(isAppPushKind))] : [],
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** この端末が、この公式アカウントの通知で止めている種類(そのアカウントの設定があればそれ、無ければ端末全体の設定) */
export function mutedPushKindsForAccount(
  row: { muted_push_kinds: string | null; enabled_push_kinds: string | null; push_by_account: string | null },
  accountId: string | null,
): AppPushKind[] {
  const entry = accountId ? parsePushByAccount(row.push_by_account)[accountId] : undefined;
  if (entry) return effectiveMutedPushKinds(JSON.stringify(entry.m), JSON.stringify(entry.e));
  return effectiveMutedPushKinds(row.muted_push_kinds, row.enabled_push_kinds);
}

/** アプリの通知設定画面が見せる、この公式アカウントの設定 */
export async function getAppSessionPushForAccount(
  db: D1Database,
  sessionId: string,
  accountId: string,
): Promise<{ accountMuted: boolean; mutedKinds: AppPushKind[] }> {
  const r = await db
    .prepare('SELECT muted_account_ids, muted_push_kinds, enabled_push_kinds, push_by_account FROM app_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ muted_account_ids: string | null; muted_push_kinds: string | null; enabled_push_kinds: string | null; push_by_account: string | null }>();
  if (!r) return { accountMuted: false, mutedKinds: [] };
  return { accountMuted: parseMutedAccountIds(r.muted_account_ids).includes(accountId), mutedKinds: mutedPushKindsForAccount(r, accountId) };
}

/**
 * この公式アカウントの通知設定を保存する(送られた項目だけ)。
 * - accountMuted: このアカウントの通知そのものを止める(muted_account_ids に出し入れする。他のアカウントには影響しない)
 * - mutedKinds: このアカウントで止める種類の全体(初期オフの種類は、一覧に入っていなければ「オンにした」と覚える)
 */
export async function setAppSessionPushForAccount(
  db: D1Database,
  sessionId: string,
  accountId: string,
  change: { accountMuted?: boolean; mutedKinds?: string[] },
): Promise<void> {
  const r = await db
    .prepare('SELECT muted_account_ids, push_by_account FROM app_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ muted_account_ids: string | null; push_by_account: string | null }>();
  if (!r) return;
  let mutedAccounts = parseMutedAccountIds(r.muted_account_ids);
  if (change.accountMuted !== undefined) {
    mutedAccounts = mutedAccounts.filter((x) => x !== accountId);
    if (change.accountMuted) mutedAccounts.push(accountId);
  }
  const byAccount = parsePushByAccount(r.push_by_account);
  if (change.mutedKinds !== undefined) {
    const clean = [...new Set(change.mutedKinds.filter(isAppPushKind))];
    byAccount[accountId] = {
      m: clean.filter((k) => !DEFAULT_OFF_PUSH_KINDS.includes(k)),
      e: DEFAULT_OFF_PUSH_KINDS.filter((k) => !clean.includes(k)),
    };
  }
  await db
    .prepare('UPDATE app_sessions SET muted_account_ids = ?, push_by_account = ? WHERE id = ?')
    .bind(
      mutedAccounts.length ? JSON.stringify(mutedAccounts.slice(0, 200)) : null,
      Object.keys(byAccount).length ? JSON.stringify(byAccount) : null,
      sessionId,
    )
    .run();
}

export async function listAppSessionsForStaff(db: D1Database, staffId: string): Promise<AppSessionRow[]> {
  const r = await db
    .prepare('SELECT id, staff_id, device_name, apns_token, fcm_token, created_at, last_used_at, expires_at, revoked_at FROM app_sessions WHERE staff_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
    .bind(staffId)
    .all<AppSessionRow>();
  return r.results ?? [];
}

// ── ログイン失敗の記録(パスワードの総当たり対策) ───────────────────────────

export async function countRecentLoginFailures(db: D1Database, emailKey: string, withinMinutes: number, now = Date.now()): Promise<number> {
  const since = new Date(now - withinMinutes * 60_000 + 9 * 3600_000).toISOString().replace('Z', '+09:00');
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM app_login_failures WHERE email_key = ? AND created_at >= ?')
    .bind(emailKey, since)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function recordLoginFailure(db: D1Database, emailKey: string, ip: string | null, now = Date.now()): Promise<void> {
  await db.prepare('INSERT INTO app_login_failures (id, email_key, ip, created_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), emailKey, ip, jstNow()).run();
  // 古い記録は消す(1日より前)
  const cutoff = new Date(now - 86_400_000 + 9 * 3600_000).toISOString().replace('Z', '+09:00');
  await db.prepare('DELETE FROM app_login_failures WHERE created_at < ?').bind(cutoff).run();
}

export async function clearLoginFailures(db: D1Database, emailKey: string): Promise<void> {
  await db.prepare('DELETE FROM app_login_failures WHERE email_key = ?').bind(emailKey).run();
}

export { sha256Hex as hashForKey };
