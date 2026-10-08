// カレンダー予約(Lステップのカレンダー予約と同じ画面)の型と、APIの呼び出し。
// サーバー側の型は packages/db/src/reserve.ts・reserve-settings.ts。

import { fetchApi } from './api'
import type { FriendAddActionItem } from './friend-add-actions'
import type { FriendFilter } from './friend-filter'

export type ApiRes<T> = { success: true; data: T } | { success: false; error: string; code?: string }

export type TimeRange = { from: string; to: string }
export type DayRule = { closed: boolean; allDay: boolean; ranges: TimeRange[] }
export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'holiday'
export const WEEKDAYS: Array<{ key: WeekdayKey; label: string }> = [
  { key: 'mon', label: '月曜日' },
  { key: 'tue', label: '火曜日' },
  { key: 'wed', label: '水曜日' },
  { key: 'thu', label: '木曜日' },
  { key: 'fri', label: '金曜日' },
  { key: 'sat', label: '土曜日' },
  { key: 'sun', label: '日曜日' },
  { key: 'holiday', label: '祝日' },
]
export type DeadlineKey = 'start' | '1h' | '3h' | '6h' | '12h' | '24h' | '1d' | '2d' | '3d' | '4d' | '5d' | '6d' | '1w' | '10d' | '2w'
export const DEADLINE_OPTIONS: Array<{ value: DeadlineKey; label: string }> = [
  { value: 'start', label: '予約時間開始まで' },
  { value: '1h', label: '1時間前まで' },
  { value: '3h', label: '3時間前まで' },
  { value: '6h', label: '6時間前まで' },
  { value: '12h', label: '12時間前まで' },
  { value: '24h', label: '24時間前まで' },
  { value: '1d', label: '前日まで' },
  { value: '2d', label: '2日前まで' },
  { value: '3d', label: '3日前まで' },
  { value: '4d', label: '4日前まで' },
  { value: '5d', label: '5日前まで' },
  { value: '6d', label: '6日前まで' },
  { value: '1w', label: '1週間前まで' },
  { value: '10d', label: '10日前まで' },
  { value: '2w', label: '2週間前まで' },
]
export type RelativeUnit = 'days' | 'hours' | 'minutes'

export interface ReceptionSettings {
  hoursMode: 'daily' | 'weekday'
  daily: DayRule
  weekdays: Record<WeekdayKey, DayRule>
  specialDays: Array<DayRule & { date: string }>
  start: { mode: 'relative'; amount: number; unit: RelativeUnit } | { mode: 'at'; at: string } | { mode: 'always' }
  deadline: { mode: 'relative'; amount: number; unit: RelativeUnit; time: string | null } | { mode: 'at'; at: string } | { mode: 'until_start' }
  changeDeadline: DeadlineKey
  cancelDeadline: DeadlineKey
  totalCapacity: number | null
  approval: { newBooking: 'auto' | 'request'; change: 'allow' | 'deny' | 'request'; cancel: 'allow' | 'deny' | 'request' }
}

export interface SlotSettings {
  title: string
  required: boolean
  priceEnabled: boolean
  defaultCapacity: number | null
  shiftLinked: boolean
  autoAssign: boolean
}
export interface CourseSettings {
  title: string
  required: boolean
  priceEnabled: boolean
  showDuration: boolean
  unspecifiedMinutes: number
}

export type FieldType = 'text' | 'textarea' | 'select'
export type TextKind = 'none' | 'name' | 'kana' | 'email' | 'phone' | 'integer'
export interface ScreenField {
  id: string
  label: string
  description: string
  type: FieldType
  textKind: TextKind
  options: string[]
  required: boolean
  friendFieldKey: string | null
  linkGoogle: boolean
  linkRealName: boolean
}
export interface ScreenSettings {
  view: 'week' | 'month'
  unitMinutes: number
  adminInfo: { show: boolean; imageUrl: string; name: string; address: string; phone: string; description: string }
  consent: { show: boolean; title: string; body: string }
  thanksUrls: { complete: string; change: string; cancel: string }
  fields: ScreenField[]
}

export const ACTION_KEYS = [
  'onBooked',
  'onChanged',
  'onCancelled',
  'requestNewSubmitted',
  'requestNewApproved',
  'requestNewRejected',
  'requestChangeSubmitted',
  'requestChangeApproved',
  'requestChangeRejected',
  'requestCancelSubmitted',
  'requestCancelApproved',
  'requestCancelRejected',
] as const
export type ReserveActionKey = (typeof ACTION_KEYS)[number]
export type ReserveActions = Record<ReserveActionKey, FriendAddActionItem[]> & { runActionsByDefault: boolean }

export interface ReminderItem {
  id: string
  kind: 'time' | 'remaining'
  daysBefore: number
  time: string
  amount: number
  unit: 'hours' | 'minutes'
  actions: FriendAddActionItem[]
}
export interface FollowItem {
  id: string
  kind: 'time' | 'elapsed'
  daysAfter: number
  time: string
  amount: number
  unit: 'hours' | 'minutes'
  actions: FriendAddActionItem[]
}
export interface ReminderSettings {
  enabled: boolean
  enabledAt: string | null
  items: ReminderItem[]
}
export interface FollowSettings {
  enabled: boolean
  enabledAt: string | null
  items: FollowItem[]
}
export interface ExternalSettings {
  google: { enabled: boolean; connectionId: string | null; target: 'all' | 'bookings' | 'shift' }
}

export interface ReserveCalendar {
  id: string
  lineAccountId: string
  name: string
  status: 'active' | 'stopped'
  reception: ReceptionSettings
  slotSettings: SlotSettings
  courseSettings: CourseSettings
  screen: ScreenSettings
  actions: ReserveActions
  reminders: ReminderSettings
  follow: FollowSettings
  external: ExternalSettings
}
export type CalendarSection = 'reception' | 'slotSettings' | 'courseSettings' | 'screen' | 'actions' | 'reminders' | 'follow' | 'external'

export interface ReserveSlot {
  id: string
  calendarId: string
  name: string
  visible: boolean
  price: number
  capacity: number | null
  autoAssign: boolean
  priority: number
  description: string
  descriptionHtml: boolean
  condition: FriendFilter | null
  sortOrder: number
}
export interface ReserveCourse {
  id: string
  calendarId: string
  name: string
  color: string
  durationMinutes: number
  displayMinutes: number | null
  price: number
  visible: boolean
  description: string
  descriptionHtml: boolean
  condition: FriendFilter | null
  sortOrder: number
}
export interface ReserveShift {
  id: string
  calendarId: string
  slotId: string
  seriesId: string | null
  workDate: string
  startTime: string
  endTime: string
  memo: string
}

export type BookingStatus = 'confirmed' | 'pending' | 'cancelled' | 'rejected'
export interface ReserveBooking {
  id: string
  calendarId: string
  friendId: string | null
  slotId: string | null
  courseId: string | null
  isBlock: boolean
  startsAt: string
  endsAt: string
  displayEndsAt: string | null
  status: BookingStatus
  pendingKind: 'new' | 'change' | 'cancel' | null
  pendingPayload: Record<string, unknown> | null
  followupStatus: string | null
  visited: boolean
  visitedAt: string | null
  followState: 'none' | 'running' | 'done'
  createdBy: 'friend' | 'admin'
  answers: Record<string, string>
  guestName: string | null
  price: number
  slotPriceApplied: boolean
  memo: string
  requestedAt: string
  name?: string
  friend?: { id: string; displayName: string | null; realName: string | null; systemDisplayName: string | null; pictureUrl: string | null } | null
}

export interface CalendarBundle {
  calendar: ReserveCalendar
  slots: ReserveSlot[]
  courses: ReserveCourse[]
  links: Array<{ slotId: string; courseId: string }>
  siteLinks: Array<{ id: string; slotId: string | null; courseId: string | null; createdAt: string }>
  pendingCount: number
  reserveUrl: string | null
  historyUrl: string | null
}

export interface CalendarListItem {
  id: string
  name: string
  status: 'active' | 'stopped'
  pendingCount: number
  reserveUrl: string | null
  historyUrl: string | null
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })
const enc = encodeURIComponent

export interface BookingQuery {
  from?: string
  to?: string
  slotIds?: string[]
  courseIds?: string[]
  statuses?: BookingStatus[]
  includeBlocks?: boolean
  q?: string
  visited?: boolean
  limit?: number
  offset?: number
  order?: 'asc' | 'desc'
}

function bookingQs(q: BookingQuery): string {
  const p = new URLSearchParams()
  if (q.from) p.set('from', q.from)
  if (q.to) p.set('to', q.to)
  if (q.slotIds?.length) p.set('slotIds', q.slotIds.join(','))
  if (q.courseIds?.length) p.set('courseIds', q.courseIds.join(','))
  if (q.statuses?.length) p.set('statuses', q.statuses.join(','))
  if (q.includeBlocks) p.set('includeBlocks', '1')
  if (q.q) p.set('q', q.q)
  if (q.visited !== undefined) p.set('visited', q.visited ? '1' : '0')
  if (q.limit) p.set('limit', String(q.limit))
  if (q.offset) p.set('offset', String(q.offset))
  if (q.order) p.set('order', q.order)
  return p.toString()
}

export const reserveApi = {
  list: (lineAccountId: string) => fetchApi<ApiRes<CalendarListItem[]>>(`/api/reserve/calendars?lineAccountId=${enc(lineAccountId)}`),
  create: (lineAccountId: string, name: string) => fetchApi<ApiRes<{ id: string }>>('/api/reserve/calendars', { method: 'POST', ...json({ lineAccountId, name }) }),
  get: (id: string) => fetchApi<ApiRes<CalendarBundle>>(`/api/reserve/calendars/${id}`),
  patch: (id: string, body: { name?: string; status?: 'active' | 'stopped' }) => fetchApi<ApiRes<null>>(`/api/reserve/calendars/${id}`, { method: 'PATCH', ...json(body) }),
  copy: (id: string, name: string) => fetchApi<ApiRes<{ id: string }>>(`/api/reserve/calendars/${id}/copy`, { method: 'POST', ...json({ name }) }),
  remove: (id: string) => fetchApi<ApiRes<null>>(`/api/reserve/calendars/${id}`, { method: 'DELETE' }),
  saveSection: (id: string, section: CalendarSection, body: unknown) => fetchApi<ApiRes<unknown>>(`/api/reserve/calendars/${id}/settings/${section}`, { method: 'PUT', ...json(body) }),
  createSlot: (id: string, body: Partial<ReserveSlot>) => fetchApi<ApiRes<ReserveSlot>>(`/api/reserve/calendars/${id}/slots`, { method: 'POST', ...json(body) }),
  updateSlot: (slotId: string, body: Partial<ReserveSlot>) => fetchApi<ApiRes<ReserveSlot>>(`/api/reserve/slots/${slotId}`, { method: 'PUT', ...json(body) }),
  duplicateSlot: (slotId: string) => fetchApi<ApiRes<ReserveSlot>>(`/api/reserve/slots/${slotId}/duplicate`, { method: 'POST' }),
  deleteSlot: (slotId: string) => fetchApi<ApiRes<null>>(`/api/reserve/slots/${slotId}`, { method: 'DELETE' }),
  orderSlots: (id: string, ids: string[]) => fetchApi<ApiRes<null>>(`/api/reserve/calendars/${id}/slots-order`, { method: 'PUT', ...json({ ids }) }),
  createCourse: (id: string, body: Partial<ReserveCourse>) => fetchApi<ApiRes<ReserveCourse>>(`/api/reserve/calendars/${id}/courses`, { method: 'POST', ...json(body) }),
  updateCourse: (courseId: string, body: Partial<ReserveCourse>) => fetchApi<ApiRes<ReserveCourse>>(`/api/reserve/courses/${courseId}`, { method: 'PUT', ...json(body) }),
  duplicateCourse: (courseId: string) => fetchApi<ApiRes<ReserveCourse>>(`/api/reserve/courses/${courseId}/duplicate`, { method: 'POST' }),
  deleteCourse: (courseId: string) => fetchApi<ApiRes<null>>(`/api/reserve/courses/${courseId}`, { method: 'DELETE' }),
  orderCourses: (id: string, ids: string[]) => fetchApi<ApiRes<null>>(`/api/reserve/calendars/${id}/courses-order`, { method: 'PUT', ...json({ ids }) }),
  saveLinks: (id: string, pairs: Array<{ slotId: string; courseId: string }>) => fetchApi<ApiRes<null>>(`/api/reserve/calendars/${id}/links`, { method: 'PUT', ...json({ pairs }) }),
  shifts: (id: string, from: string, to: string, slotIds?: string[]) => fetchApi<ApiRes<ReserveShift[]>>(`/api/reserve/calendars/${id}/shifts?from=${from}&to=${to}${slotIds?.length ? `&slotIds=${slotIds.join(',')}` : ''}`),
  createShift: (id: string, body: { slotId: string; date: string; startTime: string; endTime: string; memo?: string; repeat?: { freq: string; until: string } | null }) =>
    fetchApi<ApiRes<ReserveShift[]>>(`/api/reserve/calendars/${id}/shifts`, { method: 'POST', ...json(body) }),
  updateShift: (shiftId: string, scope: 'this' | 'following' | 'all', body: Partial<{ slotId: string; startTime: string; endTime: string; memo: string; date: string }>) =>
    fetchApi<ApiRes<null>>(`/api/reserve/shifts/${shiftId}?scope=${scope}`, { method: 'PUT', ...json(body) }),
  deleteShift: (shiftId: string, scope: 'this' | 'following' | 'all') => fetchApi<ApiRes<null>>(`/api/reserve/shifts/${shiftId}?scope=${scope}`, { method: 'DELETE' }),
  bookings: (id: string, q: BookingQuery) => fetchApi<ApiRes<{ total: number; items: ReserveBooking[] }>>(`/api/reserve/calendars/${id}/bookings?${bookingQs(q)}`),
  csvUrl: (id: string, q: BookingQuery) => `/api/reserve/calendars/${id}/bookings.csv?${bookingQs(q)}`,
  booking: (bid: string) =>
    fetchApi<
      ApiRes<{
        booking: ReserveBooking
        names: { slotName: string; courseName: string }
        logs: Array<{ kind: string; text: string; actor: string | null; createdAt: string }>
        friend: { id: string; display_name: string | null; real_name: string | null; system_display_name: string | null; picture_url: string | null; notes: string | null } | null
        recent: Array<{ id: string; startsAt: string; status: BookingStatus }>
      }>
    >(`/api/reserve/bookings/${bid}`),
  createBooking: (id: string, body: Record<string, unknown>) => fetchApi<ApiRes<ReserveBooking>>(`/api/reserve/calendars/${id}/bookings`, { method: 'POST', ...json(body) }),
  updateBooking: (bid: string, body: Record<string, unknown>) => fetchApi<ApiRes<ReserveBooking>>(`/api/reserve/bookings/${bid}`, { method: 'PUT', ...json(body) }),
  cancelBooking: (bid: string, runActions: boolean) => fetchApi<ApiRes<ReserveBooking>>(`/api/reserve/bookings/${bid}/cancel`, { method: 'POST', ...json({ runActions }) }),
  deleteBooking: (bid: string) => fetchApi<ApiRes<null>>(`/api/reserve/bookings/${bid}`, { method: 'DELETE' }),
  decide: (bid: string, decision: 'approve' | 'reject', runActions: boolean) => fetchApi<ApiRes<ReserveBooking>>(`/api/reserve/bookings/${bid}/decision`, { method: 'POST', ...json({ decision, runActions }) }),
  visited: (id: string, ids: string[], visited: boolean, runFollow: boolean) => fetchApi<ApiRes<{ count: number }>>(`/api/reserve/calendars/${id}/visited`, { method: 'POST', ...json({ ids, visited, runFollow }) }),
  notices: (id: string) => fetchApi<ApiRes<{ pendingCount: number; items: Array<{ id: string; status: string; pendingKind: string | null; startsAt: string; requestedAt: string; name: string }> }>>(`/api/reserve/calendars/${id}/notices`),
  createSiteLink: (id: string, slotId: string | null, courseId: string | null) => fetchApi<ApiRes<{ id: string; url: string | null }>>(`/api/reserve/calendars/${id}/site-links`, { method: 'POST', ...json({ slotId, courseId }) }),
  deleteSiteLink: (id: string, linkId: string) => fetchApi<ApiRes<null>>(`/api/reserve/calendars/${id}/site-links/${linkId}`, { method: 'DELETE' }),
}

// ── 日時の道具 ──────────────────────────────────────────────────────────────

export const WEEK_JA = ['日', '月', '火', '水', '木', '金', '土']

export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}
export function addDaysStr(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}
export function addMonthsStr(date: string, n: number): string {
  const [y, m] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-01`
}
export function formatDateJa(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')} ${WEEK_JA[weekdayOf(date)]}`
}
export const hhmmToMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
export const minToHhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export const STATUS_LABEL: Record<BookingStatus, string> = { confirmed: '予約済み', pending: '承認待ち', cancelled: 'キャンセル済み', rejected: '否認' }
