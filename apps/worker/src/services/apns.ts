/**
 * iOS アプリ向けのプッシュ通知(APNs)の送信。
 *
 * - APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID が全部そろったときだけ有効。無ければ何もしない。
 * - 認証は ES256 の JWT(WebCrypto)。Apple は 20〜60 分で更新を求めるので、50 分キャッシュする。
 * - 秘密(P8・JWT)は、ログにもエラー文にも出さない。
 * - 例外は投げない(通知の失敗で、呼び出し元=Webhook を止めないため)。結果は戻り値とログで返す。
 */

export interface ApnsEnv {
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  APNS_ENVIRONMENT?: string;
}

export interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  environment: 'production' | 'sandbox';
}

export const DEFAULT_APNS_BUNDLE_ID = 'jp.cms-manager.beyondline';
const JWT_TTL_MS = 50 * 60_000;
const EXPIRATION_SECONDS = 60 * 60;
const MAX_PAYLOAD_BYTES = 4096;

/** 環境変数から設定を作る。3つ(鍵・キーID・チームID)がそろわなければ null(=無効) */
export function getApnsConfig(env: ApnsEnv): ApnsConfig | null {
  const keyP8 = env.APNS_KEY_P8?.trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  if (!keyP8 || !keyId || !teamId) return null;
  return {
    keyP8,
    keyId,
    teamId,
    bundleId: env.APNS_BUNDLE_ID?.trim() || DEFAULT_APNS_BUNDLE_ID,
    environment: env.APNS_ENVIRONMENT?.trim() === 'sandbox' ? 'sandbox' : 'production',
  };
}

// ── JWT ──────────────────────────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const textB64url = (text: string) => base64url(new TextEncoder().encode(text));

function pemToPkcs8(pem: string): Uint8Array {
  // 環境変数に入れるとき改行が「\n」(文字)になっていても読めるようにする
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ES256 の JWT を作る(署名は DER ではなく IEEE-P1363 のまま = JOSE 形式) */
export async function createApnsJwt(config: Pick<ApnsConfig, 'keyP8' | 'keyId' | 'teamId'>, nowMs: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(config.keyP8),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = textB64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const claims = textB64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(nowMs / 1000) }));
  const signingInput = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(sig))}`;
}

let jwtCache: { cacheKey: string; jwt: string; issuedAt: number } | null = null;

/** テスト用: JWT のキャッシュを捨てる */
export function resetApnsJwtCache(): void {
  jwtCache = null;
}

async function getJwt(config: ApnsConfig, nowMs: number): Promise<string> {
  // 鍵の中身そのものはキーに使わない(長さと ID だけで区別する。同じ ID で鍵を差し替えたら、50分以内でも古い署名が残り得るが、再デプロイで isolate が替わる)
  const cacheKey = `${config.teamId}:${config.keyId}:${config.keyP8.length}`;
  if (jwtCache && jwtCache.cacheKey === cacheKey && nowMs - jwtCache.issuedAt < JWT_TTL_MS) return jwtCache.jwt;
  const jwt = await createApnsJwt(config, nowMs);
  jwtCache = { cacheKey, jwt, issuedAt: nowMs };
  return jwt;
}

// ── 送信 ─────────────────────────────────────────────────────────────────────

export interface ApnsAlert {
  title: string;
  /** タイトルの下に出る小さい行(どの公式アカウントの通知か) */
  subtitle?: string;
  body: string;
  /** 通知のスレッド(同じ友だちの通知をまとめて表示)。友だちID */
  threadId: string;
  /** 同じ値の通知は1つにまとめられる(チャットごと)。64バイトまで */
  collapseId: string;
  /** アプリが開き先を決めるためのカスタムキー(chatId・accountId など) */
  data?: Record<string, string | null>;
}

export interface ApnsSendResult {
  ok: boolean;
  /** HTTP ステータス(通信できなかったときは 0) */
  status: number;
  reason?: string;
  /** その端末トークンはもう使えない(410 / BadDeviceToken / Unregistered) */
  invalidToken: boolean;
}

export interface ApnsSendOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** 本文(JSON)を作る。4KB を超えるときは、本文を切って収める */
export function buildApnsPayload(alert: ApnsAlert): string {
  let body = alert.body;
  const build = (b: string) =>
    JSON.stringify({
      aps: {
        alert: { title: alert.title.slice(0, 100), ...(alert.subtitle ? { subtitle: alert.subtitle.slice(0, 100) } : {}), body: b },
        sound: 'default',
        'thread-id': alert.threadId,
      },
      ...(alert.data ?? {}),
      // expo-notifications は、バージョン・状況によって、カスタムキーを body の中から読む。どちらでも開き先が分かるように、同じ内容を body にも入れる
      ...(alert.data ? { body: alert.data } : {}),
    });
  let json = build(body);
  while (utf8Length(json) > MAX_PAYLOAD_BYTES && body.length > 0) {
    body = body.slice(0, Math.max(0, Math.floor(body.length * 0.8) - 1));
    json = build(body);
  }
  return json;
}

function truncateBytes(s: string, maxBytes: number): string {
  let out = s;
  while (utf8Length(out) > maxBytes) out = out.slice(0, -1);
  return out;
}

const INVALID_REASONS = new Set(['BadDeviceToken', 'Unregistered']);

function maskToken(token: string): string {
  return token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : '****';
}

/** 1台に送る。例外は投げない */
export async function sendApnsAlert(
  config: ApnsConfig,
  deviceToken: string,
  alert: ApnsAlert,
  options: ApnsSendOptions = {},
): Promise<ApnsSendResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = (options.now ?? Date.now)();
  let jwt: string;
  try {
    jwt = await getJwt(config, nowMs);
  } catch (err) {
    // 鍵の形式が違う等。鍵の中身は出さない
    console.error('[apns] JWT を作れません(APNS_KEY_P8 の形式を確認してください)', err instanceof Error ? err.name : 'error');
    return { ok: false, status: 0, reason: 'jwt_error', invalidToken: false };
  }

  const host = config.environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  try {
    const res = await fetchImpl(`https://${host}/3/device/${encodeURIComponent(deviceToken)}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': config.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(nowMs / 1000) + EXPIRATION_SECONDS),
        'apns-collapse-id': truncateBytes(alert.collapseId, 64),
        'content-type': 'application/json',
      },
      body: buildApnsPayload(alert),
    });
    if (res.status === 200) return { ok: true, status: 200, invalidToken: false };

    let reason: string | undefined;
    try {
      const j = (await res.json()) as { reason?: unknown };
      if (typeof j.reason === 'string') reason = j.reason;
    } catch {
      // 本文なし
    }
    const invalidToken = res.status === 410 || (reason !== undefined && INVALID_REASONS.has(reason));
    if (invalidToken) {
      console.log(`[apns] 端末トークンが無効です token=${maskToken(deviceToken)} status=${res.status} reason=${reason ?? '-'}`);
    } else {
      // 429 / 5xx などは再試行しない(次の通知で送る)
      console.error(`[apns] 送信に失敗 status=${res.status} reason=${reason ?? '-'} token=${maskToken(deviceToken)}`);
    }
    return { ok: false, status: res.status, reason, invalidToken };
  } catch (err) {
    console.error('[apns] 通信エラー', err instanceof Error ? err.name : 'error');
    return { ok: false, status: 0, reason: 'network_error', invalidToken: false };
  }
}

/** 無効になった端末トークンを、セッションから消す */
export async function clearInvalidApnsToken(db: D1Database, deviceToken: string): Promise<void> {
  try {
    await db.prepare('UPDATE app_sessions SET apns_token = NULL WHERE apns_token = ?').bind(deviceToken).run();
  } catch (err) {
    console.error('[apns] 無効トークンの削除に失敗', err instanceof Error ? err.message : 'error');
  }
}
