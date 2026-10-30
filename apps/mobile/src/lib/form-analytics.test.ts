import { describe, expect, it } from 'vitest';
import { buildMonthBars, buildRows, hasFolders, lastMonths, monthLabel, NO_FOLDER, periodMonths, previousTotal, selectForms, shiftMonth, totalFor, type FormAnalytics } from './form-analytics';

const data: FormAnalytics = {
  accountId: 'a1',
  generatedAt: '2026-10-18T03:00:00.000Z',
  currentMonth: '2026-10',
  forms: [
    { id: 'F1', name: '面談予約', folder: '面談', counts: { '2026-10': 2, '2026-09': 1, '2025-11': 4 } },
    { id: 'F2', name: 'アンケート', folder: null, counts: { '2026-10': 1, '2026-08': 5 } },
    { id: 'F3', name: '面談事前', folder: '面談', counts: { '2026-07': 2 } },
  ],
};

describe('月の計算', () => {
  it('年をまたぐ', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(lastMonths('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
  it('期間', () => {
    expect(periodMonths('2026-10', 'thisMonth')).toEqual(['2026-10']);
    expect(periodMonths('2026-10', 'lastMonth')).toEqual(['2026-09']);
    expect(periodMonths('2026-10', 'last3')).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(periodMonths('2026-10', 'last12')).toHaveLength(12);
    expect(periodMonths('2026-10', 'all')).toBeNull();
  });
  it('月の表示', () => {
    expect(monthLabel('2026-10')).toBe('10月');
    expect(monthLabel('2027-01')).toBe('2027年1月');
  });
});

describe('フォーム別・フォルダ別', () => {
  it('フォーム別: 期間の回答数の多い順。期間に無くても、全期間で回答があれば0件で出る', () => {
    expect(buildRows(data, 'thisMonth', 'form').map((r) => [r.label, r.count, r.total])).toEqual([
      ['面談予約', 2, 7],
      ['アンケート', 1, 6],
      ['面談事前', 0, 2],
    ]);
  });
  it('フォルダ別: フォルダごとに足し、フォルダの無いものはまとめる', () => {
    expect(buildRows(data, 'last3', 'folder').map((r) => [r.label, r.count])).toEqual([
      [NO_FOLDER, 6],
      ['面談', 3],
    ]);
  });
  it('選んだ行だけに絞る', () => {
    expect(selectForms(data, 'form', 'F2').map((f) => f.id)).toEqual(['F2']);
    expect(selectForms(data, 'folder', '面談').map((f) => f.id)).toEqual(['F1', 'F3']);
    expect(selectForms(data, 'folder', NO_FOLDER).map((f) => f.id)).toEqual(['F2']);
    expect(selectForms(data, 'form', null)).toHaveLength(3);
  });
  it('フォルダがあるか', () => {
    expect(hasFolders(data)).toBe(true);
    expect(hasFolders({ ...data, forms: [data.forms[1]] })).toBe(false);
  });
});

describe('合計・月別・前の期間との差', () => {
  it('期間ごとの合計', () => {
    expect(totalFor(data.forms, '2026-10', 'thisMonth')).toBe(3);
    expect(totalFor(data.forms, '2026-10', 'lastMonth')).toBe(1);
    expect(totalFor(data.forms, '2026-10', 'last3')).toBe(9);
    expect(totalFor(data.forms, '2026-10', 'all')).toBe(15);
  });
  it('月別の棒は12か月分・回答のない月は0', () => {
    const bars = buildMonthBars(data.forms, '2026-10');
    expect(bars).toHaveLength(12);
    expect(bars[bars.length - 1]).toEqual({ month: '2026-10', count: 3 });
    expect(bars.find((b) => b.month === '2026-06')?.count).toBe(0);
    expect(bars.find((b) => b.month === '2025-11')?.count).toBe(4);
  });
  it('前の同じ長さの期間: 今月→先月・先月→先々月・3か月→その前の3か月。全期間は無し', () => {
    expect(previousTotal(data.forms, '2026-10', 'thisMonth')).toBe(1);
    expect(previousTotal(data.forms, '2026-10', 'lastMonth')).toBe(5);
    expect(previousTotal(data.forms, '2026-10', 'last3')).toBe(2);
    expect(previousTotal(data.forms, '2026-10', 'all')).toBeNull();
  });
});
