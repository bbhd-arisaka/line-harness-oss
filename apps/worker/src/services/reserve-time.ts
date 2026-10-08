/**
 * カレンダー予約の、日時の道具。時刻は、すべて日本時間の文字(YYYY-MM-DDTHH:MM)で扱う。
 */

const JST_OFFSET_MS = 9 * 3600 * 1000;

/** 'YYYY-MM-DDTHH:MM'(日本時間)→ 1970年からのミリ秒(日本時間を、UTCとして数えた値。差を取るためだけに使う) */
export function toMs(dt: string): number {
  const [d, t] = dt.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t ?? '00:00').split(':').map(Number);
  return Date.UTC(y, m - 1, day, hh, mm);
}

export function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

export const addMinutes = (dt: string, minutes: number): string => fromMs(toMs(dt) + minutes * 60_000);

export function minutesBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / 60_000);
}

/** いまの日本時間(YYYY-MM-DDTHH:MM) */
export function nowJst(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

export const dateOf = (dt: string): string => dt.slice(0, 10);
export const timeOf = (dt: string): string => dt.slice(11, 16);

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 曜日(0=日曜〜6=土曜) */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export const hhmmToMinutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const minutesToHhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ── 祝日(日本) ──────────────────────────────────────────────────────────────

function nthMonday(year: number, month: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

// 春分・秋分の日(1980〜2099年の近似式)
function vernalEquinox(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function autumnalEquinox(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

const holidayCache = new Map<number, Set<string>>();

function holidaysOfYear(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const base: Array<[number, number]> = [
    [1, 1], // 元日
    [2, 11], // 建国記念の日
    [4, 29], // 昭和の日
    [5, 3], // 憲法記念日
    [5, 4], // みどりの日
    [5, 5], // こどもの日
    [11, 3], // 文化の日
    [11, 23], // 勤労感謝の日
  ];
  if (year >= 2020) base.push([2, 23]); // 天皇誕生日
  if (year >= 2016) base.push([8, 11]); // 山の日
  base.push([3, vernalEquinox(year)]);
  base.push([9, autumnalEquinox(year)]);
  base.push([1, nthMonday(year, 1, 2)]); // 成人の日
  base.push([7, nthMonday(year, 7, 3)]); // 海の日
  base.push([9, nthMonday(year, 9, 3)]); // 敬老の日
  base.push([10, nthMonday(year, 10, 2)]); // スポーツの日
  const set = new Set<string>();
  const fmt = (m: number, d: number) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  for (const [m, d] of base) set.add(fmt(m, d));
  // 振替休日: 祝日が日曜なら、次の祝日でない日(月曜〜)
  for (const key of [...set]) {
    if (weekdayOf(key) === 0) {
      let next = addDays(key, 1);
      while (set.has(next)) next = addDays(next, 1);
      set.add(next);
    }
  }
  // 国民の休日: 前後が祝日にはさまれた平日
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 31; d++) {
      const date = fmt(m, d);
      if (new Date(`${date}T00:00:00Z`).getUTCMonth() + 1 !== m) continue;
      if (set.has(date) || weekdayOf(date) === 0) continue;
      if (set.has(addDays(date, -1)) && set.has(addDays(date, 1))) set.add(date);
    }
  }
  holidayCache.set(year, set);
  return set;
}

export function isJapaneseHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  if (year < 2000 || year > 2099) return false;
  return holidaysOfYear(year).has(date);
}
