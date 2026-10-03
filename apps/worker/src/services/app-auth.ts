import type { ExternalAuthEnv, ExternalProfile } from './external-auth.js';
import { externalAuthEnabled } from './external-auth.js';

/**
 * iOSアプリのログイン: beyond admin のメールアドレス・パスワードを、beyond admin に照合してもらう
 * (`/api/internal/auth/verify`)。パスワードは beyond line には保存しない(照合のために一度通るだけ)。
 */

export type CredentialResult =
  | { ok: true; profile: ExternalProfile }
  | { ok: false; status: 401 | 403 | 502 | 503; message: string };

const TIMEOUT_MS = 8_000;

export async function verifyAdminCredentials(
  env: ExternalAuthEnv,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CredentialResult> {
  if (!externalAuthEnabled(env)) {
    return { ok: false, status: 503, message: 'ログイン連携が有効になっていません。管理者に連絡してください。' };
  }
  const base = (env.BEYOND_ADMIN_URL ?? '').trim().replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/internal/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(env.BEYOND_ADMIN_INTERNAL_TOKEN ?? '').trim()}` },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[app-auth] verify error:', err instanceof Error ? err.message : err);
    return { ok: false, status: 502, message: 'beyond admin に接続できませんでした。しばらくしてから、もう一度お試しください。' };
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  // beyond admin は、パスワード違いを 401 + 理由(日本語)で返す。合言葉の誤りは 401 + reason=unauthorized
  if (res.status === 401 && body && body.reason !== 'unauthorized') {
    return { ok: false, status: 401, message: 'メールアドレスまたはパスワードが違います' };
  }
  if (res.status === 403) {
    // 契約が無い・お支払いが確認できない、など。beyond admin が返す理由をそのまま見せる
    return { ok: false, status: 403, message: typeof body?.reason === 'string' ? body.reason : 'この会社は beyond line を利用できません' };
  }
  if (!res.ok || !body || body.ok !== true) {
    // 合言葉の誤りなど、こちらの設定の問題。利用者には詳細を見せない
    console.error(`[app-auth] verify failed: HTTP ${res.status}`);
    return { ok: false, status: 502, message: 'ログインを確認できませんでした。管理者に連絡してください。' };
  }

  const role = body.role;
  if (typeof body.userId !== 'string' || typeof body.tenantId !== 'string' || (role !== 'owner' && role !== 'manager' && role !== 'staff')) {
    return { ok: false, status: 502, message: 'ログインを確認できませんでした。管理者に連絡してください。' };
  }
  return {
    ok: true,
    profile: {
      userId: body.userId,
      tenantId: body.tenantId,
      tenantName: null,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '(名前なし)',
      email: typeof body.email === 'string' ? body.email : email,
      role,
    },
  };
}
