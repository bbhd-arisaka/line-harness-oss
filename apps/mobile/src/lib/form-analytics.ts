// フォーム分析(ホーム → フォーム分析)の、画面に依存しない部分。サーバー(GET /api/home/form-analytics)の形と、足し合わせの計算。
// サーバーは「フォーム×月の回答数」だけを返し、全体・フォーム別・フォルダ別・期間別は、ここで足し合わせる(切り替えてもサーバーを呼ばない)。

export type FormAnalyticsForm = { id: string; name: string; folder: string | null; counts: Record<string, number> };
/** お気に入りの項目。月(YYYY-MM)→その項目に答えた人数 / 選択肢ごとの、選んだ人数 */
export type FavoriteField = {
  formId: string;
  formName: string;
  fieldName: string;
  label: string;
  answered: Record<string, number>;
  options: Array<{ value: string; counts: Record<string, number> }>;
};
export type FormAnalytics = { accountId: string; generatedAt: string; currentMonth: string; forms: FormAnalyticsForm[]; favorites?: FavoriteField[] };

export type Period = 'thisMonth' | 'lastMonth' | 'last3' | 'last12' | 'all';
export type GroupBy = 'form' | 'folder';

export const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'thisMonth', label: '今月' },
  { key: 'lastMonth', label: '先月' },
  { key: 'last3', label: '3か月' },
  { key: 'last12', label: '1年' },
  { key: 'all', label: '全期間' },
];

/** フォルダに入っていないフォームのまとまり */
export const NO_FOLDER = 'フォルダなし';
/** 月別の棒グラフに出す月数(いまの月を含む) */
export const CHART_MONTHS = 12;

/** 'YYYY-MM' の n か月後(負なら前) */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** 指定の月から、さかのぼって n か月分(古い順) */
export function lastMonths(currentMonth: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(currentMonth, -i));
  return out;
}

/** 期間に入る月の一覧。全期間は null(すべての月) */
export function periodMonths(currentMonth: string, period: Period): string[] | null {
  switch (period) {
    case 'thisMonth': return [currentMonth];
    case 'lastMonth': return [shiftMonth(currentMonth, -1)];
    case 'last3': return lastMonths(currentMonth, 3);
    case 'last12': return lastMonths(currentMonth, 12);
    case 'all': return null;
  }
}

export function sumCounts(counts: Record<string, number>, months: string[] | null): number {
  if (!months) return Object.values(counts).reduce((a, b) => a + b, 0);
  return months.reduce((a, m) => a + (counts[m] ?? 0), 0);
}

export type FormRow = { key: string; label: string; count: number; total: number };

function groupKey(f: FormAnalyticsForm, groupBy: GroupBy): string {
  return groupBy === 'folder' ? (f.folder ?? NO_FOLDER) : f.id;
}

/** 一覧の行(その期間の回答の多い順)。フォーム別またはフォルダ別。その期間に回答が無くても、全期間で回答があれば0件で出す */
export function buildRows(data: FormAnalytics, period: Period, groupBy: GroupBy): FormRow[] {
  const months = periodMonths(data.currentMonth, period);
  const groups = new Map<string, FormRow>();
  for (const f of data.forms) {
    const key = groupKey(f, groupBy);
    const row = groups.get(key) ?? { key, label: groupBy === 'folder' ? key : f.name, count: 0, total: 0 };
    row.count += sumCounts(f.counts, months);
    row.total += sumCounts(f.counts, null);
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.total - a.total || a.label.localeCompare(b.label, 'ja'));
}

/** 選んだ行(なければ全体)に含まれるフォーム */
export function selectForms(data: FormAnalytics, groupBy: GroupBy, selectedKey: string | null): FormAnalyticsForm[] {
  if (!selectedKey) return data.forms;
  return data.forms.filter((f) => groupKey(f, groupBy) === selectedKey);
}

export type MonthBar = { month: string; count: number };

/** 月別の棒グラフ(古い順・回答の無い月は0) */
export function buildMonthBars(forms: FormAnalyticsForm[], currentMonth: string, n: number = CHART_MONTHS): MonthBar[] {
  return lastMonths(currentMonth, n).map((month) => ({ month, count: forms.reduce((a, f) => a + (f.counts[month] ?? 0), 0) }));
}

export function totalFor(forms: FormAnalyticsForm[], currentMonth: string, period: Period): number {
  const months = periodMonths(currentMonth, period);
  return forms.reduce((a, f) => a + sumCounts(f.counts, months), 0);
}

/** 前の同じ長さの期間の合計(今月→先月・先月→先々月・3か月→その前の3か月)。全期間は比べない */
export function previousTotal(forms: FormAnalyticsForm[], currentMonth: string, period: Period): number | null {
  const n = period === 'thisMonth' || period === 'lastMonth' ? 1 : period === 'last3' ? 3 : period === 'last12' ? 12 : 0;
  if (n === 0) return null;
  const end = shiftMonth(currentMonth, period === 'lastMonth' ? -1 - n : -n);
  const months = lastMonths(end, n);
  return forms.reduce((a, f) => a + sumCounts(f.counts, months), 0);
}

/** 'YYYY-MM' → '10月'(1月だけ '2027年1月') */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y}年1月` : `${m}月`;
}

export function hasFolders(data: FormAnalytics): boolean {
  return data.forms.some((f) => f.folder);
}

export type FavoriteRow = { value: string; count: number; /** 答えた人のうち、その選択肢を選んだ割合(0〜100・整数) */ percent: number };
export type FavoriteSummary = { field: FavoriteField; answered: number; rows: FavoriteRow[] };

/**
 * お気に入りの項目ごとの、期間内の回答人数と、選択肢ごとの人数・割合。
 * 割合は「その項目に答えた人」に対するもの(チェックボックスは複数選べるので、合計が100%を超えることがある)。選択肢は、フォームの並び順。
 * 選んだフォーム(フォルダ)があれば、そのフォームの項目だけ。
 */
export function favoriteSummaries(data: FormAnalytics, period: Period, forms: FormAnalyticsForm[]): FavoriteSummary[] {
  const months = periodMonths(data.currentMonth, period);
  const ids = new Set(forms.map((f) => f.id));
  return (data.favorites ?? [])
    .filter((f) => ids.has(f.formId))
    .map((field) => {
      const answered = sumCounts(field.answered, months);
      const rows = field.options.map((o) => {
        const count = sumCounts(o.counts, months);
        return { value: o.value, count, percent: answered > 0 ? Math.round((count / answered) * 100) : 0 };
      });
      return { field, answered, rows };
    });
}
