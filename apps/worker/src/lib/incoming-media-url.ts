// お客様から届いた画像・動画・音声・ファイルを開くための、期限つきの署名つきURL。
// 保存先(R2)の `incoming-` で始まるファイルは、公開せず、スタッフ向けのAPI(トークの取得)が発行した署名つきURLでだけ開ける。
// 署名は、ファイル名と有効期限に対する HMAC。URLを知っていても、期限が切れたら開けない。

export const INCOMING_KEY_PREFIX = 'incoming-';
/** 署名つきURLの有効期限は、6時間ごとの区切りにそろえる(6〜12時間有効)。同じ区切りの間はURLが変わらないので、アプリが画像を取り直さない */
export const INCOMING_URL_WINDOW_SECONDS = 6 * 60 * 60;

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'file']);
const URL_FIELDS = ['originalContentUrl', 'previewImageUrl', 'url'] as const;
const INCOMING_PATH_RE = /\/images\/(incoming-[A-Za-z0-9._-]+)$/;

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

export async function signIncomingKey(secret: string, key: string, exp: number): Promise<string> {
  return hmac(secret, `incoming-media:${key}:${exp}`);
}

export async function verifyIncomingKey(secret: string, key: string, expRaw: string | undefined, sig: string | undefined, nowSeconds: number): Promise<boolean> {
  if (!secret || !expRaw || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < nowSeconds) return false;
  const expected = await signIncomingKey(secret, key, exp);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/**
 * お客様からのメッセージ(画像・動画・音声・ファイル)の content にある、保存先のURLに署名をつける。
 * 対象外のメッセージ・JSON でない content・保存先以外のURLは、そのまま返す。
 */
export async function signIncomingMessageContent(
  secret: string,
  m: { direction: unknown; messageType: unknown; content: unknown },
  nowMs: number = Date.now(),
): Promise<unknown> {
  if (!secret || m.direction !== 'incoming' || typeof m.messageType !== 'string' || !MEDIA_TYPES.has(m.messageType) || typeof m.content !== 'string') return m.content;
  let parsed: Record<string, unknown>;
  try {
    const v = JSON.parse(m.content) as unknown;
    if (!v || typeof v !== 'object') return m.content;
    parsed = v as Record<string, unknown>;
  } catch {
    return m.content;
  }
  const exp = (Math.floor(nowMs / 1000 / INCOMING_URL_WINDOW_SECONDS) + 2) * INCOMING_URL_WINDOW_SECONDS;
  let changed = false;
  for (const field of URL_FIELDS) {
    const value = parsed[field];
    if (typeof value !== 'string') continue;
    const base = value.split('?')[0];
    const match = INCOMING_PATH_RE.exec(base);
    if (!match) continue;
    const sig = await signIncomingKey(secret, match[1], exp);
    parsed[field] = `${base}?exp=${exp}&sig=${sig}`;
    changed = true;
  }
  return changed ? JSON.stringify(parsed) : m.content;
}
