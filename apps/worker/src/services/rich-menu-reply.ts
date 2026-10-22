import type { LineClient, Message } from '@line-crm/line-sdk';
import { getRichMenuReplyText } from '@line-crm/db';
import type { Friend } from '@line-crm/db';
import { logOutgoingMessage } from './event-bus.js';
import { buildMessage, buildMessages, expandVariables, messageToLogPayload, resolveMetadata } from './step-delivery.js';
import { expandFormLinks } from './form-link.js';

/** リッチメニューの「店舗からメッセージを送る」ボタンが押されたときに、postback data として届く印。 */
export const RICH_MENU_REPLY_PREFIX = 'rmreply:';
/** リッチメニューの「テンプレートを送る」ボタンが押されたときに、postback data として届く印。 */
export const RICH_MENU_TEMPLATE_PREFIX = 'rmtpl:';

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

/**
 * 「テンプレートを送る」ボタン: 押したお客様に、テンプレート(パック・カルーセルなど。最大5通)を店舗から返信する。
 * 返信は replyToken を使うので無料。差し込み語・フォームのリンクは、自動応答と同じく展開する。
 * @returns 返信できたら true(テンプレートが見つからない・送信に失敗したら false)
 */
export async function sendRichMenuTemplate(
  db: D1Database,
  lineClient: LineClient,
  friend: Friend,
  postbackData: string,
  replyToken: string,
  opts: { lineAccountId?: string | null; workerUrl?: string; replyMessage?: RichMenuReplySender } = {},
): Promise<boolean> {
  if (!postbackData.startsWith(RICH_MENU_TEMPLATE_PREFIX)) return false;
  const templateId = postbackData.slice(RICH_MENU_TEMPLATE_PREFIX.length);
  try {
    const tpl = await db.prepare('SELECT message_type, message_content FROM templates WHERE id = ?').bind(templateId).first<{ message_type: string; message_content: string }>();
    if (!tpl) {
      console.warn('rich menu template: not found', templateId);
      return false;
    }
    const metadata = await resolveMetadata(db, friend);
    let content = expandVariables(tpl.message_content, { ...friend, metadata }, opts.workerUrl, tpl.message_type);
    content = await expandFormLinks(db, content, opts.lineAccountId ?? null);
    const messages = buildMessages(tpl.message_type, content).slice(0, 5);
    if (messages.length === 0) return false;
    if (opts.replyMessage) await opts.replyMessage(replyToken, messages);
    else await lineClient.replyMessage(replyToken, messages);
    for (const m of messages) {
      const log = messageToLogPayload(m);
      await logOutgoingMessage(db, { friendId: friend.id, messageType: log.messageType, content: log.content, deliveryType: 'reply', source: 'auto_reply', lineAccountId: opts.lineAccountId ?? null });
    }
    return true;
  } catch (err) {
    console.error('Failed to send rich menu template', err);
    return false;
  }
}
