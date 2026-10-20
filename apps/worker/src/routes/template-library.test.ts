import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { templateLibrary } from './template-library.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const ORIGIN = 'https://worker.example';

describe('テンプレート API(Lステップと同じ仕様)', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  beforeEach(() => {
    fixture = sqliteD1();
    const db = fixture.sqlite;
    db.exec(schema);
    db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('a1', '2008163446', '大門', 't', 's');
    db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('a2', '2008681588', '土岐', 't', 's');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = new Hono();
    app.route('/', templateLibrary);
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`${ORIGIN}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: fixture.db, WORKER_URL: ORIGIN });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };
  const text = (name: string, body = '本文', extra: Record<string, unknown> = {}) =>
    call('POST', '/api/tpl/items', { lineAccountId: 'a1', name, kind: 'standard', editorType: 'text', editorData: { text: body }, ...extra });

  it('作成: テキストは従来どおり text として保存され、入力データも残る。名前・本文が空なら理由つきの 400', async () => {
    const r = await text('あいさつ', 'こんにちは');
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ name: 'あいさつ', kind: 'standard', editorType: 'text', messageType: 'text', messageContent: 'こんにちは', typeLabel: 'テキスト', legacy: false });
    expect(r.json.data.editorData).toEqual({ text: 'こんにちは' });
    expect((await text('', 'x')).json.error).toContain('テンプレート名');
    expect((await text('空', '  ')).json.error).toContain('本文');
    expect((await call('POST', '/api/tpl/items', { lineAccountId: 'a1', name: 'x', editorType: 'zzz', editorData: {} })).status).toBe(400);
    expect((await call('POST', '/api/tpl/items', { name: 'x', editorType: 'text', editorData: { text: 'a' } })).status).toBe(400);
  });

  it('作成: スタンプ・質問などは「そのまま送る」箱(message_type は flex のまま)で保存される', async () => {
    const r = await call('POST', '/api/tpl/items', { lineAccountId: 'a1', name: 'スタンプ', kind: 'standard', editorType: 'sticker', editorData: { packageId: '11537', stickerId: '52002734' } });
    expect(r.status).toBe(201);
    expect(r.json.data.messageType).toBe('flex');
    expect(JSON.parse(r.json.data.messageContent).lineMessages[0]).toMatchObject({ type: 'sticker' });
    const q = await call('POST', '/api/tpl/items', {
      lineAccountId: 'a1',
      name: '質問',
      kind: 'standard',
      editorType: 'question',
      editorData: { question: 'はい?', choices: [{ label: 'はい', behavior: { kind: 'none' }, reply: { mode: 'text', text: 'ありがとう' } }, { label: 'いいえ', behavior: { kind: 'none' } }], answerMode: 'both' },
    });
    expect(q.status).toBe(201);
    // 返信つきの選択肢は postback。データには、このテンプレートのIDが入る
    const tpl = JSON.parse(q.json.data.messageContent).lineMessages[0].template;
    expect(tpl.actions[0].data).toBe(`tpl:${q.json.data.id}:0:0`);
  });

  it('フォルダ: 作成・名前変更・件数・別アカウントのフォルダには入れられない・削除すると中身は未分類へ', async () => {
    const f = (await call('POST', '/api/tpl/folders', { lineAccountId: 'a1', name: '一斉配信' })).json.data;
    const other = (await call('POST', '/api/tpl/folders', { lineAccountId: 'a2', name: '土岐' })).json.data;
    expect((await text('x', 'a', { folderId: other.id })).status).toBe(400);
    const t = (await text('A', 'a', { folderId: f.id })).json.data;
    await text('B');
    let list = (await call('GET', '/api/tpl/folders?lineAccountId=a1')).json.data;
    expect(list.folders).toEqual([{ id: f.id, name: '一斉配信', count: 1 }]);
    expect(list.unfiledCount).toBe(1);
    expect((await call('PUT', `/api/tpl/folders/${f.id}`, { name: '配信用' })).json.data.name).toBe('配信用');
    expect((await call('DELETE', `/api/tpl/folders/${f.id}`)).status).toBe(200);
    list = (await call('GET', '/api/tpl/folders?lineAccountId=a1')).json.data;
    expect(list.folders).toEqual([]);
    expect(list.unfiledCount).toBe(2);
    expect((await call('GET', `/api/tpl/items/${t.id}`)).json.data.folderId).toBeNull();
  });

  it('一覧: フォルダ・名前や本文の検索・ページング・旧来のテンプレート(公式アカウントなし)も未分類に出る', async () => {
    const db = fixture.sqlite;
    db.prepare("INSERT INTO templates(id,name,category,message_type,message_content) VALUES('legacy1','旧来のテンプレ','general','text','古い本文')").run();
    await text('朝のあいさつ', 'おはようございます');
    await text('夜のあいさつ', 'おやすみなさい');
    await call('POST', '/api/tpl/items', { lineAccountId: 'a2', name: '別アカウント', kind: 'standard', editorType: 'text', editorData: { text: 'x' } });
    const all = (await call('GET', '/api/tpl/items?lineAccountId=a1&folder=none')).json.data;
    expect(all.total).toBe(3);
    expect(new Set(all.items.map((i: any) => i.name))).toEqual(new Set(['旧来のテンプレ', '夜のあいさつ', '朝のあいさつ']));
    const legacy = all.items.find((i: any) => i.name === '旧来のテンプレ');
    expect(legacy).toMatchObject({ legacy: true, typeLabel: 'テキスト', summary: '古い本文' });
    const q = (await call('GET', '/api/tpl/items?lineAccountId=a1&folder=all&q=おはよう')).json.data;
    expect(q.items.map((i: any) => i.name)).toEqual(['朝のあいさつ']);
    const p = (await call('GET', '/api/tpl/items?lineAccountId=a1&folder=none&pageSize=2&page=2')).json.data;
    expect(p.items).toHaveLength(1);
    expect(p.total).toBe(3);
  });

  it('編集: 内容を変えると送る形も作り直す。旧来のテキストも編集できる', async () => {
    const t = (await text('A', 'before')).json.data;
    const u = await call('PUT', `/api/tpl/items/${t.id}`, { name: 'A2', editorData: { text: 'after' } });
    expect(u.json.data).toMatchObject({ name: 'A2', messageContent: 'after' });
    fixture.sqlite.prepare("INSERT INTO templates(id,name,category,message_type,message_content) VALUES('legacy1','旧','general','text','古い本文')").run();
    const legacy = (await call('GET', '/api/tpl/items/legacy1')).json.data;
    expect(legacy.editorType).toBe('text');
    expect(legacy.editorData.text).toBe('古い本文');
    const u2 = await call('PUT', '/api/tpl/items/legacy1', { editorData: { text: '新しい本文' }, lineAccountId: 'a1' });
    expect(u2.json.data.messageContent).toBe('新しい本文');
  });

  it('コピー・移動・並び替え・一括削除', async () => {
    const f = (await call('POST', '/api/tpl/folders', { lineAccountId: 'a1', name: 'F' })).json.data;
    const a = (await text('A')).json.data;
    const b = (await text('B')).json.data;
    const copy = (await call('POST', `/api/tpl/items/${a.id}/copy`)).json.data;
    expect(copy.name).toBe('Aのコピー');
    expect(copy.id).not.toBe(a.id);
    expect((await call('PUT', '/api/tpl/items/move', { ids: [a.id, b.id], folderId: f.id })).status).toBe(200);
    expect((await call('GET', '/api/tpl/folders?lineAccountId=a1')).json.data.folders[0].count).toBe(2);
    expect((await call('PUT', '/api/tpl/items/order', { ids: [b.id, a.id] })).status).toBe(200);
    const list = (await call('GET', `/api/tpl/items?lineAccountId=a1&folder=${f.id}`)).json.data.items;
    expect(list.map((i: any) => i.name)).toEqual(['B', 'A']);
    expect((await call('POST', '/api/tpl/items/delete', { ids: [a.id, b.id] })).status).toBe(200);
    expect((await call('GET', `/api/tpl/items/${a.id}`)).status).toBe(404);
  });

  it('下書き: 検査せずに途中で保存でき、更新・一覧・削除ができる。登録すると、元の下書きは消える', async () => {
    const d = await call('POST', '/api/tpl/drafts', { lineAccountId: 'a1', kind: 'standard', editorType: 'text', name: '', editorData: { text: '' } });
    expect(d.status).toBe(201);
    const id = d.json.data.id;
    const u = await call('PUT', `/api/tpl/drafts/${id}`, { lineAccountId: 'a1', kind: 'standard', editorType: 'text', name: '途中', editorData: { text: 'まだ途中' } });
    expect(u.json.data).toMatchObject({ name: '途中', summary: 'まだ途中' });
    expect((await call('GET', '/api/tpl/drafts?lineAccountId=a1')).json.data).toHaveLength(1);
    const r = await text('完成', 'できた', { draftId: id });
    expect(r.status).toBe(201);
    expect((await call('GET', '/api/tpl/drafts?lineAccountId=a1')).json.data).toHaveLength(0);
  });

  it('送信者: 作成・一覧・削除。テンプレートに付けると各メッセージに sender が入る', async () => {
    const s = (await call('POST', '/api/tpl/senders', { lineAccountId: 'a1', name: '店長', iconUrl: 'https://example.com/i.png' })).json.data;
    expect((await call('POST', '/api/tpl/senders', { lineAccountId: 'a1', name: 'あ'.repeat(21) })).status).toBe(400);
    const t = (await text('送信者つき', 'やあ', { senderId: s.id })).json.data;
    expect(JSON.parse(t.messageContent).lineMessages[0].sender).toEqual({ name: '店長', iconUrl: 'https://example.com/i.png' });
    expect((await call('GET', '/api/tpl/senders?lineAccountId=a1')).json.data).toHaveLength(1);
    expect((await call('DELETE', `/api/tpl/senders/${s.id}`)).status).toBe(200);
    expect((await call('GET', `/api/tpl/items/${t.id}`)).json.data.senderId).toBeNull();
  });

  it('パック: テンプレートから追加・新規追加・並び替え・5通まで・元のテンプレートを直すとパックにも反映される', async () => {
    const pack = (await call('POST', '/api/tpl/items', { lineAccountId: 'a1', name: '告知パック', kind: 'pack', editorType: 'pack' })).json.data;
    expect(pack).toMatchObject({ kind: 'pack', typeLabel: 'パック' });
    const t = (await text('本文テンプレ', '最初の本文')).json.data;
    const i1 = (await call('POST', `/api/tpl/packs/${pack.id}/items`, { templateId: t.id })).json.data;
    const i2 = (await call('POST', `/api/tpl/packs/${pack.id}/items`, { editorType: 'sticker', editorData: { packageId: '11537', stickerId: '52002734' } })).json.data;
    expect(i1).toMatchObject({ templateName: '本文テンプレ', typeLabel: 'テキスト' });
    let detail = (await call('GET', `/api/tpl/packs/${pack.id}`)).json.data;
    expect(detail.items).toHaveLength(2);
    expect(JSON.parse(detail.messageContent).lineMessages.map((m: any) => m.type)).toEqual(['text', 'sticker']);
    // 元のテンプレートを直すと、パックの送信内容も作り直される
    await call('PUT', `/api/tpl/items/${t.id}`, { editorData: { text: '直した本文' } });
    detail = (await call('GET', `/api/tpl/packs/${pack.id}`)).json.data;
    expect(JSON.parse(detail.messageContent).lineMessages[0].text).toBe('直した本文');
    // 並び替え
    await call('PUT', `/api/tpl/packs/${pack.id}/order`, { ids: [i2.id, i1.id] });
    detail = (await call('GET', `/api/tpl/packs/${pack.id}`)).json.data;
    expect(JSON.parse(detail.messageContent).lineMessages.map((m: any) => m.type)).toEqual(['sticker', 'text']);
    // 中身を消す・5通まで・パックの中にパックは入れられない
    expect((await call('DELETE', `/api/tpl/pack-items/${i1.id}`)).status).toBe(200);
    for (let i = 0; i < 4; i++) await call('POST', `/api/tpl/packs/${pack.id}/items`, { editorType: 'text', editorData: { text: `n${i}` } });
    expect((await call('POST', `/api/tpl/packs/${pack.id}/items`, { editorType: 'text', editorData: { text: 'over' } })).json.error).toContain('5通');
    const other = (await call('POST', '/api/tpl/items', { lineAccountId: 'a1', name: '別パック', kind: 'pack', editorType: 'pack' })).json.data;
    expect((await call('POST', `/api/tpl/packs/${pack.id}/items`, { templateId: other.id })).status).toBe(400);
    // パックをコピーすると中身も複製される
    const copy = (await call('POST', `/api/tpl/items/${pack.id}/copy`)).json.data;
    expect((await call('GET', `/api/tpl/packs/${copy.id}`)).json.data.items).toHaveLength(5);
  });

  it('プレビュー: 保存せずに、送る LINE メッセージを返す', async () => {
    const r = await call('POST', '/api/tpl/preview', { editorType: 'location', editorData: { title: '店', address: '東京', latitude: 35, longitude: 139 } });
    expect(r.json.data.messages[0]).toMatchObject({ type: 'location' });
    expect((await call('POST', '/api/tpl/preview', { editorType: 'text', editorData: { text: '' } })).status).toBe(400);
  });
});
