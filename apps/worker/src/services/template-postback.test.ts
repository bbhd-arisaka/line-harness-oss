import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { templatePostbackData } from '@line-crm/shared';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { choiceActions, handleTemplatePostback, resolveTappedChoice, TAP_LIMIT_NOTICE } from './template-postback.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('テンプレートのボタンが押されたとき', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  const sent: unknown[][] = [];
  const replyMessage = vi.fn(async (_token: string, messages: unknown[]) => {
    sent.push(messages);
  });
  const lineClient = { replyMessage: vi.fn() } as never;
  const friend = { id: 'f1', display_name: '太郎', user_id: null, metadata: '{}' } as never;

  beforeEach(() => {
    sent.length = 0;
    replyMessage.mockClear();
    fixture = sqliteD1();
    const db = fixture.sqlite;
    db.exec(schema);
    db.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)').run('a1', '1', '店', 't', 's');
    db.prepare("INSERT INTO friends(id,line_user_id,display_name,is_following,line_account_id,metadata) VALUES('f1','U1','太郎',1,'a1','{}')").run();
    db.prepare("INSERT INTO tags(id,name) VALUES('t1','回答済み')").run();
  });

  const carousel = {
    panels: [{ text: 'どちら?', choices: [{ label: 'A', behavior: { kind: 'none' }, reply: { mode: 'text', text: 'Aですね' }, repeatReply: { mode: 'text', text: 'もう選びました' }, addTagIds: ['t1'] }] }],
    tapLimit: 'none',
  };
  const seed = (editorType: string, data: unknown, id = 'tpl1') =>
    fixture.sqlite.prepare("INSERT INTO templates(id,name,message_type,message_content,editor_type,editor_data,kind) VALUES(?,?,'flex','{}',?,?,'standard')").run(id, 'テスト', editorType, JSON.stringify(data));
  const tap = (data: string) => handleTemplatePostback(fixture.db, lineClient, friend, data, 'rt', { lineAccountId: 'a1', replyMessage });

  it('選んだ選択肢の返信を送り、タグを付ける。2回目は二度押しの返信', async () => {
    seed('carousel', carousel);
    expect(await tap(templatePostbackData('tpl1', 0, 0))).toBe(true);
    expect(sent[0]).toEqual([{ type: 'text', text: 'Aですね' }]);
    expect(fixture.sqlite.prepare("SELECT 1 AS x FROM friend_tags WHERE friend_id='f1' AND tag_id='t1'").get()).toBeTruthy();
    await tap(templatePostbackData('tpl1', 0, 0));
    expect(sent[1]).toEqual([{ type: 'text', text: 'もう選びました' }]);
    expect(fixture.sqlite.prepare('SELECT count FROM template_taps').get()).toEqual({ count: 2 });
  });

  it('タップ回数の制限: 2回目は返信もタグもなく、お知らせだけ', async () => {
    seed('carousel', { ...carousel, tapLimit: 'carousel_once', limitReply: 'default' });
    await tap(templatePostbackData('tpl1', 0, 0));
    await tap(templatePostbackData('tpl1', 0, 0));
    expect(sent[1]).toEqual([{ type: 'text', text: TAP_LIMIT_NOTICE }]);
    expect(fixture.sqlite.prepare('SELECT count FROM template_taps').get()).toEqual({ count: 1 });
  });

  it('「何も送らない」設定なら、上限を超えても無言', async () => {
    seed('carousel', { ...carousel, tapLimit: 'choice_once', limitReply: 'none' });
    await tap(templatePostbackData('tpl1', 0, 0));
    await tap(templatePostbackData('tpl1', 0, 0));
    expect(sent).toHaveLength(1);
  });

  it('質問(詳細設定): 1つのみタップ可能なら、2つ目の選択肢は押せない', async () => {
    seed('question', {
      question: 'どちら?',
      detail: true,
      answerMode: 'single',
      choices: [
        { label: 'はい', behavior: { kind: 'none' }, reply: { mode: 'text', text: 'はい!' } },
        { label: 'いいえ', behavior: { kind: 'none' }, reply: { mode: 'text', text: 'いいえ!' } },
      ],
    });
    await tap(templatePostbackData('tpl1', 0, 0));
    await tap(templatePostbackData('tpl1', 0, 1));
    expect(sent[0]).toEqual([{ type: 'text', text: 'はい!' }]);
    expect(sent[1]).toEqual([{ type: 'text', text: TAP_LIMIT_NOTICE }]);
  });

  it('友だち情報欄の更新とテンプレート返信', async () => {
    fixture.sqlite.prepare("INSERT INTO templates(id,name,message_type,message_content) VALUES('r1','返信','text','ありがとう{{name}}さん')").run();
    seed('carousel', {
      panels: [{ text: 'x', choices: [{ label: 'A', behavior: { kind: 'none' }, reply: { mode: 'template', templateId: 'r1' }, fieldId: 'plan', fieldValue: 'gold' }] }],
    });
    await tap(templatePostbackData('tpl1', 0, 0));
    expect(sent[0]).toEqual([{ type: 'text', text: 'ありがとう太郎さん' }]);
    expect(JSON.parse((fixture.sqlite.prepare("SELECT metadata FROM friends WHERE id='f1'").get() as { metadata: string }).metadata)).toEqual({ plan: 'gold' });
  });

  it('消えたテンプレート・形が違うデータは、何もせず処理済みにする(自動応答に回さない)', async () => {
    expect(await tap(templatePostbackData('missing', 0, 0))).toBe(true);
    seed('carousel', carousel);
    expect(await tap(templatePostbackData('tpl1', 5, 5))).toBe(true);
    expect(await tap('other:data')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('resolveTappedChoice / choiceActions', () => {
    expect(resolveTappedChoice('text', {}, 0, 0)).toBeNull();
    const r = resolveTappedChoice('carousel', carousel, 0, 0);
    expect(r?.choice.label).toBe('A');
    const e = choiceActions({ label: 'x', behavior: { kind: 'scenario', value: 's1', scenarioOp: 'stop' }, removeTagIds: ['t1'] });
    expect(e.stopScenarioId).toBe('s1');
    expect(e.actions).toEqual([{ type: 'tag', params: { op: 'remove', tagIds: ['t1'] }, condition: null }]);
  });
});
