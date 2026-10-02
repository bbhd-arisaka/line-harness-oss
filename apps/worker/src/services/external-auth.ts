import { upsertExternalStaff } from '@line-crm/db';
import type { StaffMember } from '@line-crm/db';

/**
 * beyond admin のログインで beyond line に入る(ID・パスワードのログイン)。
 *
 * beyond admin(親)でメールアドレスとパスワードでログインすると、`.cms-manager.jp` 全体に
 * セッション Cookie(bap_session)が付く。beyond line の Worker は、その Cookie の値を beyond admin の
 * `/api/internal/session`(子ツール用の確認口)に問い合わせ、有効なら、その利用者をスタッフとして扱う。
 * パスワードは beyond line には一切届かない。ユーザーの追加・停止・パスワード再設定は beyond admin で行う。
 *
 * 環境変数が無ければ、この仕組みは完全に無効(従来の API キーのログインだけ)。
 * 確認が失敗・タイムアウトしたときは、ログインさせない(安全側)。
 */

export const ADMIN_SESSION_COOKIE = 'bap_session';
const TOOL_KEY = 'line';
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;
const REQUEST_TIMEOUT_MS = 5_000;

export interface ExternalAuthEnv {
  /** beyond admin の URL(例: https://beyond-admin.cms-manager.jp) */
  BEYOND_ADMIN_URL?: string;
  /** beyond admin 側の INTERNAL_TOKEN_LINE と同じ値(Secret) */
  BEYOND_ADMIN_INTERNAL_TOKEN?: string;
  /** 入れてよい会社(テナント)ID。カンマ区切り。空なら、beyond line の契約がある会社すべて */
  BEYOND_ADMIN_ALLOWED_TENANT_IDS?: string;
}

export interface ExternalProfile {
  userId: string;
  tenantId: string;
  tenantName: string | null;
  name: string;
  email: string | null;
  role: 'owner' | 'manager' | 'staff';
}

export const ROLE_MAP: Record<ExternalProfile['role'], 'owner' | 'admin' | 'staff'> = {
  owner: 'owner',
  manager: 'admin',
  staff: 'staff',
};

export function externalAuthEnabled(env: ExternalAuthEnv): boolean {
  return !!(env.BEYOND_ADMIN_URL?.trim() && env.BEYOND_ADMIN_INTERNAL_TOKEN?.trim());
}

function baseUrl(env: ExternalAuthEnv): string {
  return (env.BEYOND_ADMIN_URL ?? '').trim().replace(/\/+$/, '');
}

/** 画面(ログイン画面)が使う、beyond admin のログイン・ログアウトの URL。無効なら null。 */
export function externalAuthLinks(env: ExternalAuthEnv): { loginUrl: string; logoutUrl: string } | null {
  if (!externalAuthEnabled(env)) return null;
  const base = baseUrl(env);
  return { loginUrl: `${base}/login`, logoutUrl: `${base}/logout` };
}

interface CacheEntry { profile: ExternalProfile | null; expires: number }
const cache = new Map<string, CacheEntry>();

/** テスト用 */
export function clearExternalAuthCache(): void {
  cache.clear();
}

function parseProfile(x: unknown): ExternalProfile | null {
  const v = x as Record<string, unknown> | null;
  if (!v || v.valid !== true) return null;
  if (typeof v.userId !== 'string' || !v.userId || typeof v.tenantId !== 'string' || !v.tenantId) return null;
  if (v.role !== 'owner' && v.role !== 'manager' && v.role !== 'staff') return null;
  return {
    userId: v.userId,
    tenantId: v.tenantId,
    tenantName: typeof v.tenantName === 'string' ? v.tenantName : null,
    name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : '(名前なし)',
    email: typeof v.email === 'string' && v.email ? v.email : null,
    role: v.role,
  };
}

/**
 * beyond admin に、セッションが有効か確認する。有効なら利用者の情報、無効・失敗なら null。
 * 結果は1分だけ覚える(ページを開くたびに問い合わせないため。停止の反映は最大1分遅れる)。
 */
export async function verifyAdminSession(
  env: ExternalAuthEnv,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<ExternalProfile | null> {
  if (!externalAuthEnabled(env) || !sessionId || sessionId.length > 200) return null;

  const hit = cache.get(sessionId);
  if (hit && hit.expires > now) return hit.profile;

  let profile: ExternalProfile | null = null;
  try {
    const res = await fetchImpl(`${baseUrl(env)}/api/internal/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': (env.BEYOND_ADMIN_INTERNAL_TOKEN ?? '').trim() },
      body: JSON.stringify({ sessionId, toolKey: TOOL_KEY }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 確認の口そのものが拒否した(合言葉が違うなど)ときは、設定の誤りなので記録だけ残す。覚えない
      console.error(`[external-auth] session check failed: HTTP ${res.status}`);
      return null;
    }
    profile = parseProfile(await res.json().catch(() => null));
  } catch (err) {
    console.error('[external-auth] session check error:', err instanceof Error ? err.message : err);
    return null;
  }

  if (profile) {
    const allowed = (env.BEYOND_ADMIN_ALLOWED_TENANT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(profile.tenantId)) profile = null;
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(sessionId, { profile, expires: now + CACHE_TTL_MS });
  return profile;
}

/** 確認できた利用者を、スタッフとして作る/更新する(停止されている人は null) */
export async function resolveExternalStaff(db: D1Database, profile: ExternalProfile): Promise<StaffMember | null> {
  const member = await upsertExternalStaff(db, {
    externalId: profile.userId,
    tenantId: profile.tenantId,
    name: profile.name,
    email: profile.email,
    role: ROLE_MAP[profile.role],
  });
  return member.is_active ? member : null;
}
