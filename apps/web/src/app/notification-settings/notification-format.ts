import type { NotificationScheduleItem } from '@/lib/api'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** 一覧の「スケジュール」列。 */
export function describeSchedule(schedule: NotificationScheduleItem): string {
  if (schedule.mode === 'always') return '常に通知'
  const days = [...schedule.days].sort((a, b) => a - b)
  const dayText = days.length === 7 ? '毎日' : days.map((d) => DAY_LABELS[d]).join('')
  const overnight = schedule.from > schedule.to
  return `${dayText} ${schedule.from}〜${overnight ? '翌' : ''}${schedule.to}`
}

/** 一覧の「内容」列。先頭の2件だけ出して、残りは「他N件」にする。 */
export function summarizeTimings(timings: { key: string }[], labels: Map<string, string>): string {
  if (timings.length === 0) return '未設定'
  const names = timings.map((t) => labels.get(t.key) ?? t.key)
  return names.length <= 2 ? names.join('、') : `${names.slice(0, 2).join('、')} 他${names.length - 2}件`
}
