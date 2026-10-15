import { describe, expect, it } from 'vitest';
import {
  broadcastStatusLabel,
  checkMessage,
  checkMessages,
  findUnsupportedTag,
  formTag,
  insertAtSelection,
  fromEditorParts,
  insertCodeIntoParts,
  removeTagPart,
  setPartText,
  toEditorParts,
  MAX_BROADCAST_MESSAGES,
  messageSummary,
  newDraftMessage,
  splitTags,
  toApiMessages,
  type DraftMessage,
  confirmScheduleMessage,
  confirmSendMessage,
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

// 入力欄の中でも、タグは色付きのボックス(コードは見せない)。本文は「文字ブロック→ボックス→文字ブロック…」に分ける
describe('入力欄の文字ブロックとボックス', () => {
  const code = `こんにちは{{name}}さん
回答は${formTag('f-1')}`;
  it('文字ブロックで始まり、文字ブロックで終わる。ボックスの間・端が空でも、文字ブロックを置く', () => {
    const parts = toEditorParts(code);
    expect(parts.map((p) => p.kind)).toEqual(['text', 'tag', 'text', 'tag', 'text']);
    expect(toEditorParts('{{name}}{{name}}').map((p) => p.kind)).toEqual(['text', 'tag', 'text', 'tag', 'text']);
    expect(toEditorParts('')).toEqual([{ kind: 'text', text: '' }]);
    expect(toEditorParts('ただの文')).toEqual([{ kind: 'text', text: 'ただの文' }]);
  });
  it('つなげると、元の本文に戻る(保存される形は変わらない)', () => {
    expect(fromEditorParts(toEditorParts(code))).toBe(code);
    expect(fromEditorParts(toEditorParts('{{name}}{{name}}'))).toBe('{{name}}{{name}}');
    expect(fromEditorParts(toEditorParts('a{{foo}}b'))).toBe('a{{foo}}b');
  });
  it('ボックスの種類(名前・フォーム・その他)が分かる', () => {
    const tags = toEditorParts(`{{name}}${formTag('abc')}{{foo}}`).filter((p) => p.kind === 'tag');
    expect(tags.map((p) => (p.kind === 'tag' ? p.tag.kind : ''))).toEqual(['name', 'form', 'other']);
  });
  it('文字ブロックを書き換える・ボックスを消す', () => {
    const parts = toEditorParts(code);
    expect(setPartText(parts, 0, 'やあ')).toBe(`やあ{{name}}さん
回答は${formTag('f-1')}`);
    expect(setPartText(parts, 1, 'x')).toBe(code); // ボックスの番号を指しても、文字は書き換わらない
    expect(removeTagPart(parts, 1)).toBe(`こんにちはさん
回答は${formTag('f-1')}`);
    expect(removeTagPart(parts, 0)).toBe(code);
  });
  it('ボックスを入れる: カーソルのある文字ブロックの、その位置に。分からないときは最後に', () => {
    const parts = toEditorParts('こんにちは');
    expect(insertCodeIntoParts(parts, NAME_TAG_FOR_TEST, { partIndex: 0, selection: { start: 2, end: 2 } })).toBe('こん{{name}}にちは');
    expect(insertCodeIntoParts(parts, NAME_TAG_FOR_TEST, null)).toBe('こんにちは{{name}}');
    expect(insertCodeIntoParts(toEditorParts('a{{name}}b'), formTag('x'), { partIndex: 2, selection: { start: 1, end: 1 } })).toBe(`a{{name}}b${formTag('x')}`);
    // 指した番号がボックスのとき・範囲外のときは、最後に足す
    expect(insertCodeIntoParts(toEditorParts('a{{name}}b'), 'Z', { partIndex: 1, selection: { start: 0, end: 0 } })).toBe('a{{name}}bZ');
    expect(insertCodeIntoParts(toEditorParts('a'), 'Z', { partIndex: 9, selection: { start: 0, end: 0 } })).toBe('aZ');
  });
});
const NAME_TAG_FOR_TEST = '{{name}}';
