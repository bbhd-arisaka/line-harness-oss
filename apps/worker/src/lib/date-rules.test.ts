import { describe, expect, it } from 'vitest'
import { checkDateAgainstRule, japaneseHolidays, parseYmd, resolveDateRange, type DateRule } from './date-rules'

const answered = parseYmd('2026-09-29')!

describe('japaneseHolidays', () => {
  it('2026年の主な祝日(春分・秋分・ハッピーマンデー)を含む', () => {
    const h = japaneseHolidays(2026)
    expect(h.has('2026-01-01')).toBe(true)
    expect(h.has('2026-01-12')).toBe(true) // 成人の日(1月第2月曜)
    expect(h.has('2026-03-20')).toBe(true) // 春分の日
    expect(h.has('2026-07-20')).toBe(true) // 海の日(7月第3月曜)
    expect(h.has('2026-09-21')).toBe(true) // 敬老の日
    expect(h.has('2026-09-23')).toBe(true) // 秋分の日
    expect(h.has('2026-10-12')).toBe(true) // スポーツの日
  })

  it('日曜の祝日は翌日が振替休日になる', () => {
    // 2026-05-03(憲法記念日)は日曜 → 5/4・5/5 も祝日なので 5/6 が振替休日
    const h = japaneseHolidays(2026)
    expect(h.has('2026-05-06')).toBe(true)
  })

  it('祝日に挟まれた平日は国民の休日になる', () => {
    // 2026-09-22 は敬老の日(9/21)と秋分の日(9/23)の間
    expect(japaneseHolidays(2026).has('2026-09-22')).toBe(true)
  })
})

describe('checkDateAgainstRule', () => {
  it('ルールなしなら形式だけ確認する', () => {
    expect(checkDateAgainstRule('2026-10-01', undefined, answered)).toBeNull()
    expect(checkDateAgainstRule('2026-13-40', undefined, answered)).not.toBeNull()
  })

  it('開始日・終了日(回答日起点と特定日)', () => {
    const rule: DateRule = { start: { mode: 'relative', days: 1 }, end: { mode: 'fixed', date: '2026-10-31' } }
    expect(checkDateAgainstRule('2026-09-29', rule, answered)).not.toBeNull() // 当日は不可
    expect(checkDateAgainstRule('2026-09-30', rule, answered)).toBeNull()
    expect(checkDateAgainstRule('2026-10-31', rule, answered)).toBeNull()
    expect(checkDateAgainstRule('2026-11-01', rule, answered)).not.toBeNull()
    expect(resolveDateRange(rule, answered).min).toEqual(parseYmd('2026-09-30'))
  })

  it('曜日制限と祝日オプション', () => {
    const weekdays = [1, 2, 3, 4, 5] // 平日のみ
    // 2026-10-12 はスポーツの日(月曜・祝日)
    expect(checkDateAgainstRule('2026-10-12', { weekdays, holiday: 'ignore' }, answered)).toBeNull()
    expect(checkDateAgainstRule('2026-10-12', { weekdays, holiday: 'deny' }, answered)).not.toBeNull()
    // 2026-10-10 は土曜(祝日ではない): allow でも祝日ではないので不可
    expect(checkDateAgainstRule('2026-10-10', { weekdays, holiday: 'allow' }, answered)).not.toBeNull()
    // 2026-09-23 は水曜・秋分の日。土日のみ選択可+祝日OKなら選べる
    expect(checkDateAgainstRule('2026-09-23', { weekdays: [0, 6], holiday: 'allow' }, answered)).toBeNull()
    expect(checkDateAgainstRule('2026-09-23', { weekdays: [0, 6], holiday: 'ignore' }, answered)).not.toBeNull()
  })
})
