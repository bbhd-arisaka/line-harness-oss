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
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND m.is_active = 1`,
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

export async function listAppSessionsForStaff(db: D1Database, staffId: string): Promise<AppSessionRow[]> {
  const r = await db
    .prepare('SELECT id, staff_id, device_name, apns_token, created_at, last_used_at, expires_at, revoked_at FROM app_sessions WHERE staff_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
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
