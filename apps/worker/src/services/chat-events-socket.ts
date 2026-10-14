import { getStaffAllowedAccountIds } from '@line-crm/db';
import { authenticateRequest } from '../middleware/auth.js';
import { resolveCorsOrigin } from '../middleware/admin-auth-config.js';
import { ALLOWED_ACCOUNTS_HEADER, CHAT_EVENTS_INSTANCE_NAME, encodeAllowed } from '../durable-objects/chat-events.js';
import type { Env } from '../index.js';

/** 管理画面が、トークの新着の合図(WebSocket)を受け取るための接続口のパス */
export const CHAT_EVENTS_PATH = '/api/chat-events';

export function isChatEventsUpgrade(request: Request): boolean {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return false;
  try {
    return new URL(request.url).pathname === CHAT_EVENTS_PATH;
  } catch {
    return false;
  }
}

function deny(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
}

/**
 * WebSocket の接続を受け付ける(Hono の外で処理する。WebSocket の応答は、あとからヘッダーを足せないため)。
 * - 許可した管理画面の Origin からだけ(Cookie を使うので、他のサイトから勝手につなげないようにする)
 * - ログイン済みのスタッフだけ。見てよい公式アカウントを DO に渡して、制限のあるスタッフには、見てよい分の合図だけを送る
 */
export async function handleChatEventsUpgrade(request: Request, env: Env['Bindings']): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (origin && resolveCorsOrigin(env, origin, request.url) !== origin) return deny(403, 'Origin not allowed');

  const staff = await authenticateRequest(request, env);
  if (!staff) return deny(401, 'Unauthorized');

  const ns = env.CHAT_EVENTS;
  if (!ns) return deny(503, 'Chat events unavailable');

  const allowed = staff.role === 'owner' || staff.id === 'env-owner' ? null : await getStaffAllowedAccountIds(env.DB, staff.id);
  const headers = new Headers(request.headers);
  headers.set(ALLOWED_ACCOUNTS_HEADER, encodeAllowed(allowed)); // 画面から送られた値は上書きする
  const stub = ns.get(ns.idFromName(CHAT_EVENTS_INSTANCE_NAME));
  return stub.fetch(new Request(request, { headers }));
}
