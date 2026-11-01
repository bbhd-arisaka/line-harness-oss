import { describe, expect, it } from 'vitest';
import { buildInflowBars, buildInflowRows, inflowPreviousTotal, inflowTotal, selectInflowRoutes, type InflowAnalytics } from './inflow-analytics';

const data: InflowAnalytics = {
  accountId: 'a1',
  generatedAt: '2026-10-18T03:00:00.000Z',
  currentMonth: '2026-10',
  routes: [
    { id: 'R1', name: 'ホットペッパー', folder: '広告', people: { '2026-10': 3, '2026-09': 1 }, times: { '2026-10': 5, '2026-09': 1 } },
    { id: 'R2', name: 'Instagram', folder: null, people: { '2026-10': 1 }, times: { '2026-10': 2 } },
    { id: 'R3', name: '過去だけ', folder: null, people: { '2026-07': 2 }, times: { '2026-07': 2 } },
  ],
};

describe('流入経路分析の計算', () => {
  it('経路別: 期間の数の多い順・割合は期間内の合計に対して。期間に無くても全期間にあれば0で出す', () => {
    expect(buildInflowRows(data, 'people', 'thisMonth').map((r) => [r.label, r.count, r.percent])).toEqual([
      ['ホットペッパー', 3, 75],
      ['Instagram', 1, 25],
      ['過去だけ', 0, 0],
    ]);
    expect(buildInflowRows(data, 'times', 'thisMonth').map((r) => [r.label, r.count, r.percent])[0]).toEqual(['ホットペッパー', 5, 71]);
  });
  it('合計が0なら、割合は0', () => {
    expect(buildInflowRows({ ...data, currentMonth: '2027-06' }, 'people', 'thisMonth').every((r) => r.percent === 0)).toBe(true);
  });
  it('選んだ経路だけに絞る・合計・前の期間との差', () => {
    expect(selectInflowRoutes(data, 'R2').map((r) => r.id)).toEqual(['R2']);
    expect(selectInflowRoutes(data, null)).toHaveLength(3);
    expect(inflowTotal(data.routes, 'people', '2026-10', 'thisMonth')).toBe(4);
    expect(inflowTotal(data.routes, 'people', '2026-10', 'all')).toBe(7);
    expect(inflowPreviousTotal(data.routes, 'people', '2026-10', 'thisMonth')).toBe(1);
    expect(inflowPreviousTotal(data.routes, 'people', '2026-10', 'all')).toBeNull();
  });
  it('月別の棒は12か月分・数のない月は0', () => {
    const bars = buildInflowBars(data.routes, 'people', '2026-10');
    expect(bars).toHaveLength(12);
    expect(bars[bars.length - 1]).toEqual({ month: '2026-10', count: 4 });
    expect(bars.find((b) => b.month === '2026-08')?.count).toBe(0);
    expect(bars.find((b) => b.month === '2026-07')?.count).toBe(2);
  });
});
