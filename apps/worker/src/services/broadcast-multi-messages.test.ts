import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { LineClient, type Message } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { broadcasts } from '../routes/broadcasts.js';
import { processQueuedBroadcasts } from './broadcast.js';
import { MAX_BROADCAST_MESSAGES, normalizeMessagesInput, parseExtraMessages } from './broadcast-messages.js';

vi.mock('./stealth.js', () => ({ sleep: async () => {}, calculateStaggerDelay: () => 0, addMessageVariation: (s: string) => s }));
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const closes: Array<() => void> = [];
afterEach(() => {
  if (vi.isMockFunction(globalThis.fetch)) expect(globalThis.fetch).not.toHaveBeenCalled();
  for (const close of closes.splice(0)) close();
  vi.restoreAllMocks();
});

const IMG = JSON.stringify({ originalContentUrl: 'https://example.test/a.jpg', previewImageUrl: 'https://example.test/a.jpg' });

// 一斉配信の「最大5通・上から順に」(2026-10-15)。1通だけの配信(これまで全部)が変わらないことも確かめる
describe('normalizeMessagesInput(5通までの検査)', () => {
  it('1〜5通は通り、1通目と2通目以降に分かれる', () => {
    const r = normalizeMessagesInput([
      { type: 'text', content: 'こんにちは{{name}}さん' },
      { type: 'image', content: IMG },
      { type: 'text', content: '回答はこちら {{form_url:abc-123}}' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.first.content).toBe('こんにちは{{name}}さん');
      expect(r.extras.map((m) => m.type)).toEqual(['image', 'text']);
    }
    expect(normalizeMessagesInput(Array.from({ length: MAX_BROADCAST_MESSAGES }, (_, i) => ({ type: 'text', content: `m${i}` }))).ok).toBe(true);
  });
  it('0通・6通・空の内容・画像のURL違い・使えない差し込み語は、どの通目かを添えて断る', () => {
    expect(normalizeMessagesInput([])).toMatchObject({ ok: false });
    const six = normalizeMessagesInput(Array.from({ length: 6 }, (_, i) => ({ type: 'text', content: `m${i}` })));
    expect(six).toMatchObject({ ok: false, error: expect.stringContaining('5通まで') });
    expect(normalizeMessagesInput([{ type: 'text', content: 'a' }, { type: 'text', content: '  ' }])).toMatchObject({ ok: false, error: expect.stringContaining('2通目') });
    expect(normalizeMessagesInput([{ type: 'image', content: JSON.stringify({ originalContentUrl: 'http://x', previewImageUrl: 'http://x' }) }])).toMatchObject({ ok: false, error: expect.stringContaining('1通目') });
    expect(normalizeMessagesInput([{ type: 'text', content: '{{coupon}}' }])).toMatchObject({ ok: false, error: expect.stringContaining('{{coupon}}') });
  });
  it('壊れた extra_messages は「追加なし」として扱い、最大4通まで', () => {
    expect(parseExtraMessages('not json')).toEqual([]);
    expect(parseExtraMessages(null)).toEqual([]);
    expect(parseExtraMessages(JSON.stringify(Array.from({ length: 9 }, () => ({ type: 'text', content: 'x' })))).length).toBe(4);
  });
});

function setup() {
  const { db, sqlite } = sqliteD1(); closes.push(() => sqlite.close()); sqlite.exec(schema);
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run<T>()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network forbidden'));
  vi.spyOn(LineClient.prototype, 'getMessageQuota').mockResolvedValue({ type: 'none' });
  vi.spyOn(LineClient.prototype, 'getMessageQuotaConsumption').mockResolvedValue({ totalUsage: 0 });
  const multicast = vi.spyOn(LineClient.prototype, 'multicast').mockResolvedValue({ data: {}, requestId: 'r' } as never);
  const sendAll = vi.spyOn(LineClient.prototype, 'broadcast').mockResolvedValue({ data: {}, requestId: 'r' } as never);
  const push = vi.spyOn(LineClient.prototype, 'pushMessage').mockResolvedValue(undefined as never);
  const app = new Hono(); app.route('/', broadcasts);
  sqlite.exec(`INSERT INTO tags(id,name) VALUES('tag','T');
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,liff_id) VALUES('a','a','A','tok-a','sec','LIFF-A');`);
  const friend = (i: number, name: string | null) => {
    sqlite.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following) VALUES(?,?,?,?,1)').run(`f${i}`, `U${i}`, name, 'a');
    sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,'tag')").run(`f${i}`);
  };
  const create = async (body: Record<string, unknown>) => {
    const r = await app.request('/api/broadcasts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 't', targetType: 'all', lineAccountId: 'a', trackLinks: false, ...body }) }, { DB: db });
    return { status: r.status, json: (await r.json()) as { success: boolean; error?: string; data?: { id: string; messages: Array<{ type: string; content: string }>; messageCount: number } } };
  };
  const send = (id: string) => app.request(`/api/broadcasts/${id}/send`, { method: 'POST' }, { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'test-default' });
  const texts = (msgs: Message[]) => msgs.map((m) => (m.type === 'text' ? m.text : m.type));
  return { db, sqlite, friend, create, send, multicast, sendAll, push, texts, app };
}

describe('作成と取得', () => {
  it('messages(3通)で作ると、順番どおりに返り、1通だけの作り方も今までどおり', async () => {
    const s = setup();
    const r = await s.create({ messages: [{ type: 'text', content: '1通目' }, { type: 'image', content: IMG }, { type: 'text', content: '3通目' }] });
    expect(r.status).toBe(201);
    expect(r.json.data?.messages.map((m) => m.type)).toEqual(['text', 'image', 'text']);
    expect(r.json.data?.messageCount).toBe(3);
    const legacy = await s.create({ messageType: 'text', messageContent: '従来の1通' });
    expect(legacy.json.data?.messages).toEqual([{ type: 'text', content: '従来の1通', altText: null }]);
    expect(legacy.json.data?.messageCount).toBe(1);
    const tooMany = await s.create({ messages: Array.from({ length: 6 }, () => ({ type: 'text', content: 'x' })) });
    expect(tooMany.status).toBe(400);
  });
  it('フォームのタグコードも、配信に使える(以前は「未対応の変数」で作れなかった)', async () => {
    const s = setup();
    const r = await s.create({ messages: [{ type: 'text', content: '回答はこちら {{form_url:form-1}}' }] });
    expect(r.status).toBe(201);
  });
});

describe('友だち全員(all)に送る', () => {
  it('LINE の broadcast に、全メッセージを順番どおり1リクエストで載せる(フォームはLIFFリンクに展開)', async () => {
    const s = setup(); s.friend(1, 'A');
    const r = await s.create({ messages: [{ type: 'text', content: '1通目' }, { type: 'image', content: IMG }, { type: 'text', content: 'フォーム {{form_url:form-1}}' }] });
    expect((await s.send(r.json.data!.id)).status).toBe(200);
    expect(s.sendAll).toHaveBeenCalledTimes(1);
    const sent = s.sendAll.mock.calls[0][0] as Message[];
    expect(sent.map((m) => m.type)).toEqual(['text', 'image', 'text']);
    expect(s.texts(sent)[2]).toBe('フォーム https://liff.line.me/LIFF-A?page=form&id=form-1');
  });
  it('1通だけなら、これまでと同じ(1通のリクエスト)', async () => {
    const s = setup(); s.friend(1, 'A');
    const r = await s.create({ messageType: 'text', messageContent: '1通だけ' });
    await s.send(r.json.data!.id);
    expect((s.sendAll.mock.calls[0][0] as Message[]).length).toBe(1);
  });
});

describe('タグ指定(multicast)', () => {
  it('全員に、全メッセージを順番どおり送り、トーク履歴にも1人あたり通数ぶん、順番どおり残す', async () => {
    const s = setup(); s.friend(1, 'A'); s.friend(2, 'B');
    const r = await s.create({ targetType: 'tag', targetTagId: 'tag', messages: [{ type: 'text', content: '一' }, { type: 'text', content: '二' }, { type: 'image', content: IMG }] });
    expect((await s.send(r.json.data!.id)).status).toBe(200);
    expect(s.multicast).toHaveBeenCalledTimes(1);
    expect(s.texts(s.multicast.mock.calls[0][1] as Message[])).toEqual(['一', '二', 'image']);
    const rows = s.sqlite.prepare("SELECT friend_id, content, message_type FROM messages_log WHERE broadcast_id = ? ORDER BY friend_id, created_at").all(r.json.data!.id) as Array<{ friend_id: string; content: string; message_type: string }>;
    expect(rows.length).toBe(6);
    expect(rows.filter((x) => x.friend_id === 'f1').map((x) => x.message_type)).toEqual(['text', 'text', 'image']);
    expect(rows.filter((x) => x.friend_id === 'f1').map((x) => x.content).slice(0, 2)).toEqual(['一', '二']);
    expect(s.sqlite.prepare('SELECT success_count, total_count FROM broadcasts WHERE id = ?').get(r.json.data!.id)).toEqual({ success_count: 2, total_count: 2 });
  });
});

describe('名前の差し込み({{name}})', () => {
  it('2通目にだけ名前があっても、1人ずつ、全メッセージにその人の名前を入れて、まとめて送る', async () => {
    const s = setup(); s.friend(1, 'さくら'); s.friend(2, 'はな');
    const r = await s.create({ messages: [{ type: 'text', content: 'こんにちは' }, { type: 'text', content: '{{name}}さんへ' }, { type: 'image', content: IMG }] });
    const res = await s.send(r.json.data!.id);
    expect(res.status).toBe(202); // 1人ずつの送信は、順番待ち(キュー)で行う
    await processQueuedBroadcasts(s.db, new LineClient('test-default'));
    expect(s.push).toHaveBeenCalledTimes(2);
    const byUser = new Map(s.push.mock.calls.map((c) => [c[0] as string, s.texts(c[1] as Message[])]));
    expect(byUser.get('U1')).toEqual(['こんにちは', 'さくらさんへ', 'image']);
    expect(byUser.get('U2')).toEqual(['こんにちは', 'はなさんへ', 'image']);
    // 履歴は1人3通。成功数は「人数」(通数ではない)
    expect(s.sqlite.prepare('SELECT COUNT(*) AS n FROM messages_log WHERE broadcast_id = ?').get(r.json.data!.id)).toEqual({ n: 6 });
    expect(s.sqlite.prepare('SELECT status, success_count, total_count FROM broadcasts WHERE id = ?').get(r.json.data!.id)).toEqual({ status: 'sent', success_count: 2, total_count: 2 });
  });
});

describe('一覧(トーク)の並び順', () => {
  it('配信の履歴は、トーク画面では順番どおり。一覧の並び順には使わない(別テスト chats-list-broadcast)', async () => {
    const s = setup(); s.friend(1, 'A');
    const r = await s.create({ targetType: 'tag', targetTagId: 'tag', messages: [{ type: 'text', content: '甲' }, { type: 'text', content: '乙' }] });
    await s.send(r.json.data!.id);
    const rows = s.sqlite.prepare("SELECT content FROM messages_log WHERE broadcast_id = ? ORDER BY created_at ASC").all(r.json.data!.id) as Array<{ content: string }>;
    expect(rows.map((x) => x.content)).toEqual(['甲', '乙']);
  });
});
