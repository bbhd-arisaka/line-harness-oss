import { describe, expect, it } from 'vitest';
import { buildAnswerCardContent, expandAnswerCardText } from '../src/forms';

const ctx = { formId: 'F1', formName: 'ご予約アンケート', submissionId: 'S1', friendName: '山田太郎' };

describe('buildAnswerCardContent(回答カードの文言)', () => {
  it('オフ・未設定なら null(カードを出さない)', () => {
    expect(buildAnswerCardContent(null, ctx)).toBeNull();
    expect(buildAnswerCardContent('{}', ctx)).toBeNull();
    expect(buildAnswerCardContent(JSON.stringify({ answerCard: { enabled: false, title: 'x' } }), ctx)).toBeNull();
    expect(buildAnswerCardContent('not json', ctx)).toBeNull();
  });
  it('オンで文言が空なら、既定の文言になる', () => {
    const c = buildAnswerCardContent(JSON.stringify({ answerCard: { enabled: true } }), ctx);
    expect(c).toEqual({ formId: 'F1', formName: 'ご予約アンケート', submissionId: 'S1', title: 'ご予約アンケートに回答しました', body: '', buttonLabel: '回答結果を見る' });
  });
  it('自分で決めた文言を使う。{{name}} と {{form}} が置き換わる', () => {
    const c = buildAnswerCardContent(
      JSON.stringify({ answerCard: { enabled: true, title: '{{name}}さんから回答が届きました', body: '「{{form}}」の結果です', buttonLabel: '結果を開く' } }),
      ctx,
    );
    expect(c).toMatchObject({ title: '山田太郎さんから回答が届きました', body: '「ご予約アンケート」の結果です', buttonLabel: '結果を開く' });
  });
  it('長すぎる文言は切る', () => {
    const c = buildAnswerCardContent(JSON.stringify({ answerCard: { enabled: true, title: 'あ'.repeat(300), body: 'い'.repeat(500), buttonLabel: 'う'.repeat(50) } }), ctx);
    expect(Array.from(c!.title)).toHaveLength(100);
    expect(Array.from(c!.body)).toHaveLength(300);
    expect(Array.from(c!.buttonLabel)).toHaveLength(20);
  });
  it('知らない {{...}} はそのまま', () => {
    expect(expandAnswerCardText('{{x}} {{ name }} {{form}}', { name: 'A', form: 'B' })).toBe('{{x}} A B');
  });
});
