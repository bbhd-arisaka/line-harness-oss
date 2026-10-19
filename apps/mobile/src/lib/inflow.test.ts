import { describe, expect, it } from 'vitest';
import { applyLandingPreset, resolveLandingView, formatPeriod, joinPeriod, otherActions, splitPeriod, tagAddIds, withTagAddIds, type InflowAction } from './inflow';

const tag = (ids: string[], op = 'add', condition: unknown = null): InflowAction => ({ type: 'tag', params: { op, tagIds: ids }, condition });
const text: InflowAction = { type: 'text', params: { content: 'こんにちは' }, condition: null };

describe('流入経路のアクション(アプリで編集するのは「タグを追加」だけ)', () => {
  it('タグの追加を取り出す。はずす・条件つきは含めない。重複は1つ', () => {
    expect(tagAddIds([tag(['a', 'b']), text, tag(['b', 'c']), tag(['x'], 'remove'), tag(['y'], 'add', { and: [] })])).toEqual(['a', 'b', 'c']);
    expect(otherActions([tag(['a']), text, tag(['x'], 'remove')])).toEqual([text, tag(['x'], 'remove')]);
  });
  it('差し替え: ほかのアクションと並びはそのまま。タグの追加は1つにまとめ、最初の場所に置く', () => {
    const before = [text, tag(['a']), tag(['b']), tag(['x'], 'remove')];
    expect(withTagAddIds(before, ['a', 'c'])).toEqual([text, tag(['a', 'c']), tag(['x'], 'remove')]);
    expect(withTagAddIds([text], ['z'])).toEqual([text, tag(['z'])]);
    expect(withTagAddIds(before, [])).toEqual([text, tag(['x'], 'remove')]);
  });
  it('有効期間の日付と時刻', () => {
    expect(joinPeriod('2026-10-20', '09:30')).toBe('2026-10-20T09:30');
    expect(joinPeriod('2026-10-20', null)).toBeNull();
    expect(splitPeriod('2026-10-20T09:30')).toEqual({ dateId: '2026-10-20', timeId: '09:30' });
    expect(splitPeriod(null)).toEqual({ dateId: null, timeId: null });
    expect(formatPeriod('2026-10-20T09:30')).toBe('10月20日 09:30');
    expect(formatPeriod(null)).toBe('');
  });
});

describe('友だち追加ページのデザイン(アプリのプレビュー)', () => {
  it('設定が無ければ既定。背景画像があって、かぶせる濃さが0より大きいときだけ、かぶせる色が付く', () => {
    const d = resolveLandingView({});
    expect(d).toMatchObject({ title: '友達追加して始める', buttonText: 'LINEで開く', showIcon: true, bgImage: null, veil: null, cardBg: 'rgba(255,255,255,1)', cardRadius: 24 });
    const v = resolveLandingView({ bgImageUrl: 'https://example.com/b.jpg', bgOverlayOpacity: 40, cardOpacity: 60, buttonOpacity: 80, colors: { button: '#ff0000', overlay: '#000000' } });
    expect(v.veil).toBe('rgba(0,0,0,0.4)');
    expect(v.cardBg).toBe('rgba(255,255,255,0.6)');
    expect(v.buttonBg).toBe('rgba(255,0,0,0.8)');
    expect(resolveLandingView({ bgOverlayOpacity: 40 }).veil).toBeNull();
    expect(resolveLandingView({ bgImageUrl: 'http://example.com/b.jpg' }).bgImage).toBeNull(); // https 以外は使わない
  });
  it('表示しない設定: 注意書き・うまく開けない方は', () => {
    expect(resolveLandingView({ showHint: false, showHelp: false })).toMatchObject({ hintText: null, helpText: null });
    expect(resolveLandingView({ helpText: '開けない場合', helpLinkText: 'ここ' }).helpText).toBe('開けない場合 ここ');
  });
  it('ひな形: 色・透過・角丸を入れ替え、文言・画像・表示の切り替えは残す。「標準」で、色などが既定に戻る', () => {
    const base = { title: 'T', bgImageUrl: 'https://example.com/b.jpg', showHint: false, colors: { button: '#ff0000' }, cardOpacity: 50 };
    const glass = applyLandingPreset(base, 'glass');
    expect(glass).toMatchObject({ title: 'T', bgImageUrl: 'https://example.com/b.jpg', showHint: false, cardOpacity: 68, cardBlur: 14 });
    expect(glass.colors?.button).toBe('#06c755');
    const std = applyLandingPreset(base, 'standard');
    expect(std).toEqual({ title: 'T', bgImageUrl: 'https://example.com/b.jpg', showHint: false });
    expect(applyLandingPreset(base, 'nope')).toBe(base);
  });
});
