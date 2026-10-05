import type { Context, Next } from 'hono';
import { getStaffByApiKey, getStaffByAppToken } from '@line-crm/db';

/** iOSアプリのトークンの先頭(packages/db の APP_TOKEN_PREFIX と同じ値) */
const APP_TOKEN_PREFIX = 'lhapp_';
import type { Env } from '../index.js';
import type { AdminSameSite } from './admin-auth-config.js';
import { safeDecode } from '../utils/safe-decode.js';
import {
  ADMIN_SESSION_COOKIE,
  externalAuthEnabled,
  resolveExternalStaff,
  verifyAdminSession,
} from '../services/external-auth.js';

export const ADMIN_AUTH_COOKIE = 'lh_admin_session';
export const CSRF_COOKIE = 'lh_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// 7 days, matching the previous localStorage session longevity.
const SESSION_MAX_AGE = 604800;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) continue;
    cookies[rawName] = safeDecode(rawValue.join('=') || '');
  }
  return cookies;
}

function bearerToken(c: Context<Env>): string | null {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length);
}

function cookieToken(c: Context<Env>): string | null {
  return parseCookieHeader(c.req.header('Cookie'))[ADMIN_AUTH_COOKIE] || null;
}

export function csrfTokenFromCookie(c: Context<Env>): string | null {
  return parseCookieHeader(c.req.header('Cookie'))[CSRF_COOKIE] || null;
}

function buildCookie(
  name: string,
  value: string,
  sameSite: AdminSameSite,
  maxAge: number,
  httpOnly: boolean,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (httpOnly) parts.push('HttpOnly');
  parts.push('Secure', `SameSite=${sameSite}`, `Max-Age=${maxAge}`);
  return parts.join('; ');
}

/** HttpOnly session cookie carrying the API token. */
export function adminSessionCookie(token: string, sameSite: AdminSameSite): string {
  return buildCookie(ADMIN_AUTH_COOKIE, token, sameSite, SESSION_MAX_AGE, true);
}

/**
 * CSRF cookie. NOT HttpOnly so it can participate in double-submit, but in a
 * cross-site topology the SPA cannot read it (different registrable domain) —
 * the token is therefore also returned in the login/session response body and
 * the SPA echoes it via the X-CSRF-Token header. The Worker validates that
 * header against this cookie, which the browser does send back to the API
 * (SameSite=None).
 */
export function csrfCookie(token: string, sameSite: AdminSameSite): string {
  return buildCookie(CSRF_COOKIE, token, sameSite, SESSION_MAX_AGE, false);
}

export function expiredCookie(name: string, sameSite: AdminSameSite): string {
  return buildCookie(name, '', sameSite, 0, name === ADMIN_AUTH_COOKIE);
}

export type AuthenticatedStaff = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
  /** beyond admin のログインで入った(ログアウトも beyond admin 側で行う) */
  external?: boolean;
};

/**
 * Resolve a token (from a Bearer header or the session cookie) to a staff
 * identity. Shared by the auth middleware and the /api/auth/login endpoint so
 * cookie and Bearer auth accept exactly the same credentials.
 */
export async function authenticateApiToken(
  c: Context<Env>,
  token: string | null,
): Promise<AuthenticatedStaff | null> {
  if (!token) return null;

  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) {
    return { id: staff.id, name: staff.name, role: staff.role };
  }

  // Fallback: env API_KEY acts as owner (current rotation slot)
  if (token === c.env.API_KEY) {
    return { id: 'env-owner', name: 'Owner', role: 'owner' };
  }

  // Legacy fallback: LEGACY_API_KEY accepted during rotation grace period.
  // Same-value guard: if both env vars are set to the same secret, the primary
  // check above already accepts it; this branch must skip to avoid false
  // LEGACY counters. Logs accept_via=LEGACY_API_KEY so operators can confirm
  // zero legacy usage before deleting the secret.
  if (
    c.env.LEGACY_API_KEY &&
    c.env.LEGACY_API_KEY !== c.env.API_KEY &&
    token === c.env.LEGACY_API_KEY
  ) {
    console.log('[auth] accept_via=LEGACY_API_KEY');
    return { id: 'env-owner', name: 'Owner', role: 'owner' };
  }

  return null;
}

/**
 * beyond admin のログイン(共通の bap_session Cookie)からスタッフを決める。
 * 無効(環境変数なし・Cookieなし・確認できない・停止中)なら null。
 */
async function authenticateExternal(c: Context<Env>): Promise<AuthenticatedStaff | null> {
  if (!externalAuthEnabled(c.env)) return null;
  const sessionId = parseCookieHeader(c.req.header('Cookie'))[ADMIN_SESSION_COOKIE];
  if (!sessionId) return null;
  const profile = await verifyAdminSession(c.env, sessionId);
  if (!profile) return null;
  const member = await resolveExternalStaff(c.env.DB, profile, c.env);
  return member ? { id: member.id, name: member.name, role: member.role, external: true } : null;
}

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  // LIFF / admin の SPA アセットは Authorization ヘッダなしで HTML を取りに
  // くる。Worker は API 以外のパスを ASSETS バインディングから配信するので、
  // /api/ で始まらないパスは認証 skip して static asset として返す。
  // (admin は別ホスト、Worker の non-API path はすべて LIFF/SPA 経由)
  const method = c.req.method.toUpperCase();
  if (!path.startsWith('/api/')) {
    // ただし内部用エンドポイント (/webhook, /auth, /setup) は元の skip 判定に任せる
    if (
      path !== '/webhook' &&
      !path.startsWith('/auth/') &&
      path !== '/setup' &&
      !path.startsWith('/t/') &&
      !path.startsWith('/r/') &&
      !path.startsWith('/pool/') &&
      !path.startsWith('/images/')
    ) {
      return next();
    }
  }

  // A form definition is public because the LIFF client must render it before
  // submission. Authenticate opportunistically so the same GET can still
  // return the full admin representation to SDK/admin callers, while an
  // unauthenticated LIFF caller receives the redacted public representation.
  // Crucially, this exception is method-aware: PUT/DELETE on the same path
  // must continue through the normal admin authentication below.
  const isPublicFormDefinition =
    method === 'GET' && /^\/api\/forms\/[^/]+$/.test(path);
  if (isPublicFormDefinition) {
    const token = bearerToken(c) ?? cookieToken(c);
    const staff = await authenticateApiToken(c, token);
    if (staff) c.set('staff', staff);
    return next();
  }

  // These LIFF actions perform their own LINE ID-token verification inside
  // the route. They cannot use the admin auth gate because their Bearer token
  // is a LINE ID token, not a Harness staff API key.
  const isPublicFormAction =
    method === 'POST' &&
    (/^\/api\/forms\/[^/]+\/submit$/.test(path) ||
      /^\/api\/forms\/[^/]+\/opened$/.test(path) ||
      /^\/api\/forms\/[^/]+\/partial$/.test(path) ||
      /^\/api\/forms\/[^/]+\/upload$/.test(path));
  if (isPublicFormAction) return next();

  if (
    path === '/webhook' ||
    path === '/docs' ||
    // プライバシーポリシー・サポート(App Store 審査用の公開ページ)
    (method === 'GET' && (path === '/privacy' || path === '/support' || path === '/app')) ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/pool/') ||
    path.startsWith('/images/') ||
    // 画像 src として <img> 経由でブラウザが取得するため (Authorization ヘッダ不可)。
    // R2 key 内に group_id / page_id (UUID) が含まれるので推測困難。draft 画像も
    // 最終的に LINE 上で公開されるため機密性は低い。
    path.startsWith('/api/rich-menu-images/') ||
    // LINE 上 rich menu 画像 proxy (Authorization ヘッダなしで <img src> 経由表示)
    path.match(/^\/api\/rich-menu-groups\/external\/[^/]+\/image$/) ||
    path.startsWith('/api/liff/') ||
    // Admin login/logout — issue/clear the session cookie before auth exists.
    path === '/api/auth/login' ||
    // iOSアプリのログイン(メール・パスワード。route 側で総当たり対策あり)
    path === '/api/app/login' ||
    // ログイン画面が、beyond admin のログインを案内するための設定(秘密は含まない)
    path === '/api/auth/config' ||
    path === '/api/auth/logout' ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path === '/api/meet-callback' || // Meet Harness completion callback
    // Google OAuth redirects without admin headers. Route verifies a signed, expiring state.
    (path === '/api/booking/google-calendar/oauth/callback' && method === 'GET') ||
    path === '/api/qr' || // Public QR proxy — used by desktop landing pages
    path === '/api/health' || // Liveness probe (update CLI / self-update verify)
    // Public lead form. Origin validation and field validation happen in-route.
    (path === '/api/public/media-inquiries' && method === 'POST')
  ) {
    return next();
  }

  const bearer = bearerToken(c);
  const cookie = cookieToken(c);
  const token = bearer ?? cookie;

  // iOSアプリのトークン(Authorization ヘッダだけ。Cookie では受け付けない)
  let staff: AuthenticatedStaff | null = null;
  if (bearer && bearer.startsWith(APP_TOKEN_PREFIX)) {
    const found = await getStaffByAppToken(c.env.DB, bearer);
    if (found) {
      staff = { id: found.staff.id, name: found.staff.name, role: found.staff.role, external: !!found.staff.external_id };
      c.set('appSessionId', found.sessionId);
    }
  } else {
    staff = await authenticateApiToken(c, token);
  }
  // beyond admin のログイン(Authorization ヘッダの API キーが無いときだけ)
  let viaExternal = false;
  if (!staff && !bearer) {
    staff = await authenticateExternal(c);
    viaExternal = !!staff;
  }
  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  // CSRF protection applies ONLY to cookie-authenticated, state-changing
  // requests. Bearer callers (SDK/MCP) cannot be driven cross-site by a
  // browser (an attacker cannot set the Authorization header), so they are
  // exempt. Safe methods (GET/HEAD/OPTIONS) never mutate, so they are exempt.
  if (!bearer && (cookie || viaExternal) && !SAFE_METHODS.has(c.req.method.toUpperCase())) {
    const header = c.req.header(CSRF_HEADER);
    const expected = csrfTokenFromCookie(c);
    if (!header || !expected || header !== expected) {
      return c.json({ success: false, error: 'CSRF token mismatch' }, 403);
    }
  }

  c.set('staff', staff);
  return next();
}
