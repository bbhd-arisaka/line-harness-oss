// 流入経路分析(ホーム → 流入経路分析)の、画面に依存しない部分。サーバー(GET /api/home/inflow-analytics)の形と、足し合わせの計算。
// サーバーは「経路×月の人数・回数」だけを返し、期間・絞り込みの足し合わせは、ここで行う(切り替えてもサーバーを呼ばない)。
import { CHART_MONTHS, lastMonths, periodMonths, shiftMonth, sumCounts, type Period } from './form-analytics';

export type InflowAnalyticsRoute = {
  id: string;
  name: string;
  folder: string | null;
  /** 月(YYYY-MM)→その経路から入った人数(同じ人は、その経路を最初に使った月に1回だけ) */
  people: Record<string, number>;
  /** 月(YYYY-MM)→その経路が読み取られた回数 */
  times: Record<string, number>;
};
export type InflowAnalytics = { accountId: string; generatedAt: string; currentMonth: string; routes: InflowAnalyticsRoute[] };

/** 人数(その経路で入った人) / 回数(読み取られた回数) */
export type InflowMetric = 'people' | 'times';

export const INFLOW_METRICS: Array<{ key: InflowMetric; label: string; unit: string }> = [
  { key: 'people', label: '人数', unit: '人' },
  { key: 'times', label: '回数', unit: '回' },
];

export type InflowRow = {
  id: string;
  label: string;
  folder: string | null;
  count: number;
  /** 全期間の数(期間に無くても、全期間にあれば0で出すための並び替え用) */
  total: number;
  /** 期間内の全経路の合計に対する割合(0〜100・整数)。合計が0なら0 */
  percent: number;
};

/** 経路の一覧(その期間の数の多い順)。期間の数が0でも、全期間で数があれば出す */
export function buildInflowRows(data: InflowAnalytics, metric: InflowMetric, period: Period): InflowRow[] {
  const months = periodMonths(data.currentMonth, period);
  const rows = data.routes.map((r) => ({
    id: r.id,
    label: r.name,
    folder: r.folder,
    count: sumCounts(r[metric], months),
    total: sumCounts(r[metric], null),
    percent: 0,
  }));
  const sum = rows.reduce((a, r) => a + r.count, 0);
  for (const r of rows) r.percent = sum > 0 ? Math.round((r.count / sum) * 100) : 0;
  return rows.sort((a, b) => b.count - a.count || b.total - a.total || a.label.localeCompare(b.label, 'ja'));
}

/** 選んだ経路(なければ全体) */
export function selectInflowRoutes(data: InflowAnalytics, selectedId: string | null): InflowAnalyticsRoute[] {
  return selectedId ? data.routes.filter((r) => r.id === selectedId) : data.routes;
}

export function inflowTotal(routes: InflowAnalyticsRoute[], metric: InflowMetric, currentMonth: string, period: Period): number {
  const months = periodMonths(currentMonth, period);
  return routes.reduce((a, r) => a + sumCounts(r[metric], months), 0);
}

/** 前の同じ長さの期間の合計(今月→先月・先月→先々月・3か月→その前の3か月)。全期間は比べない */
export function inflowPreviousTotal(routes: InflowAnalyticsRoute[], metric: InflowMetric, currentMonth: string, period: Period): number | null {
  const n = period === 'thisMonth' || period === 'lastMonth' ? 1 : period === 'last3' ? 3 : period === 'last12' ? 12 : 0;
  if (n === 0) return null;
  const end = shiftMonth(currentMonth, period === 'lastMonth' ? -1 - n : -n);
  const months = lastMonths(end, n);
  return routes.reduce((a, r) => a + sumCounts(r[metric], months), 0);
}

export type InflowBar = { month: string; count: number };

/** 月別の棒グラフ(古い順・数のない月は0) */
export function buildInflowBars(routes: InflowAnalyticsRoute[], metric: InflowMetric, currentMonth: string, n: number = CHART_MONTHS): InflowBar[] {
  return lastMonths(currentMonth, n).map((month) => ({ month, count: routes.reduce((a, r) => a + (r[metric][month] ?? 0), 0) }));
}

/** 経路を読み取った1件(詳細画面の1行) */
export type InflowHit = { id: string; friendId: string | null; friendName: string; mark: string; at: string };
export type InflowStats = { total: number; people: number; page: number; pageSize: number; rows: InflowHit[]; route: { id: string; name: string } };
