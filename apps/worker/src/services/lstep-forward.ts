/**
 * Lステップとの並行運用: LINEから届いた Webhook を、そのまま(1バイトも変えずに)Lステップにも転送する。
 *
 * - LINE の Webhook URL は1か所にしか登録できない。beyond line を受け口にして、Lステップへ転送する。
 * - Lステップが「本番」。転送先の応答(ステータス)を、そのまま LINE に返す(Lステップが失敗したら LINE に再送してもらえる)。
 * - 署名(x-line-signature)は、チャネルシークレットでの HMAC。本文をそのまま転送するので、Lステップ側の検証も通る。
 * - 並行運用中のアカウントは、beyond line からの自動送信(自動応答・あいさつ等)をしない(二重送信を防ぐ)。
 */

const FORWARD_TIMEOUT_MS = 8_000;

/** 転送先として許すのは、Lステップの受信URL(https の linestep.net 配下)だけ(任意のURLへ転送させない) */
export function validateLstepForwardUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: '転送先のURLを入れてください' };
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'URLの形が正しくありません' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'https:// から始まるURLを入れてください' };
  const host = u.hostname.toLowerCase();
  if (host !== 'linestep.net' && !host.endsWith('.linestep.net')) {
    return { ok: false, error: 'Lステップの受信URL(rcv.linestep.net など)を入れてください' };
  }
  if (u.username || u.password) return { ok: false, error: 'URLに、ユーザー名・パスワードは入れられません' };
  return { ok: true, url: u.toString() };
}

export type ForwardResult = { ok: true; status: number } | { ok: false; error: string };

export async function forwardWebhookToLstep(
  url: string,
  rawBody: string,
  signature: string,
  contentType: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = FORWARD_TIMEOUT_MS,
): Promise<ForwardResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType || 'application/json', 'x-line-signature': signature },
      body: rawBody,
      signal: ctl.signal,
    });
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error' };
  } finally {
    clearTimeout(timer);
  }
}

/** LINE に返すステータス。Lステップが応答したらそのステータス、届かなかったら 502(LINE に再送してもらう) */
export function statusForLine(result: ForwardResult): number {
  return result.ok ? result.status : 502;
}
