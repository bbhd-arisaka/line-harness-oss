import { describe, expect, it } from 'vitest';
import {
  broadcastStatusLabel,
  checkMessage,
  checkMessages,
  findUnsupportedTag,
  formTag,
  insertAtSelection,
  MAX_BROADCAST_MESSAGES,
  messageSummary,
  newDraftMessage,
  splitTags,
  toApiMessages,
  type DraftMessage,
  confirmScheduleMessage,
  confirmSendMessage,
  missingRealNameNote,
  usesRealName,
  defaultTitle,
  describeRule,
  describeSavedConditions,
  draftSignature,
  isRuleComplete,
  newUuid,
  toSegmentConditions,
  type DraftRule,
} from './broadcast';

const tag = (id: string, kind: 'tag_exists' | 'tag_not_exists' = 'tag_exists'): DraftRule => ({ id: `r-${id}`, kind, tagId: id, tagName: `タグ${id}` });
const field = (value: string, kind: 'field_equals' | 'field_not_equals' = 'field_equals'): DraftRule => ({ id: 'f', kind, fieldKey: 'ls_abc', fieldLabel: '来店のきっかけ', value });

describe('条件の組み立て', () => {
  it('完成した条件だけを、サーバーが受け取る形にする(タグ=IDの文字列、友だち情報=キーと値)', () => {
    expect(toSegmentConditions('AND', [tag('t1'), tag('t2', 'tag_not_exists'), field(' SNS ')])).toEqual({
      operator: 'AND',
      rules: [
        { type: 'tag_exists', value: 't1' },
        { type: 'tag_not_exists', value: 't2' },
        { type: 'metadata_equals', value: { key: 'ls_abc', value: 'SNS' } },
      ],
    });
    expect(toSegmentConditions('OR', [field('x', 'field_not_equals')])).toEqual({
      operator: 'OR',
      rules: [{ type: 'metadata_not_equals', value: { key: 'ls_abc', value: 'x' } }],
    });
  });
  it('未完成の条件(タグ未選択・値が空)は含めない。1つも無ければ null(=絞り込みなし)', () => {
    expect(toSegmentConditions('AND', [{ id: 'i1', kind: 'inflow_is', refCode: 'HPB111', routeName: 'HPB' }, { id: 'i2', kind: 'inflow_is_not', refCode: 'INS222' }])).toEqual({
      operator: 'AND',
      rules: [
        { type: 'ref_code', value: 'HPB111' },
        { type: 'ref_code_not', value: 'INS222' },
      ],
    });
    expect(toSegmentConditions('AND', [{ id: 'i3', kind: 'inflow_is' }])).toBeNull(); // 流入経路を選んでいないものは、条件にしない
    expect(toSegmentConditions('AND', [])).toBeNull();
    expect(toSegmentConditions('AND', [{ id: 'a', kind: 'tag_exists' }, field('  ')])).toBeNull();
    expect(toSegmentConditions('AND', [{ id: 'a', kind: 'tag_exists' }, tag('t1')])?.rules).toHaveLength(1);
    expect(isRuleComplete(tag('t1'))).toBe(true);
    expect(isRuleComplete(field(''))).toBe(false);
  });
  it('条件の説明文', () => {
    expect(describeRule(tag('1'))).toBe('タグ「タグ1」がある');
    expect(describeRule(tag('1', 'tag_not_exists'))).toBe('タグ「タグ1」がない');
    expect(describeRule(field('SNS'))).toBe('友だち情報「来店のきっかけ」が「SNS」');
    expect(describeRule(field('SNS', 'field_not_equals'))).toBe('友だち情報「来店のきっかけ」が「SNS」ではない');
  });
  it('履歴では、保存された条件の件数と組み合わせ方を出す。友だち中の固定条件は数えない', () => {
    expect(describeSavedConditions({ operator: 'OR', rules: [{ type: 'tag_exists', value: 'a' }, { type: 'is_following', value: true }] })).toBe('条件で絞り込み(1件・どれかを満たす)');
    expect(describeSavedConditions({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'a' }, { type: 'tag_exists', value: 'b' }] })).toBe('条件で絞り込み(2件・すべて満たす)');
    expect(describeSavedConditions(null)).toBeNull();
    expect(describeSavedConditions({ operator: 'AND', rules: [] })).toBeNull();
  });
});

describe('メッセージ・題名・確認', () => {
  it('空のメッセージ・長すぎるメッセージは送れない', () => {
    expect(checkMessage('  ')).toEqual({ ok: false, reason: 'メッセージを入力してください' });
    expect(checkMessage('こんにちは')).toEqual({ ok: true });
    expect(checkMessage('あ'.repeat(5000))).toEqual({ ok: true });
    expect(checkMessage('あ'.repeat(5001)).ok).toBe(false);
  });
  it('題名は、本文の最初の行(20文字まで)+日付', () => {
    const d = new Date(2026, 9, 15);
    expect(defaultTitle('\n  秋のご案内です\n2行目', d)).toBe('秋のご案内です(10/15)');
    expect(defaultTitle('あ'.repeat(30), d)).toBe(`${'あ'.repeat(20)}(10/15)`);
    expect(defaultTitle('   ', d)).toBe('一斉配信(10/15)');
  });
  it('予約の確認文: いつ送るか・いまの人数・時刻の時点の対象になること・取り消せること', () => {
    expect(confirmScheduleMessage('土岐店', 120, false, '10月16日(金) 09:00', 2)).toBe(
      '「土岐店」の友だち全員の(いまは120人)に、2通のメッセージを上から順に、10月16日(金) 09:00に送るよう予約します。送る人は、予約の時刻の時点の対象になります。予約は、配信の画面から取り消せます。',
    );
    expect(confirmScheduleMessage('土岐店', 5, true, '10月16日(金) 09:00')).toContain('条件に合う(いまは5人)');
  });
  it('メッセージが2通以上のときは、確認文に通数と「上から順」を入れる', () => {
    expect(confirmSendMessage('土岐店', 5, true, 3)).toBe('「土岐店」の条件に合う5人に、3通のメッセージを上から順に、いますぐ送ります。送ったあとは取り消せません。');
  });
  it('送る前の確認文: アカウント名・人数・絞り込みの有無・取り消せないこと', () => {
    expect(confirmSendMessage('土岐店', 1234, false)).toBe('「土岐店」の友だち全員の1,234人に、いますぐ送ります。送ったあとは取り消せません。');
    expect(confirmSendMessage('土岐店', 5, true)).toBe('「土岐店」の条件に合う5人に、いますぐ送ります。送ったあとは取り消せません。');
  });
  it('状態の表示名', () => {
    expect(broadcastStatusLabel('draft')).toBe('下書き');
    expect(broadcastStatusLabel('sending')).toBe('配信中');
    expect(broadcastStatusLabel('sent')).toBe('配信済み');
    expect(broadcastStatusLabel('unknown')).toBe('unknown');
  });
});

describe('作成の二重実行の防止(Idempotency-Key)', () => {
  it('UUID v4 の形(サーバーの検査を通る)で、毎回違う', () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const a = newUuid();
    expect(a).toMatch(re);
    expect(newUuid()).not.toBe(a);
    expect(newUuid(() => 0)).toMatch(re);
    expect(newUuid(() => 0.999)).toMatch(re);
  });
  it('内容(アカウント・本文・順番・種類)が同じなら同じ識別、変われば別', () => {
    const t = (text: string, key = 'k'): DraftMessage => ({ key, kind: 'text', text, imageUrl: null });
    expect(draftSignature({ accountId: 'A', messages: [t(' hi ')] })).toBe(draftSignature({ accountId: 'A', messages: [t('hi', 'other-key')] }));
    expect(draftSignature({ accountId: 'A', messages: [t('hi')] })).not.toBe(draftSignature({ accountId: 'B', messages: [t('hi')] }));
    expect(draftSignature({ accountId: 'A', messages: [t('hi')] })).not.toBe(draftSignature({ accountId: 'A', messages: [t('ho')] }));
    // 順番を入れ替えたら別の配信(二重作成防止のキーが変わる)
    expect(draftSignature({ accountId: 'A', messages: [t('1'), t('2')] })).not.toBe(draftSignature({ accountId: 'A', messages: [t('2'), t('1')] }));
  });
});

// 一斉配信のメッセージは最大5通・上から順に届く(2026-10-15)。画像・名前の差し込み・フォームも使える
describe('配信するメッセージ(最大5通)', () => {
  const text = (t: string): DraftMessage => ({ ...newDraftMessage('text', `k-${t}`), text: t });
  const image = (url: string | null): DraftMessage => ({ ...newDraftMessage('image', 'img'), imageUrl: url });

  it('サーバーに送る形: テキストは前後の空白を除き、画像は LINE が求める JSON', () => {
    expect(toApiMessages([text('  こんにちは  '), image('https://example.test/a.jpg')])).toEqual([
      { type: 'text', content: 'こんにちは' },
      { type: 'image', content: JSON.stringify({ originalContentUrl: 'https://example.test/a.jpg', previewImageUrl: 'https://example.test/a.jpg' }) },
    ]);
  });
  it('通数は1〜5通。0通・6通は送れない', () => {
    expect(checkMessages([])).toMatchObject({ ok: false });
    expect(checkMessages(Array.from({ length: MAX_BROADCAST_MESSAGES }, (_, i) => text(`m${i}`)))).toEqual({ ok: true });
    expect(checkMessages(Array.from({ length: MAX_BROADCAST_MESSAGES + 1 }, (_, i) => text(`m${i}`)))).toMatchObject({ ok: false });
  });
  it('問題は「◯通目」つきで返す(1通だけなら、通目は付けない)', () => {
    expect(checkMessages([text('  ')])).toEqual({ ok: false, reason: 'メッセージを入力してください' });
    expect(checkMessages([text('a'), text('')])).toEqual({ ok: false, reason: '2通目: メッセージを入力してください' });
    expect(checkMessages([text('a'), image(null)])).toEqual({ ok: false, reason: '2通目: 画像を選んでください' });
    expect(checkMessages([text('a'), image('https://example.test/a.jpg')])).toEqual({ ok: true });
  });
  it('名前・フォームのタグは使える。それ以外の {{…}} は、送る前に止める', () => {
    expect(checkMessages([text(`こんにちは{{name}}さん ${formTag('f-1')}`)])).toEqual({ ok: true });
    expect(findUnsupportedTag('{{name}} {{liff_id}} {{form_url:abc}}')).toBeNull();
    expect(findUnsupportedTag('{{coupon}}')).toBe('{{coupon}}');
    expect(checkMessages([text('a'), text('{{coupon}}')])).toMatchObject({ ok: false, reason: expect.stringContaining('2通目') });
  });
  it('本文を、ふつうの文字・名前・フォーム・その他に分ける(色付きの枠で見せるため)', () => {
    expect(splitTags(`こんにちは{{name}}さん\n回答は${formTag('f-1')}から {{foo}}`)).toEqual([
      { kind: 'text', text: 'こんにちは' },
      { kind: 'name' },
      { kind: 'text', text: 'さん\n回答は' },
      { kind: 'form', formId: 'f-1' },
      { kind: 'text', text: 'から ' },
      { kind: 'other', code: 'foo' },
    ]);
    expect(splitTags('タグなし')).toEqual([{ kind: 'text', text: 'タグなし' }]);
    expect(splitTags('')).toEqual([]);
  });
  it('カーソル位置に入れる(選択範囲は置き換え・範囲外でも壊れない・位置が不明なら末尾)', () => {
    expect(insertAtSelection('こんにちは', '{{name}}', { start: 2, end: 2 })).toEqual({ text: 'こん{{name}}にちは', cursor: 10 });
    expect(insertAtSelection('abcdef', 'X', { start: 1, end: 4 })).toEqual({ text: 'aXef', cursor: 2 });
    expect(insertAtSelection('abc', 'X', { start: 99, end: 120 })).toEqual({ text: 'abcX', cursor: 4 });
    expect(insertAtSelection('abc', 'X', null)).toEqual({ text: 'abcX', cursor: 4 });
    expect(insertAtSelection('abcdef', 'X', { start: 4, end: 1 })).toEqual({ text: 'aXef', cursor: 2 });
  });
  it('履歴・一覧の短い説明', () => {
    expect(messageSummary({ type: 'image', content: '{}' })).toBe('[画像]');
    expect(messageSummary({ type: 'flex', content: '{}' })).toBe('[Flexメッセージ]');
    expect(messageSummary({ type: 'text', content: 'こんにちは\n  世界' })).toBe('こんにちは 世界');
  });
});

describe('LINE名と本名のタグ', () => {
  it('どちらも使える差し込み語。それ以外は止める', () => {
    expect(findUnsupportedTag('{{name}} {{real_name}} {{liff_id}}')).toBeNull();
    expect(findUnsupportedTag('{{nickname}}')).toBe('{{nickname}}');
  });
  it('本文を分けるとき、本名は名前とは別の種類', () => {
    expect(splitTags('{{name}}と{{real_name}}')).toEqual([{ kind: 'name' }, { kind: 'text', text: 'と' }, { kind: 'realName' }]);
  });
});

describe('本名の差し込みの確認', () => {
  it('本名が未登録の人がいるときだけ、確認に一文を添える', () => {
    expect(missingRealNameNote(0)).toBe('');
    expect(missingRealNameNote(12)).toBe('本名が未登録の12人には、本名の代わりにLINE名が入ります。');
    expect(confirmSendMessage('土岐店', 100, false, 1, 3)).toContain('本名が未登録の3人には');
    expect(confirmSendMessage('土岐店', 100, false, 1, 0)).not.toContain('本名');
    expect(confirmScheduleMessage('土岐店', 100, false, '10月16日(金) 09:00', 1, 3)).toContain('本名が未登録の3人には');
  });
  it('本名を使っているテキストだけを見つける', () => {
    const m = (text: string): DraftMessage => ({ ...newDraftMessage('text', 'k'), text });
    expect(usesRealName([m('こんにちは{{real_name}}様')])).toBe(true);
    expect(usesRealName([m('こんにちは{{name}}さん'), m('本名なし')])).toBe(false);
    expect(usesRealName([{ ...newDraftMessage('image', 'i'), imageUrl: 'https://x/a.jpg' }])).toBe(false);
  });
});
