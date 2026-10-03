import { describe, expect, it } from 'vitest';
import { charLength, draftFromFriend, planProfileUpdate } from './profile';

const current = { realName: '山田 花子', systemDisplayName: null, memo: '常連' };

describe('draftFromFriend', () => {
  it('null は空文字にする', () => {
    expect(draftFromFriend(current)).toEqual({ realName: '山田 花子', systemDisplayName: '', memo: '常連' });
  });
});

describe('planProfileUpdate', () => {
  it('変更がなければ送らない(空白だけの違いも変更ではない)', () => {
    expect(planProfileUpdate(current, draftFromFriend(current))).toEqual({ ok: true, changed: false });
    expect(planProfileUpdate(current, { realName: ' 山田 花子 ', systemDisplayName: '  ', memo: '常連\n' })).toEqual({ ok: true, changed: false });
  });

  it('変えた項目だけ、前後の空白を取って送る', () => {
    expect(planProfileUpdate(current, { realName: '山田 花子', systemDisplayName: ' はなちゃん ', memo: '常連' })).toEqual({
      ok: true,
      changed: true,
      input: { systemDisplayName: 'はなちゃん' },
    });
  });

  it('空にした項目は null で送る(消す)', () => {
    expect(planProfileUpdate(current, { realName: '', systemDisplayName: '', memo: '' })).toEqual({
      ok: true,
      changed: true,
      input: { realName: null, memo: null },
    });
  });

  it('本名・システム表示名は 20 文字まで(絵文字も 1 文字)', () => {
    const twenty = 'あ'.repeat(20);
    expect(planProfileUpdate(current, { realName: twenty, systemDisplayName: '', memo: '常連' })).toMatchObject({ ok: true, changed: true });
    expect(planProfileUpdate(current, { realName: `${twenty}あ`, systemDisplayName: '', memo: '常連' })).toEqual({
      ok: false,
      error: '本名は20文字以内で入力してください',
    });
    expect(planProfileUpdate(current, { realName: '山田 花子', systemDisplayName: '😀'.repeat(21), memo: '常連' })).toEqual({
      ok: false,
      error: 'システム表示名は20文字以内で入力してください',
    });
    expect(planProfileUpdate(current, { realName: '山田 花子', systemDisplayName: '😀'.repeat(20), memo: '常連' })).toMatchObject({ ok: true });
  });

  it('メモは文字数の制限なし・改行を保つ', () => {
    const memo = '1行目\n2行目\n' + 'あ'.repeat(500);
    expect(planProfileUpdate(current, { ...draftFromFriend(current), memo })).toEqual({ ok: true, changed: true, input: { memo } });
  });
});

describe('charLength', () => {
  it('サロゲートペアを 1 文字と数える', () => {
    expect(charLength('😀a')).toBe(2);
  });
});
