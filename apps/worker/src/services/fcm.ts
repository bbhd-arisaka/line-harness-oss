/**
 * Android アプリ向けのプッシュ通知(FCM HTTP v1)の送信。
 *
 * - FCM_PROJECT_ID / FCM_SERVICE_ACCOUNT_EMAIL / FCM_SERVICE_ACCOUNT_PRIVATE_KEY が全部そろったときだけ有効。無ければ何もしない。
 * - 認証はサービスアカウントの OAuth トークン(google-service-account.ts。1時間キャッシュ)。
 * - 秘密(鍵・トークン)は、ログにもエラー文にも出さない。
 * - 例外は投げない(通知の失敗で Webhook を止めないため)。
 * - 通知の中身は iOS(APNs)と同じ。開き先(chatId・accountId・friendId)は data に入れる。
 */
import { getGoogleServiceAccountToken } from './google-service-account.js';

export interface FcmEnv {
  FCM_PROJECT_ID?: string;
  FCM_SERVICE_ACCOUNT_EMAIL?: string;
  FCM_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
}

export interface FcmConfig {
  projectId: string;
  email: string;
  privateKey: string;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Android の通知チャンネル(アプリ側 src/state/push.tsx と同じ ID) */
export const ANDROID_CHANNEL_ID = 'messages';
const TTL_SECONDS = 60 * 60;

export function getFcmConfig(env: FcmEnv): FcmConfig | null {
  const projectId = env.FCM_PROJECT_ID?.trim();
  const email = env.FCM_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (!projectId || !email || !privateKey) return null;
  return { projectId, email, privateKey };
}

export interface FcmAlert {
  title: string;
  subtitle?: string;
  body: string;
  /** 同じ値の通知は1つにまとめられる(チャットごと) */
  collapseId: string;
  data?: Record<string, string | null>;
}

export interface FcmSendResult {
  ok: boolean;
  status: number;
  reason?: string;
  /** その端末トークンはもう使えない(404 UNREGISTERED / 400 INVALID_ARGUMENT) */
  invalidToken: boolean;
}

export interface FcmSendOptions {
  fetchImpl?: typeof fetch;
  getAccessToken?: (config: FcmConfig) => Promise<string>;
}

/** FCM の data は文字列だけ。null は入れない */
export function buildFcmMessage(deviceToken: string, alert: FcmAlert): { message: Record<string, unknown> } {
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(alert.data ?? {})) if (typeof v === 'string' && v) data[k] = v;
  return {
    message: {
      token: deviceToken,
      // 通知の見た目は OS が出す(アプリが閉じていても届く)。タイトルの下の小さい行は、iOS と同じく公式アカウント名
      notification: { title: alert.title.slice(0, 100), body: alert.subtitle ? `${alert.subtitle}\n${alert.body}` : alert.body },
      data,
      android: {
        priority: 'HIGH',
        ttl: `${TTL_SECONDS}s`,
        collapse_key: alert.collapseId.slice(0, 64),
        notification: { channel_id: ANDROID_CHANNEL_ID, tag: alert.collapseId.slice(0, 64), sound: 'default' },
      },
    },
  };
}

function maskToken(token: string): string {
  return token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : '****';
}

/** 1台に送る。例外は投げない */
export async function sendFcmAlert(
  config: FcmConfig,
  deviceToken: string,
  alert: FcmAlert,
  options: FcmSendOptions = {},
): Promise<FcmSendResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let accessToken: string;
  try {
    accessToken = await (options.getAccessToken ?? ((c) => getGoogleServiceAccountToken({ email: c.email, privateKey: c.privateKey }, FCM_SCOPE)))(config);
  } catch (err) {
    console.error('[fcm] アクセストークンを作れません(FCM_SERVICE_ACCOUNT_* を確認してください)', err instanceof Error ? err.message.slice(0, 80) : 'error');
    return { ok: false, status: 0, reason: 'auth_error', invalidToken: false };
  }

  try {
    const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildFcmMessage(deviceToken, alert)),
    });
    if (res.ok) return { ok: true, status: res.status, invalidToken: false };

    let reason: string | undefined;
    try {
      const j = (await res.json()) as { error?: { status?: unknown; details?: Array<{ errorCode?: unknown }> } };
      const code = j.error?.details?.find((d) => typeof d.errorCode === 'string')?.errorCode;
      reason = typeof code === 'string' ? code : typeof j.error?.status === 'string' ? j.error.status : undefined;
    } catch {
      // 本文なし
    }
    const invalidToken = res.status === 404 || reason === 'UNREGISTERED';
    if (invalidToken) {
      console.log(`[fcm] 端末トークンが無効です token=${maskToken(deviceToken)} status=${res.status} reason=${reason ?? '-'}`);
    } else {
      console.error(`[fcm] 送信に失敗 status=${res.status} reason=${reason ?? '-'} token=${maskToken(deviceToken)}`);
    }
    return { ok: false, status: res.status, reason, invalidToken };
  } catch (err) {
    console.error('[fcm] 通信エラー', err instanceof Error ? err.name : 'error');
    return { ok: false, status: 0, reason: 'network_error', invalidToken: false };
  }
}

/** 無効になった端末トークンを、セッションから消す */
export async function clearInvalidFcmToken(db: D1Database, deviceToken: string): Promise<void> {
  try {
    await db.prepare('UPDATE app_sessions SET fcm_token = NULL WHERE fcm_token = ?').bind(deviceToken).run();
  } catch (err) {
    console.error('[fcm] 無効トークンの削除に失敗', err instanceof Error ? err.message : 'error');
  }
}
