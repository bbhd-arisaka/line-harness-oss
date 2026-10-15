import { describe, expect, it } from 'vitest';
import {
  broadcastStatusLabel,
  checkMessage,
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
  it('内容(アカウント・本文)が同じなら同じ識別、変われば別', () => {
    expect(draftSignature({ accountId: 'A', message: ' hi ' })).toBe(draftSignature({ accountId: 'A', message: 'hi' }));
    expect(draftSignature({ accountId: 'A', message: 'hi' })).not.toBe(draftSignature({ accountId: 'B', message: 'hi' }));
    expect(draftSignature({ accountId: 'A', message: 'hi' })).not.toBe(draftSignature({ accountId: 'A', message: 'ho' }));
  });
});
