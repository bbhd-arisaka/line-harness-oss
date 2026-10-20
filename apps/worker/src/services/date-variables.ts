/**
 * 配信日の差し込み語(Lステップの「配信日」「その他(日数・◯日後の日付)」と同じ)。
 *  - `{{date.<書式>}}`              … 配信する日
 *  - `{{date_plus.<日数>.<書式>}}`   … 配信日から◯日後の日付
 *  - `{{date_until.YYYY-MM-DD}}`    … 配信日から、その日までの日数
 * 書式は、画面の選択肢と同じ8つ(下の DATE_FORMATS)。日付は日本時間。
 */
export const DATE_FORMATS: Record<string, (y: number, m: number, d: number, w: string) => string> = {
  mdw: (_y, m, d, w) => `${m}月${d}日(${w})`,
  ymdw: (y, m, d, w) => `${y}年${m}月${d}日(${w})`,
  md: (_y, m, d) => `${m}月${d}日`,
  ymd: (y, m, d) => `${y}年${m}月${d}日`,
  mdw_s: (_y, m, d, w) => `${m}/${d}(${w})`,
  ymdw_s: (y, m, d, w) => `${y}/${m}/${d}(${w})`,
  md_s: (_y, m, d) => `${m}/${d}`,
  ymd_s: (y, m, d) => `${y}/${m}/${d}`,
};

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

/** 日本時間の「今日」(0時の UTC 日付として持つ) */
function jstToday(now: number): Date {
  const t = new Date(now + 9 * 3_600_000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

function formatDate(date: Date, fmt: string): string | null {
  const f = DATE_FORMATS[fmt];
  if (!f) return null;
  return f(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), WEEKDAY[date.getUTCDay()]);
}

export const DATE_VARIABLE_PATTERN = /\{\{\s*(date\.[a-z_]+|date_plus\.\d{1,4}\.[a-z_]+|date_until\.\d{4}-\d{2}-\d{2})\s*\}\}/g;

export function hasDateVariable(name: string): boolean {
  return /^(date\.[a-z_]+|date_plus\.\d{1,4}\.[a-z_]+|date_until\.\d{4}-\d{2}-\d{2})$/.test(name);
}

/** 本文中の配信日の差し込み語を、日付に置き換える。書式が分からないものは、そのまま残す */
export function renderDateVariables(content: string, now: number = Date.now()): string {
  if (!content.includes('{{')) return content;
  const today = jstToday(now);
  return content.replace(DATE_VARIABLE_PATTERN, (whole, name: string) => {
    if (name.startsWith('date_until.')) {
      const target = Date.parse(`${name.slice('date_until.'.length)}T00:00:00Z`);
      if (Number.isNaN(target)) return whole;
      return String(Math.round((target - today.getTime()) / 86_400_000));
    }
    if (name.startsWith('date_plus.')) {
      const [, days, fmt] = name.split('.');
      const d = new Date(today.getTime() + Number(days) * 86_400_000);
      return formatDate(d, fmt) ?? whole;
    }
    return formatDate(today, name.slice('date.'.length)) ?? whole;
  });
}
