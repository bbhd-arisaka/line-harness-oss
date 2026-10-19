import { describe, expect, it } from 'vitest';
import { formatPeriod, joinPeriod, otherActions, splitPeriod, tagAddIds, withTagAddIds, type InflowAction } from './inflow';

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
