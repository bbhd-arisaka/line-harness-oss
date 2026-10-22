import type { LineClient, Message } from '@line-crm/line-sdk';
import { getRichMenuReplyText, recordRichMenuTap } from '@line-crm/db';
import type { Friend, FriendAddAction } from '@line-crm/db';
import { logOutgoingMessage } from './event-bus.js';
import { buildMessage, buildMessages, expandVariables, messageToLogPayload, resolveMetadata } from './step-delivery.js';
import { expandFormLinks } from './form-link.js';
import { executeFriendAddAction } from './friend-add-settings.js';

/** リッチメニューの「店舗からメッセージを送る」ボタンが押されたときに、postback data として届く印。 */
export const RICH_MENU_REPLY_PREFIX = 'rmreply:';
/** リッチメニューの「テンプレートを送る」ボタンが押されたときに、postback data として届く印。 */
export const RICH_MENU_TEMPLATE_PREFIX = 'rmtpl:';
/** リッチメニューの「アクション」ボタン(Lステップのアクション設定)が押されたときの印。rmact:<ボタンID> */
export const RICH_MENU_ACTIONS_PREFIX = 'rmact:';

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

/**
 * 「アクション」ボタン: 押された友だちに、設定したアクションを上から順に実行する(Lステップの「アクション設定」と同じ)。
 *  - テキスト送信・テンプレート送信は、まとめて replyToken で返信する(無料。LINEの1回は最大5通)
 *  - タグ・友だち情報・メニュー・リマインダなどは、そのまま実行する(1つ失敗しても、残りは続ける)
 * 動きは、ボタンのIDで、いまの保存内容から読む(あとで動きを直しても、LINEへの登録し直しは要らない)。
 * @returns 何か実行できたら true(ボタンが見つからない・「アクション」でないときは false)
 */
export async function runRichMenuActions(
  db: D1Database,
  lineClient: LineClient,
  friend: Friend,
  postbackData: string,
  replyToken: string,
  opts: { lineAccountId?: string | null; lineAccessToken?: string; workerUrl?: string; replyMessage?: RichMenuReplySender } = {},
): Promise<boolean> {
  if (!postbackData.startsWith(RICH_MENU_ACTIONS_PREFIX)) return false;
  const areaId = postbackData.slice(RICH_MENU_ACTIONS_PREFIX.length);
  try {
    const row = await db.prepare('SELECT action_type, action_data FROM rich_menu_areas WHERE id = ?').bind(areaId).first<{ action_type: string; action_data: string }>();
    if (!row || row.action_type !== 'postback') return false;
    const data = JSON.parse(row.action_data) as { kind?: string; actions?: FriendAddAction[] };
    if (data.kind !== 'actions' || !Array.isArray(data.actions)) return false;

    // 押された記録(メニュー一覧の「計測」)
    await recordRichMenuTap(db, areaId, friend.id).catch((err) => console.error('rich menu tap record failed', err));

    const metadata = await resolveMetadata(db, friend);
    const messages: Message[] = [];
    const others: FriendAddAction[] = [];
    for (const action of data.actions) {
      if (action.type === 'text') {
        const text = String(action.params?.content ?? '');
        if (!text.trim()) continue;
        const content = expandVariables(text, { ...friend, metadata }, opts.workerUrl, 'text');
        messages.push(buildMessage('text', await expandFormLinks(db, content, opts.lineAccountId ?? null)));
      } else if (action.type === 'template') {
        const tpl = await db.prepare('SELECT message_type, message_content FROM templates WHERE id = ?').bind(String(action.params?.templateId ?? '')).first<{ message_type: string; message_content: string }>();
        if (!tpl) continue;
        let content = expandVariables(tpl.message_content, { ...friend, metadata }, opts.workerUrl, tpl.message_type);
        content = await expandFormLinks(db, content, opts.lineAccountId ?? null);
        messages.push(...buildMessages(tpl.message_type, content));
      } else {
        others.push(action);
      }
    }

    let did = false;
    if (messages.length > 0) {
      const send = messages.slice(0, 5);
      if (opts.replyMessage) await opts.replyMessage(replyToken, send);
      else await lineClient.replyMessage(replyToken, send);
      for (const m of send) {
        const log = messageToLogPayload(m);
        await logOutgoingMessage(db, { friendId: friend.id, messageType: log.messageType, content: log.content, deliveryType: 'reply', source: 'auto_reply', lineAccountId: opts.lineAccountId ?? null });
      }
      did = true;
    }
    const target = { friendId: friend.id, lineAccountId: opts.lineAccountId ?? null, lineAccessToken: opts.lineAccessToken, workerUrl: opts.workerUrl };
    for (const action of others) {
      try {
        await executeFriendAddAction(db, target, action);
        did = true;
      } catch (err) {
        console.error('rich menu action failed', action.type, err);
      }
    }
    return did || data.actions.length === 0;
  } catch (err) {
    console.error('Failed to run rich menu actions', err);
    return false;
  }
}
