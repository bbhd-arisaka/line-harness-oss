import { Hono } from 'hono';
import {
  clearLoginFailures,
  APP_PUSH_KINDS,
  getAppSessionMutedAccounts,
  getAppSessionMutedKinds,
  isAppPushKind,
  countRecentLoginFailures,
  createAppSession,
  hashForKey,
  recordLoginFailure,
  requestStaffDeletion,
  revokeAppSession,
  setAppSessionApnsToken,
  setAppSessionMutedAccounts,
  setAppSessionMutedKinds,
} from '@line-crm/db';
import { verifyAdminCredentials } from '../services/app-auth.js';
import { isTenantPermitted, resolveExternalStaff } from '../services/external-auth.js';
import type { Env } from '../index.js';

/**
 * iOSアプリ用のログイン。
 *  POST /api/app/login   メール・パスワード → アプリ用トークン(端末ごと・90日・取り消し可能)
 *  POST /api/app/logout  この端末のトークンを取り消す
 *  PUT  /api/app/device  プッシュ通知(APNs)の送り先を登録する
 *  GET/PUT /api/app/push-settings  この端末の通知設定: 止める公式アカウント・止める種類(新着メッセージ/フォームの回答)。アプリの設定画面だけで完結する
 *  POST /api/app/account-deletion  アカウント削除の申請(App Store の要件)。全端末からログアウトされ、以後入れなくなる
 * トークンは Authorization: Bearer で使う(Cookie ではないので、CSRF の対象外)。
 */
export const appAuth = new Hono<Env>();

const MAX_FAILURES = 8;
const FAILURE_WINDOW_MIN = 15;

appAuth.post('/api/app/login', async (c) => {
  const body = await c.req.json<{ email?: unknown; password?: unknown; deviceName?: unknown }>().catch(() => ({}) as Record<string, unknown>);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 254 || !password || password.length > 200) {
    return c.json({ success: false, error: 'メールアドレスとパスワードを入力してください' }, 400);
  }

  const emailKey = await hashForKey(email);
  const ip = c.req.header('cf-connecting-ip') ?? null;
  if ((await countRecentLoginFailures(c.env.DB, emailKey, FAILURE_WINDOW_MIN)) >= MAX_FAILURES) {
    return c.json({ success: false, error: `ログインに何度も失敗したため、${FAILURE_WINDOW_MIN}分ほど待ってからお試しください` }, 429);
  }

  const result = await verifyAdminCredentials(c.env, email, password);
  if (!result.ok) {
    if (result.status === 401) await recordLoginFailure(c.env.DB, emailKey, ip);
    return c.json({ success: false, error: result.message }, result.status);
  }

  if (!(await isTenantPermitted(c.env.DB, c.env, result.profile.tenantId))) {
    return c.json({ success: false, error: 'この会社は beyond line を利用できません' }, 403);
  }

  const staff = await resolveExternalStaff(c.env.DB, result.profile, c.env);
  if (!staff) {
    return c.json({ success: false, error: 'このユーザーは停止されています。管理者に連絡してください' }, 403);
  }

  await clearLoginFailures(c.env.DB, emailKey);
  const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim() : null;
  const session = await createAppSession(c.env.DB, staff.id, deviceName || null);
  return c.json({
    success: true,
    data: {
      token: session.token,
      expiresAt: session.expiresAt,
      staff: { id: staff.id, name: staff.name, email: staff.email, role: staff.role },
    },
  });
});

appAuth.post('/api/app/logout', async (c) => {
  const sessionId = c.get('appSessionId');
  if (!sessionId) return c.json({ success: false, error: 'アプリのログインで呼び出してください' }, 400);
  await revokeAppSession(c.env.DB, sessionId);
  return c.json({ success: true, data: null });
});

appAuth.put('/api/app/device', async (c) => {
  const sessionId = c.get('appSessionId');
  if (!sessionId) return c.json({ success: false, error: 'アプリのログインで呼び出してください' }, 400);
  const body = await c.req.json<{ apnsToken?: unknown }>().catch(() => ({}) as { apnsToken?: unknown });
  const token = body.apnsToken;
  if (token !== null && (typeof token !== 'string' || !/^[0-9a-fA-F]{32,200}$/.test(token))) {
    return c.json({ success: false, error: 'apnsToken が正しくありません' }, 400);
  }
  await setAppSessionApnsToken(c.env.DB, sessionId, token as string | null);
  return c.json({ success: true, data: null });
});

// この端末の通知設定(止めている公式アカウント・止めている通知の種類)。端末ごとに持つ。
// PUT は、送られた項目だけを更新する(古いアプリが mutedAccountIds だけ送っても、種類の設定は消えない)
async function pushSettingsOf(db: D1Database, sessionId: string) {
  return {
    mutedAccountIds: await getAppSessionMutedAccounts(db, sessionId),
    mutedKinds: await getAppSessionMutedKinds(db, sessionId),
    kinds: APP_PUSH_KINDS.map((k) => ({ key: k.key, label: k.label, description: k.description })),
  };
}

appAuth.get('/api/app/push-settings', async (c) => {
  const sessionId = c.get('appSessionId');
  if (!sessionId) return c.json({ success: false, error: 'アプリのログインで呼び出してください' }, 400);
  return c.json({ success: true, data: await pushSettingsOf(c.env.DB, sessionId) });
});

appAuth.put('/api/app/push-settings', async (c) => {
  const sessionId = c.get('appSessionId');
  if (!sessionId) return c.json({ success: false, error: 'アプリのログインで呼び出してください' }, 400);
  const body = await c.req.json<{ mutedAccountIds?: unknown; mutedKinds?: unknown }>().catch(() => ({}) as { mutedAccountIds?: unknown; mutedKinds?: unknown });
  const ids = body.mutedAccountIds;
  const kinds = body.mutedKinds;
  if (ids === undefined && kinds === undefined) {
    return c.json({ success: false, error: '変更する項目(mutedAccountIds か mutedKinds)を送ってください' }, 400);
  }
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 200 || ids.some((x) => typeof x !== 'string' || !x || x.length > 64))) {
    return c.json({ success: false, error: 'mutedAccountIds が正しくありません' }, 400);
  }
  if (kinds !== undefined && (!Array.isArray(kinds) || kinds.length > 20 || kinds.some((x) => !isAppPushKind(x)))) {
    return c.json({ success: false, error: 'mutedKinds が正しくありません' }, 400);
  }
  if (ids !== undefined) await setAppSessionMutedAccounts(c.env.DB, sessionId, ids as string[]);
  if (kinds !== undefined) await setAppSessionMutedKinds(c.env.DB, sessionId, kinds as string[]);
  return c.json({ success: true, data: await pushSettingsOf(c.env.DB, sessionId) });
});

// アカウント削除の申請。ユーザー本体は beyond admin にあるため、ここでは「その場で入れなくする」ことと
// 「申請の記録(スタッフ管理に表示)」までを行い、実際の削除はオーナーが beyond admin で行う。
appAuth.post('/api/app/account-deletion', async (c) => {
  const sessionId = c.get('appSessionId');
  const staff = c.get('staff');
  if (!sessionId || !staff) return c.json({ success: false, error: 'アプリのログインで呼び出してください' }, 400);
  if (staff.role === 'owner') {
    // オーナーが自分を消すと、誰も管理できなくなる恐れがある。別のオーナーに依頼してもらう
    return c.json({ success: false, error: 'オーナーのアカウントは、アプリからは削除を申請できません。beyond admin の管理画面から、または別のオーナーに依頼してください' }, 403);
  }
  await requestStaffDeletion(c.env.DB, staff.id);
  return c.json({ success: true, data: null });
});
