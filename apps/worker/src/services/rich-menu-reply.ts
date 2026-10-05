import type { LineClient, Message } from '@line-crm/line-sdk';
import { getRichMenuReplyText } from '@line-crm/db';
import type { Friend } from '@line-crm/db';
import { logOutgoingMessage } from './event-bus.js';
import { buildMessage, expandVariables, messageToLogPayload, resolveMetadata } from './step-delivery.js';

/** リッチメニューの「店舗からメッセージを送る」ボタンが押されたときに、postback data として届く印。 */
export const RICH_MENU_REPLY_PREFIX = 'rmreply:';

export type RichMenuReplySender = (replyToken: string, messages: Message[]) => Promise<void>;

/**
 * ボタンを押したお客様に、店舗から設定した文章を返信する(お客様が送ったことにはならない)。
 * 返信は replyToken を使うので無料。{{name}} などの差し込みも、自動応答と同じく使える。
 * @returns 返信できたら true(本文が見つからない・送信に失敗したら false)
 */
export async function sendRichMenuReply(
  db: D1Database,
  lineClient: LineClient,
  friend: Friend,
  postbackData: string,
  replyToken: string,
  opts: { lineAccountId?: string | null; workerUrl?: string; replyMessage?: RichMenuReplySender } = {},
): Promise<boolean> {
  if (!postbackData.startsWith(RICH_MENU_REPLY_PREFIX)) return false;
  const replyId = postbackData.slice(RICH_MENU_REPLY_PREFIX.length);
  try {
    const text = await getRichMenuReplyText(db, replyId);
    if (!text) {
      console.warn('rich menu reply: text not found', replyId);
      return false;
    }
    const metadata = await resolveMetadata(db, friend);
    const content = expandVariables(text, { ...friend, metadata }, opts.workerUrl, 'text');
    const message = buildMessage('text', content);
    if (opts.replyMessage) await opts.replyMessage(replyToken, [message]);
    else await lineClient.replyMessage(replyToken, [message]);
    const payload = messageToLogPayload(message);
    await logOutgoingMessage(db, {
      friendId: friend.id,
      messageType: payload.messageType,
      content: payload.content,
      deliveryType: 'reply',
      source: 'auto_reply',
      lineAccountId: opts.lineAccountId ?? null,
    });
    return true;
  } catch (err) {
    console.error('Failed to send rich menu reply', err);
    return false;
  }
}
