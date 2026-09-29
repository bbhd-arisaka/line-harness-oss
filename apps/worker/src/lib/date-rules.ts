// 回答フォームの日付ブロック「入力制限」(Lステップ準拠)の判定。
// サーバー(受付時の検証)と公開フォーム(選択肢の制限)の両方から使う純粋関数。

export type DateBound =
  | { mode: 'none' }
  /** 回答した日を起点に N 日後(0=当日、負数=過去) */
  | { mode: 'relative'; days: number }
  /** 特定の日付(YYYY-MM-DD) */
  | { mode: 'fixed'; date: string };

export interface DateRule {
  start?: DateBound;
  end?: DateBound;
  /** 選択できる曜日(0=日 … 6=土)。空・未指定なら全曜日 */
  weekdays?: number[];
  /**
   * 祝日の扱い
   * - ignore: 考慮しない(曜日だけで判定)
   * - allow : 選択した曜日 + 祝日もOK
   * - deny  : 選択した曜日のうち、祝日はNG
   */
  holiday?: 'ignore' | 'allow' | 'deny';
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** YYYY-MM-DD を「その日の 0:00(ローカル)」に。不正なら null。 */
export function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return formatYmd(d) === s ? d : null
}

function nthMonday(year: number, month: number, n: number): number {
  const first = new Date(year, month - 1, 1).getDay()
  return 1 + ((8 - first) % 7) + (n - 1) * 7
}

function vernalEquinox(y: number): number {
  return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
}
function autumnalEquinox(y: number): number {
  return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
}

const holidayCache = new Map<number, Set<string>>()

/** その年の祝日(振替休日・国民の休日を含む)。1980〜2099年の範囲で有効。 */
export function japaneseHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year)
  if (cached) return cached
  const set = new Set<string>()
  const add = (m: number, d: number) => set.add(`${year}-${pad(m)}-${pad(d)}`)

  add(1, 1) // 元日
  if (year >= 2000) add(1, nthMonday(year, 1, 2)) // 成人の日
  else add(1, 15)
  if (year >= 1967) add(2, 11) // 建国記念の日
  if (year >= 2020) add(2, 23) // 天皇誕生日
  add(3, vernalEquinox(year)) // 春分の日
  add(4, 29) // 昭和の日(みどりの日)
  add(5, 3) // 憲法記念日
  if (year >= 2007) add(5, 4) // みどりの日
  add(5, 5) // こどもの日
  // 海の日
  if (year === 2020) add(7, 23)
  else if (year === 2021) add(7, 22)
  else if (year >= 2003) add(7, nthMonday(year, 7, 3))
  else if (year >= 1996) add(7, 20)
  // 山の日
  if (year === 2020) add(8, 10)
  else if (year === 2021) add(8, 8)
  else if (year >= 2016) add(8, 11)
  // 敬老の日
  if (year >= 2003) add(9, nthMonday(year, 9, 3))
  else add(9, 15)
  add(9, autumnalEquinox(year)) // 秋分の日
  // スポーツの日(体育の日)
  if (year === 2020) add(7, 24)
  else if (year === 2021) add(7, 23)
  else if (year >= 2000) add(10, nthMonday(year, 10, 2))
  else add(10, 10)
  add(11, 3) // 文化の日
  add(11, 23) // 勤労感謝の日
  if (year <= 2018 && year >= 1989) add(12, 23) // 天皇誕生日(平成)

  // 国民の休日: 前日と翌日がどちらも祝日の平日
  const base = [...set]
  for (const s of base) {
    const d = parseYmd(s)!
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2)
    const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    if (set.has(formatYmd(next)) && !set.has(formatYmd(mid)) && mid.getDay() !== 0) set.add(formatYmd(mid))
  }
  // 振替休日: 日曜の祝日は、次の「祝日でない日」に振り替える
  for (const s of [...set]) {
    const d = parseYmd(s)!
    if (d.getDay() !== 0) continue
    let cur = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    while (set.has(formatYmd(cur))) cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
    if (cur.getFullYear() === year) set.add(formatYmd(cur))
  }
  holidayCache.set(year, set)
  return set
}

export function isJapaneseHoliday(d: Date): boolean {
  return japaneseHolidays(d.getFullYear()).has(formatYmd(d))
}

function resolveBound(b: DateBound | undefined, answerDate: Date): Date | null {
  if (!b || b.mode === 'none') return null
  if (b.mode === 'relative') {
    return new Date(answerDate.getFullYear(), answerDate.getMonth(), answerDate.getDate() + b.days)
  }
  return parseYmd(b.date)
}

/** 開始日・終了日(その日を含む)の範囲。 */
export function resolveDateRange(rule: DateRule | undefined, answerDate: Date): { min: Date | null; max: Date | null } {
  return { min: resolveBound(rule?.start, answerDate), max: resolveBound(rule?.end, answerDate) }
}

/** その日付が入力制限を満たすか。満たさなければ理由(表示用)を返す。 */
export function checkDateAgainstRule(value: string, rule: DateRule | undefined, answerDate: Date): string | null {
  const d = parseYmd(value)
  if (!d) return '日付の形式が正しくありません'
  if (!rule) return null
  const { min, max } = resolveDateRange(rule, answerDate)
  if (min && d < min) return `${formatYmd(min).replace(/-/g, '/')} 以降の日付を選択してください`
  if (max && d > max) return `${formatYmd(max).replace(/-/g, '/')} 以前の日付を選択してください`
  const weekdays = rule.weekdays ?? []
  if (weekdays.length > 0) {
    const holiday = isJapaneseHoliday(d)
    const weekdayOk = weekdays.includes(d.getDay())
    const mode = rule.holiday ?? 'ignore'
    const ok = mode === 'allow' ? weekdayOk || holiday : mode === 'deny' ? weekdayOk && !holiday : weekdayOk
    if (!ok) return '選択できない日付です'
  }
  return null
}
