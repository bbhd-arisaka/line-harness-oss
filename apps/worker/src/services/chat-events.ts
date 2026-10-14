import { CHAT_EVENTS_INSTANCE_NAME } from '../durable-objects/chat-events.js';
import type { ChatEvent, ChatEventKind, ChatEvents } from '../durable-objects/chat-events.js';

/** 合図を送るのに必要な環境(バインディングが無い環境では、何もしない) */
export interface ChatEventsEnv {
  CHAT_EVENTS?: DurableObjectNamespace<ChatEvents>;
}

/**
 * トークの新着を、開いている管理画面へ知らせる。失敗しても処理(Webhook・保存)は止めない。
 * 呼び出し側は waitUntil に渡すこと。
 */
export async function publishChatEvent(
  env: ChatEventsEnv,
  event: { kind: ChatEventKind; friendId: string; accountId: string | null },
  now: () => Date = () => new Date(),
): Promise<void> {
  try {
    const ns = env.CHAT_EVENTS;
    if (!ns) return;
    const stub = ns.get(ns.idFromName(CHAT_EVENTS_INSTANCE_NAME));
    const payload: ChatEvent = { ...event, at: now().toISOString() };
    await stub.publish(payload);
  } catch (err) {
    console.error('[chat-events] publish failed', err instanceof Error ? err.message : 'error');
  }
}

/** executionCtx があれば waitUntil に、無ければその場で待つ(テスト・ctx の無い呼び出し用) */
export function publishChatEventInBackground(
  env: ChatEventsEnv,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  event: { kind: ChatEventKind; friendId: string; accountId: string | null },
): Promise<void> | void {
  const p = publishChatEvent(env, event);
  if (ctx) {
    try {
      ctx.waitUntil(p);
      return;
    } catch {
      // waitUntil が使えないときは、そのまま待つ
    }
  }
  return p;
}
