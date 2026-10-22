import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { getRichMenuReplyText } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { RICH_MENU_REPLY_PREFIX, RICH_MENU_TEMPLATE_PREFIX, sendRichMenuReply, sendRichMenuTemplate } from './rich-menu-reply.js';
import { toLineAction } from '../lib/rich-menu-publisher.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const REPLY_ID = '3f2b8c1e-9d4a-4b6e-8f10-2a7c5d9e1b34';
const LONG = ('こんにちは😊\n').repeat(300); // 300行・約3,000文字(メッセージアクションの上限300字を超える)

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('acc','ch','A店','s','t')`);
  sqlite.exec(`INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size) VALUES('g1','acc','メニュー','メニュー','large')`);
  sqlite.exec(`INSERT INTO rich_menu_pages(id,group_id,order_index,name,alias_id) VALUES('p1','g1',0,'ページ1','lhx-g1-0')`);
  const ins = sqlite.prepare(`INSERT INTO rich_menu_areas(id,page_id,bounds_x,bounds_y,bounds_width,bounds_height,action_type,action_data) VALUES(?,?,?,?,?,?,?,?)`);
  ins.run('a1', 'p1', 0, 0, 100, 100, 'postback', JSON.stringify({ kind: 'reply', replyId: REPLY_ID, replyText: LONG }));
  ins.run('a2', 'p1', 100, 0, 100, 100, 'postback', JSON.stringify({ data: 'x', displayText: 'y' }));
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f1','U1','acc','山田')`);
  const friend = { id: 'f1', display_name: '山田', user_id: null, ref_code: null, metadata: '{}' } as never;
  return { db, sqlite, friend };
}

describe('リッチメニュー: 店舗からメッセージを送る', () => {
  test('LINEには本文を渡さず、押されたら届く印(rmreply:<ID>)だけを登録する', () => {
    expect(toLineAction({ actionType: 'postback', actionData: { kind: 'reply', replyId: REPLY_ID, replyText: LONG } })).toEqual({ type: 'postback', data: `rmreply:${REPLY_ID}` });
    expect(toLineAction({ actionType: 'message', actionData: { text: 'こんにちは' } })).toEqual({ type: 'message', text: 'こんにちは' });
    expect(toLineAction({ actionType: 'postback', actionData: { data: 'x', displayText: 'y' } })).toEqual({ type: 'postback', data: 'x', displayText: 'y' });
    expect(() => toLineAction({ actionType: 'postback', actionData: { kind: 'reply', replyId: REPLY_ID, replyText: '  ' } })).toThrow(/空/);
    expect(() => toLineAction({ actionType: 'postback', actionData: { kind: 'reply', replyText: 'a' } })).toThrow(/replyId/);
  });

  test('replyId から本文(改行・絵文字・長文)を取り出せる。形が違う・別の種類のエリアは取り出さない', async () => {
    const { db } = setup();
    expect(await getRichMenuReplyText(db, REPLY_ID)).toBe(LONG);
    expect(await getRichMenuReplyText(db, '%')).toBeNull();
    expect(await getRichMenuReplyText(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  test('ボタンが押されたら、本文を店舗から返信し(5,000字以内の長文OK)、送信ログに残す', async () => {
    const { db, sqlite, friend } = setup();
    const replyMessage = vi.fn(async () => undefined);
    const lineClient = { replyMessage: vi.fn() } as never;
    const ok = await sendRichMenuReply(db, lineClient, friend, `${RICH_MENU_REPLY_PREFIX}${REPLY_ID}`, 'token', { lineAccountId: 'acc', replyMessage });
    expect(ok).toBe(true);
    expect(replyMessage).toHaveBeenCalledTimes(1);
    const sent = replyMessage.mock.calls[0] as unknown as [string, { type: string; text: string }[]];
    expect(sent[0]).toBe('token');
    expect(sent[1][0]).toMatchObject({ type: 'text', text: LONG });
    const log = sqlite.prepare(`SELECT direction, message_type, delivery_type, length(content) AS n FROM messages_log WHERE friend_id='f1'`).get() as Record<string, unknown>;
    expect(log).toMatchObject({ direction: 'outgoing', message_type: 'text', delivery_type: 'reply' });
    expect(Number(log.n)).toBeGreaterThan(300);
  });

  test('本文が見つからない・印が違うときは、何も送らない', async () => {
    const { db, friend } = setup();
    const replyMessage = vi.fn(async () => undefined);
    const lineClient = { replyMessage: vi.fn() } as never;
    expect(await sendRichMenuReply(db, lineClient, friend, `${RICH_MENU_REPLY_PREFIX}00000000-0000-4000-8000-000000000000`, 't', { replyMessage })).toBe(false);
    expect(await sendRichMenuReply(db, lineClient, friend, 'switch-to-xyz', 't', { replyMessage })).toBe(false);
    expect(replyMessage).not.toHaveBeenCalled();
  });
});

describe('リッチメニュー: テンプレートを送る', () => {
  const TPL = '7d1f0a52-3c8e-4f55-9a07-1b2c3d4e5f60';
  test('LINEには、押されたら届く印(rmtpl:<テンプレートID>)だけを登録する。テンプレートが空なら公開できない', () => {
    expect(toLineAction({ actionType: 'postback', actionData: { kind: 'template', templateId: TPL } })).toEqual({ type: 'postback', data: `rmtpl:${TPL}` });
    expect(() => toLineAction({ actionType: 'postback', actionData: { kind: 'template', templateId: '' } })).toThrow(/テンプレート/);
  });
  test('ボタンが押されたら、テンプレートの複数通を店舗から返信し(差し込み語は置き換え)、送信ログに残す', async () => {
    const { db, sqlite, friend } = setup();
    sqlite.prepare(`INSERT INTO templates(id,name,message_type,message_content,kind,line_account_id) VALUES(?,?,?,?,?,?)`).run(
      TPL, '予約動線', 'flex', JSON.stringify({ lineMessages: [{ type: 'text', text: '{{name}}様 ご予約はこちら' }, { type: 'text', text: '2通目' }] }), 'pack', 'acc',
    );
    const replyMessage = vi.fn(async () => undefined);
    const ok = await sendRichMenuTemplate(db, { replyMessage: vi.fn() } as never, friend, `${RICH_MENU_TEMPLATE_PREFIX}${TPL}`, 'token', { lineAccountId: 'acc', replyMessage });
    expect(ok).toBe(true);
    const sent = replyMessage.mock.calls[0] as unknown as [string, Array<{ type: string; text: string }>];
    expect(sent[0]).toBe('token');
    expect(sent[1].map((m) => m.text)).toEqual(['山田様 ご予約はこちら', '2通目']);
    const n = (sqlite.prepare(`SELECT COUNT(*) c FROM messages_log WHERE friend_id='f1' AND direction='outgoing'`).get() as { c: number }).c;
    expect(n).toBe(2);
  });
  test('テンプレートが見つからない・印が違うときは、何も送らない', async () => {
    const { db, friend } = setup();
    const replyMessage = vi.fn(async () => undefined);
    expect(await sendRichMenuTemplate(db, { replyMessage: vi.fn() } as never, friend, `${RICH_MENU_TEMPLATE_PREFIX}${TPL}`, 't', { replyMessage })).toBe(false);
    expect(await sendRichMenuTemplate(db, { replyMessage: vi.fn() } as never, friend, 'other', 't', { replyMessage })).toBe(false);
    expect(replyMessage).not.toHaveBeenCalled();
  });
});
