/**
 * トークの新着を、開いている管理画面(Web)へ、その場で知らせる Durable Object。
 *
 * - 画面は WebSocket でつなぎっぱなしにする。Webhook(お客様のメッセージ・友だち追加)・フォームの回答・
 *   スタッフの送信のたびに、サーバーが「どのトークに何があったか」という小さな合図だけを送る。
 *   画面は、合図が来たトークだけを取り直す(10秒ごとに一覧を丸ごと取り直す、のをやめるため)。
 * - WebSocket Hibernation API を使う。何も起きない間は、この DO は眠っていて、動いている時間の料金がかからない。
 *   「ping」には、眠ったまま自動で「pong」を返す(つなぎっぱなしの確認用)。
 * - 合図は、見てよい公式アカウントのトークだけを、その画面に送る(制限のあるスタッフの分離)。
 * - 個人情報(名前・本文)は送らない。友だちID・公式アカウントID・種類・時刻だけ。
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../index.js';

export type ChatEventKind = 'message' | 'friend_added' | 'form_answered' | 'sent';

export interface ChatEvent {
  kind: ChatEventKind;
  friendId: string;
  accountId: string | null;
  /** 発生時刻(ISO) */
  at: string;
}

/** DO のインスタンスは1つで足りるので固定名で解決する */
export const CHAT_EVENTS_INSTANCE_NAME = 'main';

/** 画面ごとの接続に覚えておく情報 */
export interface ChatEventsAttachment {
  /** 見てよい公式アカウント。null = 制限なし(全アカウント) */
  allowedAccountIds: string[] | null;
}

/** この合図を、この画面に送ってよいか */
export function shouldDeliver(allowed: string[] | null | undefined, accountId: string | null): boolean {
  if (allowed === null || allowed === undefined) return true;
  // 公式アカウントが分からない合図は、制限のある画面には送らない
  return accountId !== null && allowed.includes(accountId);
}

/** Worker から DO へ渡す、見てよい公式アカウントのヘッダー名 */
export const ALLOWED_ACCOUNTS_HEADER = 'x-chat-events-allowed';

export function encodeAllowed(allowed: string[] | null): string {
  return allowed === null ? 'all' : JSON.stringify(allowed);
}

export function decodeAllowed(raw: string | null): string[] | null {
  if (!raw || raw === 'all') return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return []; // 読めないときは、何も見せない側に倒す
  }
}

export class ChatEvents extends DurableObject<Env['Bindings']> {
  constructor(ctx: DurableObjectState, env: Env['Bindings']) {
    super(ctx, env);
    // 眠ったまま ping に pong で答える(接続の生存確認。DO を起こさず、料金もかからない)
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** 画面からの WebSocket 接続を受け付ける */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const allowed = decodeAllowed(request.headers.get(ALLOWED_ACCOUNTS_HEADER));
    this.ctx.acceptWebSocket(server);
    const attachment: ChatEventsAttachment = { allowedAccountIds: allowed };
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 合図を、つながっている画面に送る(RPC)。送った数を返す */
  async publish(event: ChatEvent): Promise<number> {
    const body = JSON.stringify(event);
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const a = ws.deserializeAttachment() as ChatEventsAttachment | null;
        // 接続の情報が読めないときは、何も送らない側に倒す(null は「制限なし」なので、?? で潰さない)
        const allowed = a ? a.allowedAccountIds : [];
        if (!shouldDeliver(allowed, event.accountId)) continue;
        ws.send(body);
        sent++;
      } catch {
        // 送れない接続は、そのままにする(切れていれば close で片付く)
      }
    }
    return sent;
  }

  webSocketMessage(): void {
    // 画面からの送信は使わない(ping は自動応答)
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 ? 1000 : code, 'closing');
    } catch {
      // すでに閉じている
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011, 'error');
    } catch {
      // すでに閉じている
    }
  }
}
