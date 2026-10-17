import { describe, expect, it } from 'vitest';
import { alertRoute, barRatios, minutesLabel, monthDay, num, parseChatFilter, signed, type HomeAlert } from './home';

describe('ホームの表示用の計算', () => {
  it('分を、読みやすい時間に', () => {
    expect(minutesLabel(0)).toBe('0分');
    expect(minutesLabel(32)).toBe('32分');
    expect(minutesLabel(60)).toBe('1時間');
    expect(minutesLabel(80)).toBe('1時間20分');
  });
  it('増減の符号・桁区切り・月日', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(-2)).toBe('−2');
    expect(signed(0)).toBe('±0');
    expect(num(1234)).toBe('1,234');
    expect(monthDay('2026-10-08')).toBe('10/8');
  });
  it('お知らせをタップしたときの行き先', () => {
    const base: HomeAlert = { id: 'x', severity: 'warning', title: 't' };
    expect(alertRoute(base)).toBeNull();
    expect(alertRoute({ ...base, target: { kind: 'chats', status: 'unread' } })).toEqual({ kind: 'chats', filter: 'unread' });
    expect(alertRoute({ ...base, target: { kind: 'broadcasts' } })).toEqual({ kind: 'tab', name: 'broadcasts' });
    expect(alertRoute({ ...base, target: { kind: 'friends' } })).toEqual({ kind: 'tab', name: 'friends' });
  });
  it('トーク一覧の絞り込みの引数: 決まった3つだけ受け付ける', () => {
    expect(parseChatFilter('unread')).toBe('unread');
    expect(parseChatFilter(['in_progress'])).toBe('in_progress');
    expect(parseChatFilter('resolved')).toBe('resolved');
    expect(parseChatFilter('all')).toBeNull();
    expect(parseChatFilter(undefined)).toBeNull();
    expect(parseChatFilter('<script>')).toBeNull();
  });
  it('棒グラフの高さ: いちばん大きい値を 1 に。全部 0 でも壊れない', () => {
    const rows = [
      { date: '2026-10-17', added: 2, blocked: 0, delta: 2, active: 10 },
      { date: '2026-10-18', added: 4, blocked: 1, delta: 3, active: 13 },
    ];
    expect(barRatios(rows)).toEqual([{ up: 0.5, down: 0 }, { up: 1, down: 0.25 }]);
    expect(barRatios([{ date: 'd', added: 0, blocked: 0, delta: 0, active: 0 }])).toEqual([{ up: 0, down: 0 }]);
  });
});
