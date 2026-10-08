/**
 * カレンダー予約(Lステップの「カレンダー予約」と同じ仕様)のデータ操作。
 * 予約の受付ルールの判断(空き・締切・承認など)は、worker の services/reserve-*.ts にある。ここは、保存と取り出しだけ。
 * 時刻は、すべて日本時間の文字(YYYY-MM-DDTHH:MM)。
 */
import {
  ReserveError,
  defaultActions,
  defaultExternal,
  defaultReception,
  defaultScreen,
  defaultSlotSettings,
  defaultCourseSettings,
  parseExternal,
  parseFollow,
  parseReceptionSafe,
  parseReminders,
  parseReserveActions,
  parseScreen,
  parseSlotSettings,
  parseCourseSettings,
  parseReception,
} from './reserve-settings';
import type {
  CourseSettings,
  ExternalSettings,
  FollowSettings,
  ReceptionSettings,
  ReminderSettings,
  ReserveActions,
  ScreenSettings,
  SlotSettings,
} from './reserve-settings';

// ── 型 ──────────────────────────────────────────────────────────────────────

export interface ReserveCalendar {
  id: string;
  lineAccountId: string;
  name: string;
  status: 'active' | 'stopped';
  reception: ReceptionSettings;
  slotSettings: SlotSettings;
  courseSettings: CourseSettings;
  screen: ScreenSettings;
  actions: ReserveActions;
  reminders: ReminderSettings;
  follow: FollowSettings;
  external: ExternalSettings;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReserveSlot {
  id: string;
  calendarId: string;
  name: string;
  visible: boolean;
  price: number;
  capacity: number | null;
  autoAssign: boolean;
  priority: number;
  description: string;
  descriptionHtml: boolean;
  condition: Record<string, unknown> | null;
  iconUrl: string;
  sortOrder: number;
}

export interface ReserveCourse {
  id: string;
  calendarId: string;
  name: string;
  color: string;
  durationMinutes: number;
  displayMinutes: number | null;
  price: number;
  visible: boolean;
  description: string;
  descriptionHtml: boolean;
  condition: Record<string, unknown> | null;
  sortOrder: number;
}

export interface ReserveShift {
  id: string;
  calendarId: string;
  slotId: string;
  seriesId: string | null;
  workDate: string;
  startTime: string;
  endTime: string;
  memo: string;
  repeatRule: ShiftRepeatRule | null;
}

export interface ShiftRepeatRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** 繰り返しの終了日(YYYY-MM-DD) */
  until: string;
}

export type ReserveBookingStatus = 'confirmed' | 'pending' | 'cancelled' | 'rejected';

export interface ReserveBooking {
  id: string;
  calendarId: string;
  lineAccountId: string;
  friendId: string | null;
  slotId: string | null;
  courseId: string | null;
  isBlock: boolean;
  startsAt: string;
  endsAt: string;
  displayEndsAt: string | null;
  status: ReserveBookingStatus;
  pendingKind: 'new' | 'change' | 'cancel' | null;
  pendingPayload: Record<string, unknown> | null;
  followupStatus: string | null;
  visited: boolean;
  visitedAt: string | null;
  followState: 'none' | 'running' | 'done';
  createdBy: 'friend' | 'admin';
  answers: Record<string, string>;
  guestName: string | null;
  price: number;
  slotPriceApplied: boolean;
  memo: string;
  requestedAt: string;
  createdAt: string;
  updatedAt: string;
  googleEventId: string | null;
}

export interface ReserveBookingView extends ReserveBooking {
  friend: { id: string; displayName: string | null; realName: string | null; systemDisplayName: string | null; pictureUrl: string | null } | null;
}

const NOW_JST = "strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')";
export const newId = (): string => crypto.randomUUID();

function jsonOr<T>(raw: string | null | undefined, parse: (v: unknown) => T, fallback: () => T): T {
  if (!raw) return fallback();
  try {
    return parse(JSON.parse(raw));
  } catch {
    return fallback();
  }
}

// ── カレンダー ──────────────────────────────────────────────────────────────

interface CalendarRow {
  id: string;
  line_account_id: string;
  name: string;
  status: 'active' | 'stopped';
  reception: string;
  slot_settings: string;
  course_settings: string;
  screen: string;
  actions: string;
  reminders: string;
  follow: string;
  external: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

function toCalendar(r: CalendarRow): ReserveCalendar {
  return {
    id: r.id,
    lineAccountId: r.line_account_id,
    name: r.name,
    status: r.status,
    reception: jsonOr(r.reception, parseReceptionSafe, defaultReception),
    slotSettings: jsonOr(r.slot_settings, parseSlotSettings, defaultSlotSettings),
    courseSettings: jsonOr(r.course_settings, parseCourseSettings, defaultCourseSettings),
    screen: jsonOr(r.screen, parseScreen, defaultScreen),
    actions: jsonOr(r.actions, parseReserveActions, defaultActions),
    reminders: jsonOr(r.reminders, (v) => parseReminders(v, null), () => ({ enabled: false, enabledAt: null, items: [] })),
    follow: jsonOr(r.follow, (v) => parseFollow(v, null), () => ({ enabled: false, enabledAt: null, items: [] })),
    external: jsonOr(r.external, parseExternal, defaultExternal),
    displayOrder: r.display_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const MAX_CALENDARS_PER_ACCOUNT = 10;

export async function listReserveCalendars(db: D1Database, lineAccountId: string): Promise<ReserveCalendar[]> {
  const rows = await db.prepare('SELECT * FROM reserve_calendars WHERE line_account_id = ? ORDER BY display_order, created_at').bind(lineAccountId).all<CalendarRow>();
  return (rows.results ?? []).map(toCalendar);
}

export async function getReserveCalendar(db: D1Database, id: string): Promise<ReserveCalendar | null> {
  const r = await db.prepare('SELECT * FROM reserve_calendars WHERE id = ?').bind(id).first<CalendarRow>();
  return r ? toCalendar(r) : null;
}

export async function createReserveCalendar(db: D1Database, lineAccountId: string, name: string): Promise<ReserveCalendar> {
  const n = name.trim();
  if (!n) throw new ReserveError('カレンダー名を入力してください');
  if (n.length > 100) throw new ReserveError('カレンダー名は100文字以内で入力してください');
  const count = await db.prepare('SELECT COUNT(*) AS c FROM reserve_calendars WHERE line_account_id = ?').bind(lineAccountId).first<{ c: number }>();
  if ((count?.c ?? 0) >= MAX_CALENDARS_PER_ACCOUNT) throw new ReserveError(`カレンダーは、${MAX_CALENDARS_PER_ACCOUNT}個まで作れます`);
  const id = newId();
  await db
    .prepare('INSERT INTO reserve_calendars (id, line_account_id, name, reception, slot_settings, course_settings, screen, actions, reminders, follow, external, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(
      id,
      lineAccountId,
      n,
      JSON.stringify(defaultReception()),
      JSON.stringify(defaultSlotSettings()),
      JSON.stringify(defaultCourseSettings()),
      JSON.stringify(defaultScreen()),
      JSON.stringify(defaultActions()),
      JSON.stringify({ enabled: false, enabledAt: null, items: [] }),
      JSON.stringify({ enabled: false, enabledAt: null, items: [] }),
      JSON.stringify(defaultExternal()),
      count?.c ?? 0,
    )
    .run();
  return (await getReserveCalendar(db, id))!;
}

export async function renameReserveCalendar(db: D1Database, id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n || n.length > 100) throw new ReserveError('カレンダー名は、1〜100文字で入力してください');
  await db.prepare(`UPDATE reserve_calendars SET name = ?, updated_at = ${NOW_JST} WHERE id = ?`).bind(n, id).run();
}

export async function setReserveCalendarStatus(db: D1Database, id: string, status: 'active' | 'stopped'): Promise<void> {
  await db.prepare(`UPDATE reserve_calendars SET status = ?, updated_at = ${NOW_JST} WHERE id = ?`).bind(status, id).run();
}

export async function deleteReserveCalendar(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM reserve_calendars WHERE id = ?').bind(id).run();
}

export type CalendarSection = 'reception' | 'slotSettings' | 'courseSettings' | 'screen' | 'actions' | 'reminders' | 'follow' | 'external';
const SECTION_COLUMN: Record<CalendarSection, string> = {
  reception: 'reception',
  slotSettings: 'slot_settings',
  courseSettings: 'course_settings',
  screen: 'screen',
  actions: 'actions',
  reminders: 'reminders',
  follow: 'follow',
  external: 'external',
};

/** 設定の1区分を、検証して保存する。保存した内容を返す */
export async function saveReserveCalendarSection(db: D1Database, cal: ReserveCalendar, section: CalendarSection, raw: unknown): Promise<unknown> {
  let value: unknown;
  switch (section) {
    case 'reception': {
      value = parseReception(raw);
      const r = value as ReceptionSettings;
      // 予約枠未選択時の自動振り分けは、新規予約が「全承認」のときだけ
      if (cal.slotSettings.autoAssign && r.approval.newBooking === 'request') throw new ReserveError('予約枠未選択時の自動振り分けが有効のため、新規予約をリクエスト制にはできません');
      break;
    }
    case 'slotSettings': {
      value = parseSlotSettings(raw);
      const s = value as SlotSettings;
      if (s.autoAssign) {
        if (cal.reception.approval.newBooking === 'request') throw new ReserveError('自動振り分けを有効にするには、新規予約を「全承認」にしてください');
        const count = await db.prepare('SELECT COUNT(*) AS c FROM reserve_slots WHERE calendar_id = ?').bind(cal.id).first<{ c: number }>();
        if ((count?.c ?? 0) < 1) throw new ReserveError('自動振り分けを有効にするには、予約枠が1つ以上必要です');
      }
      break;
    }
    case 'courseSettings':
      value = parseCourseSettings(raw);
      break;
    case 'screen':
      value = parseScreen(raw);
      break;
    case 'actions':
      value = parseReserveActions(raw);
      break;
    case 'reminders':
      value = parseReminders(raw, cal.reminders);
      break;
    case 'follow':
      value = parseFollow(raw, cal.follow);
      break;
    case 'external':
      value = parseExternal(raw);
      break;
  }
  await db.prepare(`UPDATE reserve_calendars SET ${SECTION_COLUMN[section]} = ?, updated_at = ${NOW_JST} WHERE id = ?`).bind(JSON.stringify(value), cal.id).run();
  return value;
}

// ── 予約枠 ──────────────────────────────────────────────────────────────────

interface SlotRow {
  id: string;
  calendar_id: string;
  name: string;
  visible: number;
  price: number;
  capacity: number | null;
  auto_assign: number;
  priority: number;
  description: string | null;
  description_html: number;
  condition: string | null;
  icon_url: string | null;
  sort_order: number;
}

function toSlot(r: SlotRow): ReserveSlot {
  let condition: Record<string, unknown> | null = null;
  if (r.condition) {
    try {
      condition = JSON.parse(r.condition) as Record<string, unknown>;
    } catch {
      condition = null;
    }
  }
  return {
    id: r.id,
    calendarId: r.calendar_id,
    name: r.name,
    visible: r.visible === 1,
    price: r.price,
    capacity: r.capacity,
    autoAssign: r.auto_assign === 1,
    priority: r.priority,
    description: r.description ?? '',
    descriptionHtml: r.description_html === 1,
    condition,
    iconUrl: r.icon_url ?? '',
    sortOrder: r.sort_order,
  };
}

export async function listReserveSlots(db: D1Database, calendarId: string): Promise<ReserveSlot[]> {
  const rows = await db.prepare('SELECT * FROM reserve_slots WHERE calendar_id = ? ORDER BY sort_order, created_at').bind(calendarId).all<SlotRow>();
  return (rows.results ?? []).map(toSlot);
}

export interface SlotInput {
  name?: unknown;
  visible?: unknown;
  price?: unknown;
  capacity?: unknown;
  autoAssign?: unknown;
  priority?: unknown;
  description?: unknown;
  descriptionHtml?: unknown;
  condition?: unknown;
  iconUrl?: unknown;
}

const nonNegInt = (v: unknown, label: string, max = 10_000_000): number => {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ReserveError(`${label}は、0以上の整数で入力してください`);
  return n;
};

function slotValues(input: SlotInput, base?: ReserveSlot) {
  const name = (input.name === undefined ? base?.name : String(input.name)) ?? '';
  if (!name.trim()) throw new ReserveError('予約枠の名前を入力してください');
  if (name.length > 100) throw new ReserveError('予約枠の名前は100文字以内で入力してください');
  const cap = input.capacity === undefined ? (base?.capacity ?? null) : input.capacity === null || input.capacity === '' ? null : Number(input.capacity);
  if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 9999)) throw new ReserveError('同時予約可能数は、1以上の整数で入力してください');
  const priority = input.priority === undefined ? (base?.priority ?? 1) : Number(input.priority);
  if (!Number.isInteger(priority) || priority < 1 || priority > 999) throw new ReserveError('優先度は、1〜999の整数で入力してください');
  const desc = input.description === undefined ? (base?.description ?? '') : String(input.description);
  if (desc.length > 10000) throw new ReserveError('説明文は10000文字以内で入力してください');
  return {
    name: name.trim(),
    visible: (input.visible === undefined ? (base?.visible ?? true) : input.visible === true) ? 1 : 0,
    price: input.price === undefined ? (base?.price ?? 0) : nonNegInt(input.price, '料金'),
    capacity: cap,
    autoAssign: (input.autoAssign === undefined ? (base?.autoAssign ?? false) : input.autoAssign === true) ? 1 : 0,
    priority,
    description: desc,
    descriptionHtml: (input.descriptionHtml === undefined ? (base?.descriptionHtml ?? false) : input.descriptionHtml === true) ? 1 : 0,
    condition: input.condition === undefined ? (base?.condition ? JSON.stringify(base.condition) : null) : input.condition ? JSON.stringify(input.condition) : null,
    iconUrl: input.iconUrl === undefined ? (base?.iconUrl ?? '') : /^https:\/\/\S{1,1000}$/.test(String(input.iconUrl)) ? String(input.iconUrl) : '',
  };
}

export async function createReserveSlot(db: D1Database, calendarId: string, input: SlotInput): Promise<ReserveSlot> {
  const v = slotValues(input);
  const id = newId();
  const order = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM reserve_slots WHERE calendar_id = ?').bind(calendarId).first<{ n: number }>();
  await db
    .prepare('INSERT INTO reserve_slots (id, calendar_id, name, visible, price, capacity, auto_assign, priority, description, description_html, condition, icon_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, calendarId, v.name, v.visible, v.price, v.capacity, v.autoAssign, v.priority, v.description, v.descriptionHtml, v.condition, v.iconUrl || null, order?.n ?? 0)
    .run();
  // 既存のコースすべてと紐づける(あとから紐づけ画面で外せる)
  await db.prepare('INSERT OR IGNORE INTO reserve_slot_courses (slot_id, course_id) SELECT ?, id FROM reserve_courses WHERE calendar_id = ?').bind(id, calendarId).run();
  return (await getReserveSlot(db, id))!;
}

export async function getReserveSlot(db: D1Database, id: string): Promise<ReserveSlot | null> {
  const r = await db.prepare('SELECT * FROM reserve_slots WHERE id = ?').bind(id).first<SlotRow>();
  return r ? toSlot(r) : null;
}

export async function updateReserveSlot(db: D1Database, id: string, input: SlotInput): Promise<ReserveSlot> {
  const cur = await getReserveSlot(db, id);
  if (!cur) throw new ReserveError('予約枠が見つかりません');
  const v = slotValues(input, cur);
  await db
    .prepare(`UPDATE reserve_slots SET name = ?, visible = ?, price = ?, capacity = ?, auto_assign = ?, priority = ?, description = ?, description_html = ?, condition = ?, icon_url = ?, updated_at = ${NOW_JST} WHERE id = ?`)
    .bind(v.name, v.visible, v.price, v.capacity, v.autoAssign, v.priority, v.description, v.descriptionHtml, v.condition, v.iconUrl || null, id)
    .run();
  return (await getReserveSlot(db, id))!;
}

export async function deleteReserveSlot(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM reserve_slots WHERE id = ?').bind(id).run();
}

export async function reorderReserveSlots(db: D1Database, calendarId: string, ids: string[]): Promise<void> {
  const stmts = ids.map((id, i) => db.prepare('UPDATE reserve_slots SET sort_order = ? WHERE id = ? AND calendar_id = ?').bind(i, id, calendarId));
  if (stmts.length) await db.batch(stmts);
}

export async function duplicateReserveSlot(db: D1Database, id: string): Promise<ReserveSlot> {
  const cur = await getReserveSlot(db, id);
  if (!cur) throw new ReserveError('予約枠が見つかりません');
  const copy = await createReserveSlot(db, cur.calendarId, { ...cur, name: `${cur.name}のコピー` });
  // 紐づけも引き継ぐ
  await db.prepare('DELETE FROM reserve_slot_courses WHERE slot_id = ?').bind(copy.id).run();
  await db.prepare('INSERT OR IGNORE INTO reserve_slot_courses (slot_id, course_id) SELECT ?, course_id FROM reserve_slot_courses WHERE slot_id = ?').bind(copy.id, id).run();
  return copy;
}

// ── コース ──────────────────────────────────────────────────────────────────

interface CourseRow {
  id: string;
  calendar_id: string;
  name: string;
  color: string;
  duration_minutes: number;
  display_minutes: number | null;
  price: number;
  visible: number;
  description: string | null;
  description_html: number;
  condition: string | null;
  sort_order: number;
}

function toCourse(r: CourseRow): ReserveCourse {
  let condition: Record<string, unknown> | null = null;
  if (r.condition) {
    try {
      condition = JSON.parse(r.condition) as Record<string, unknown>;
    } catch {
      condition = null;
    }
  }
  return {
    id: r.id,
    calendarId: r.calendar_id,
    name: r.name,
    color: r.color,
    durationMinutes: r.duration_minutes,
    displayMinutes: r.display_minutes,
    price: r.price,
    visible: r.visible === 1,
    description: r.description ?? '',
    descriptionHtml: r.description_html === 1,
    condition,
    sortOrder: r.sort_order,
  };
}

export async function listReserveCourses(db: D1Database, calendarId: string): Promise<ReserveCourse[]> {
  const rows = await db.prepare('SELECT * FROM reserve_courses WHERE calendar_id = ? ORDER BY sort_order, created_at').bind(calendarId).all<CourseRow>();
  return (rows.results ?? []).map(toCourse);
}

export async function getReserveCourse(db: D1Database, id: string): Promise<ReserveCourse | null> {
  const r = await db.prepare('SELECT * FROM reserve_courses WHERE id = ?').bind(id).first<CourseRow>();
  return r ? toCourse(r) : null;
}

export interface CourseInput {
  name?: unknown;
  color?: unknown;
  durationMinutes?: unknown;
  displayMinutes?: unknown;
  price?: unknown;
  visible?: unknown;
  description?: unknown;
  descriptionHtml?: unknown;
  condition?: unknown;
}

function courseValues(input: CourseInput, base?: ReserveCourse) {
  const name = (input.name === undefined ? base?.name : String(input.name)) ?? '';
  if (!name.trim()) throw new ReserveError('コース名を入力してください');
  if (name.length > 100) throw new ReserveError('コース名は100文字以内で入力してください');
  const dur = input.durationMinutes === undefined ? (base?.durationMinutes ?? 30) : Number(input.durationMinutes);
  if (!Number.isInteger(dur) || dur < 5 || dur > 1440) throw new ReserveError('所要時間は、5〜1440分の整数で入力してください');
  const disp = input.displayMinutes === undefined ? (base?.displayMinutes ?? null) : input.displayMinutes === null || input.displayMinutes === '' ? null : Number(input.displayMinutes);
  if (disp !== null && (!Number.isInteger(disp) || disp < 1 || disp > 1440)) throw new ReserveError('表示時間は、1〜1440分の整数で入力してください');
  const color = input.color === undefined ? (base?.color ?? '#3b82f6') : String(input.color);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new ReserveError('カラーの形式が正しくありません');
  const desc = input.description === undefined ? (base?.description ?? '') : String(input.description);
  if (desc.length > 10000) throw new ReserveError('説明文は10000文字以内で入力してください');
  return {
    name: name.trim(),
    color,
    duration: dur,
    display: disp,
    price: input.price === undefined ? (base?.price ?? 0) : nonNegInt(input.price, '料金'),
    visible: (input.visible === undefined ? (base?.visible ?? true) : input.visible === true) ? 1 : 0,
    description: desc,
    descriptionHtml: (input.descriptionHtml === undefined ? (base?.descriptionHtml ?? false) : input.descriptionHtml === true) ? 1 : 0,
    condition: input.condition === undefined ? (base?.condition ? JSON.stringify(base.condition) : null) : input.condition ? JSON.stringify(input.condition) : null,
  };
}

export async function createReserveCourse(db: D1Database, calendarId: string, input: CourseInput): Promise<ReserveCourse> {
  const v = courseValues(input);
  const id = newId();
  const order = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM reserve_courses WHERE calendar_id = ?').bind(calendarId).first<{ n: number }>();
  await db
    .prepare('INSERT INTO reserve_courses (id, calendar_id, name, color, duration_minutes, display_minutes, price, visible, description, description_html, condition, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, calendarId, v.name, v.color, v.duration, v.display, v.price, v.visible, v.description, v.descriptionHtml, v.condition, order?.n ?? 0)
    .run();
  await db.prepare('INSERT OR IGNORE INTO reserve_slot_courses (slot_id, course_id) SELECT id, ? FROM reserve_slots WHERE calendar_id = ?').bind(id, calendarId).run();
  return (await getReserveCourse(db, id))!;
}

export async function updateReserveCourse(db: D1Database, id: string, input: CourseInput): Promise<ReserveCourse> {
  const cur = await getReserveCourse(db, id);
  if (!cur) throw new ReserveError('コースが見つかりません');
  const v = courseValues(input, cur);
  await db
    .prepare(`UPDATE reserve_courses SET name = ?, color = ?, duration_minutes = ?, display_minutes = ?, price = ?, visible = ?, description = ?, description_html = ?, condition = ?, updated_at = ${NOW_JST} WHERE id = ?`)
    .bind(v.name, v.color, v.duration, v.display, v.price, v.visible, v.description, v.descriptionHtml, v.condition, id)
    .run();
  return (await getReserveCourse(db, id))!;
}

export async function deleteReserveCourse(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM reserve_courses WHERE id = ?').bind(id).run();
}

export async function reorderReserveCourses(db: D1Database, calendarId: string, ids: string[]): Promise<void> {
  const stmts = ids.map((id, i) => db.prepare('UPDATE reserve_courses SET sort_order = ? WHERE id = ? AND calendar_id = ?').bind(i, id, calendarId));
  if (stmts.length) await db.batch(stmts);
}

export async function duplicateReserveCourse(db: D1Database, id: string): Promise<ReserveCourse> {
  const cur = await getReserveCourse(db, id);
  if (!cur) throw new ReserveError('コースが見つかりません');
  const copy = await createReserveCourse(db, cur.calendarId, { ...cur, name: `${cur.name}のコピー` });
  await db.prepare('DELETE FROM reserve_slot_courses WHERE course_id = ?').bind(copy.id).run();
  await db.prepare('INSERT OR IGNORE INTO reserve_slot_courses (slot_id, course_id) SELECT slot_id, ? FROM reserve_slot_courses WHERE course_id = ?').bind(copy.id, id).run();
  return copy;
}

// ── 予約枠とコースの紐づけ ───────────────────────────────────────────────────

export async function listReserveLinks(db: D1Database, calendarId: string): Promise<Array<{ slotId: string; courseId: string }>> {
  const rows = await db
    .prepare('SELECT sc.slot_id, sc.course_id FROM reserve_slot_courses sc JOIN reserve_slots s ON s.id = sc.slot_id WHERE s.calendar_id = ?')
    .bind(calendarId)
    .all<{ slot_id: string; course_id: string }>();
  return (rows.results ?? []).map((r) => ({ slotId: r.slot_id, courseId: r.course_id }));
}

export async function saveReserveLinks(db: D1Database, calendarId: string, pairs: Array<{ slotId: string; courseId: string }>): Promise<void> {
  const slots = new Set((await listReserveSlots(db, calendarId)).map((s) => s.id));
  const courses = new Set((await listReserveCourses(db, calendarId)).map((c) => c.id));
  for (const p of pairs) if (!slots.has(p.slotId) || !courses.has(p.courseId)) throw new ReserveError('このカレンダーにない予約枠・コースが含まれています');
  const stmts = [db.prepare('DELETE FROM reserve_slot_courses WHERE slot_id IN (SELECT id FROM reserve_slots WHERE calendar_id = ?)').bind(calendarId)];
  for (const p of pairs) stmts.push(db.prepare('INSERT OR IGNORE INTO reserve_slot_courses (slot_id, course_id) VALUES (?, ?)').bind(p.slotId, p.courseId));
  await db.batch(stmts);
}

// ── シフト ──────────────────────────────────────────────────────────────────

interface ShiftRow {
  id: string;
  calendar_id: string;
  slot_id: string;
  series_id: string | null;
  work_date: string;
  start_time: string;
  end_time: string;
  memo: string | null;
  repeat_rule: string | null;
}

function toShift(r: ShiftRow): ReserveShift {
  let rule: ShiftRepeatRule | null = null;
  if (r.repeat_rule) {
    try {
      rule = JSON.parse(r.repeat_rule) as ShiftRepeatRule;
    } catch {
      rule = null;
    }
  }
  return { id: r.id, calendarId: r.calendar_id, slotId: r.slot_id, seriesId: r.series_id, workDate: r.work_date, startTime: r.start_time, endTime: r.end_time, memo: r.memo ?? '', repeatRule: rule };
}

export async function listReserveShifts(db: D1Database, calendarId: string, from: string, to: string, slotIds?: string[]): Promise<ReserveShift[]> {
  let sql = 'SELECT * FROM reserve_shifts WHERE calendar_id = ? AND work_date >= ? AND work_date <= ?';
  const binds: unknown[] = [calendarId, from, to];
  if (slotIds && slotIds.length) {
    sql += ` AND slot_id IN (${slotIds.map(() => '?').join(',')})`;
    binds.push(...slotIds);
  }
  sql += ' ORDER BY work_date, start_time';
  const rows = await db.prepare(sql).bind(...binds).all<ShiftRow>();
  return (rows.results ?? []).map(toShift);
}

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (date: string, n: number): string | null => {
  const [y, m, day] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  if (day > last) return null; // 31日が無い月などは、その月はとばす
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** 繰り返しを、日付の一覧に展開する(最大で1年+366日ぶん・1000件まで) */
export function expandShiftDates(start: string, rule: ShiftRepeatRule | null): string[] {
  if (!rule) return [start];
  const limit = addDays(start, 366 * 2);
  const until = rule.until > limit ? limit : rule.until;
  const out: string[] = [];
  for (let i = 0; i < 1000; i++) {
    let d: string | null;
    if (rule.freq === 'daily') d = addDays(start, i);
    else if (rule.freq === 'weekly') d = addDays(start, i * 7);
    else if (rule.freq === 'monthly') d = addMonths(start, i);
    else d = addMonths(start, i * 12);
    if (d && d > until) break;
    if (d) out.push(d);
    if (rule.freq === 'yearly' && i > 40) break;
  }
  return out;
}

export interface ShiftInput {
  slotId: string;
  date: string;
  startTime: string;
  endTime: string;
  memo?: string;
  repeat?: { freq?: unknown; until?: unknown } | null;
}

function checkShift(i: ShiftInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new ReserveError('シフトの日付が正しくありません');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(i.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(i.endTime)) throw new ReserveError('シフトの時間は、10:00 の形で入力してください');
  if (i.startTime >= i.endTime) throw new ReserveError('シフトの終了時間は、開始時間より後にしてください');
  if ((i.memo ?? '').length > 500) throw new ReserveError('メモは500文字以内で入力してください');
}

export async function createReserveShifts(db: D1Database, calendarId: string, input: ShiftInput): Promise<ReserveShift[]> {
  checkShift(input);
  const slot = await getReserveSlot(db, input.slotId);
  if (!slot || slot.calendarId !== calendarId) throw new ReserveError('予約枠が見つかりません');
  let rule: ShiftRepeatRule | null = null;
  if (input.repeat) {
    const f = input.repeat.freq;
    if (f !== 'daily' && f !== 'weekly' && f !== 'monthly' && f !== 'yearly') throw new ReserveError('繰り返しの頻度が正しくありません');
    const until = String(input.repeat.until ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < input.date) throw new ReserveError('繰り返しの終了日は、開始日以降で入力してください');
    rule = { freq: f, until };
  }
  const dates = expandShiftDates(input.date, rule);
  const seriesId = rule ? newId() : null;
  const stmts = dates.map((d) =>
    db
      .prepare('INSERT INTO reserve_shifts (id, calendar_id, slot_id, series_id, work_date, start_time, end_time, memo, repeat_rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(newId(), calendarId, input.slotId, seriesId, d, input.startTime, input.endTime, input.memo ?? '', rule ? JSON.stringify(rule) : null),
  );
  // D1 の batch は、1回あたり件数に上限があるため、まとめすぎない
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return listReserveShifts(db, calendarId, dates[0], dates[dates.length - 1], [input.slotId]);
}

export type ShiftScope = 'this' | 'following' | 'all';

/** 繰り返しのシフトの、変更・削除の対象(このシフトのみ/これ以降すべて/すべて)を求める */
async function shiftTargets(db: D1Database, shift: ReserveShift, scope: ShiftScope): Promise<string[]> {
  if (!shift.seriesId || scope === 'this') return [shift.id];
  const rows = await db
    .prepare(scope === 'following' ? 'SELECT id FROM reserve_shifts WHERE series_id = ? AND work_date >= ?' : 'SELECT id FROM reserve_shifts WHERE series_id = ? AND work_date >= ?')
    .bind(shift.seriesId, scope === 'following' ? shift.workDate : '0000-00-00')
    .all<{ id: string }>();
  return (rows.results ?? []).map((r) => r.id);
}

export async function getReserveShift(db: D1Database, id: string): Promise<ReserveShift | null> {
  const r = await db.prepare('SELECT * FROM reserve_shifts WHERE id = ?').bind(id).first<ShiftRow>();
  return r ? toShift(r) : null;
}

export async function updateReserveShift(db: D1Database, id: string, patch: { slotId?: string; startTime?: string; endTime?: string; memo?: string; date?: string }, scope: ShiftScope): Promise<void> {
  const cur = await getReserveShift(db, id);
  if (!cur) throw new ReserveError('シフトが見つかりません');
  const next = { slotId: patch.slotId ?? cur.slotId, startTime: patch.startTime ?? cur.startTime, endTime: patch.endTime ?? cur.endTime, memo: patch.memo ?? cur.memo, date: patch.date ?? cur.workDate };
  checkShift({ slotId: next.slotId, date: next.date, startTime: next.startTime, endTime: next.endTime, memo: next.memo });
  const targets = await shiftTargets(db, cur, scope);
  // 日付の変更は、選んだシフトだけに適用する(繰り返しの他の日を、同じ日に集めない)
  const stmts = targets.map((tid) =>
    tid === id
      ? db.prepare('UPDATE reserve_shifts SET slot_id = ?, start_time = ?, end_time = ?, memo = ?, work_date = ? WHERE id = ?').bind(next.slotId, next.startTime, next.endTime, next.memo, next.date, tid)
      : db.prepare('UPDATE reserve_shifts SET slot_id = ?, start_time = ?, end_time = ?, memo = ? WHERE id = ?').bind(next.slotId, next.startTime, next.endTime, next.memo, tid),
  );
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

export async function deleteReserveShift(db: D1Database, id: string, scope: ShiftScope): Promise<void> {
  const cur = await getReserveShift(db, id);
  if (!cur) return;
  const targets = await shiftTargets(db, cur, scope);
  const stmts = targets.map((tid) => db.prepare('DELETE FROM reserve_shifts WHERE id = ?').bind(tid));
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

// ── 予約 ────────────────────────────────────────────────────────────────────

interface BookingRow {
  id: string;
  calendar_id: string;
  line_account_id: string;
  friend_id: string | null;
  slot_id: string | null;
  course_id: string | null;
  is_block: number;
  starts_at: string;
  ends_at: string;
  display_ends_at: string | null;
  status: ReserveBookingStatus;
  pending_kind: 'new' | 'change' | 'cancel' | null;
  pending_payload: string | null;
  followup_status: string | null;
  visited: number;
  visited_at: string | null;
  follow_state: 'none' | 'running' | 'done';
  created_by: 'friend' | 'admin';
  answers: string;
  guest_name: string | null;
  price: number;
  slot_price_applied: number;
  memo: string | null;
  requested_at: string;
  created_at: string;
  updated_at: string;
  google_event_id: string | null;
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toBooking(r: BookingRow): ReserveBooking {
  return {
    id: r.id,
    calendarId: r.calendar_id,
    lineAccountId: r.line_account_id,
    friendId: r.friend_id,
    slotId: r.slot_id,
    courseId: r.course_id,
    isBlock: r.is_block === 1,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    displayEndsAt: r.display_ends_at,
    status: r.status,
    pendingKind: r.pending_kind,
    pendingPayload: parseJsonObject(r.pending_payload),
    followupStatus: r.followup_status,
    visited: r.visited === 1,
    visitedAt: r.visited_at,
    followState: r.follow_state,
    createdBy: r.created_by,
    answers: (parseJsonObject(r.answers) ?? {}) as Record<string, string>,
    guestName: r.guest_name,
    price: r.price,
    slotPriceApplied: r.slot_price_applied === 1,
    memo: r.memo ?? '',
    requestedAt: r.requested_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    googleEventId: r.google_event_id,
  };
}

export interface BookingInsert {
  calendarId: string;
  lineAccountId: string;
  friendId: string | null;
  slotId: string | null;
  courseId: string | null;
  isBlock?: boolean;
  startsAt: string;
  endsAt: string;
  displayEndsAt?: string | null;
  status: ReserveBookingStatus;
  pendingKind?: 'new' | 'change' | 'cancel' | null;
  pendingPayload?: Record<string, unknown> | null;
  createdBy: 'friend' | 'admin';
  answers?: Record<string, string>;
  guestName?: string | null;
  price?: number;
  slotPriceApplied?: boolean;
  memo?: string;
}

export async function insertReserveBooking(db: D1Database, b: BookingInsert): Promise<ReserveBooking> {
  const id = newId();
  await db
    .prepare(
      'INSERT INTO reserve_bookings (id, calendar_id, line_account_id, friend_id, slot_id, course_id, is_block, starts_at, ends_at, display_ends_at, status, pending_kind, pending_payload, created_by, answers, guest_name, price, slot_price_applied, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      b.calendarId,
      b.lineAccountId,
      b.friendId,
      b.slotId,
      b.courseId,
      b.isBlock ? 1 : 0,
      b.startsAt,
      b.endsAt,
      b.displayEndsAt ?? null,
      b.status,
      b.pendingKind ?? null,
      b.pendingPayload ? JSON.stringify(b.pendingPayload) : null,
      b.createdBy,
      JSON.stringify(b.answers ?? {}),
      b.guestName ?? null,
      b.price ?? 0,
      b.slotPriceApplied === false ? 0 : 1,
      b.memo ?? '',
    )
    .run();
  return (await getReserveBooking(db, id))!;
}

export async function getReserveBooking(db: D1Database, id: string): Promise<ReserveBooking | null> {
  const r = await db.prepare('SELECT * FROM reserve_bookings WHERE id = ?').bind(id).first<BookingRow>();
  return r ? toBooking(r) : null;
}

export interface BookingPatch {
  friendId?: string | null;
  slotId?: string | null;
  courseId?: string | null;
  startsAt?: string;
  endsAt?: string;
  displayEndsAt?: string | null;
  status?: ReserveBookingStatus;
  pendingKind?: 'new' | 'change' | 'cancel' | null;
  pendingPayload?: Record<string, unknown> | null;
  followupStatus?: string | null;
  visited?: boolean;
  visitedAt?: string | null;
  followState?: 'none' | 'running' | 'done';
  answers?: Record<string, string>;
  guestName?: string | null;
  price?: number;
  slotPriceApplied?: boolean;
  memo?: string;
  googleEventId?: string | null;
}

export async function updateReserveBooking(db: D1Database, id: string, p: BookingPatch): Promise<ReserveBooking | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(v);
  };
  if (p.friendId !== undefined) set('friend_id', p.friendId);
  if (p.slotId !== undefined) set('slot_id', p.slotId);
  if (p.courseId !== undefined) set('course_id', p.courseId);
  if (p.startsAt !== undefined) set('starts_at', p.startsAt);
  if (p.endsAt !== undefined) set('ends_at', p.endsAt);
  if (p.displayEndsAt !== undefined) set('display_ends_at', p.displayEndsAt);
  if (p.status !== undefined) set('status', p.status);
  if (p.pendingKind !== undefined) set('pending_kind', p.pendingKind);
  if (p.pendingPayload !== undefined) set('pending_payload', p.pendingPayload ? JSON.stringify(p.pendingPayload) : null);
  if (p.followupStatus !== undefined) set('followup_status', p.followupStatus);
  if (p.visited !== undefined) set('visited', p.visited ? 1 : 0);
  if (p.visitedAt !== undefined) set('visited_at', p.visitedAt);
  if (p.followState !== undefined) set('follow_state', p.followState);
  if (p.answers !== undefined) set('answers', JSON.stringify(p.answers));
  if (p.guestName !== undefined) set('guest_name', p.guestName);
  if (p.price !== undefined) set('price', p.price);
  if (p.slotPriceApplied !== undefined) set('slot_price_applied', p.slotPriceApplied ? 1 : 0);
  if (p.memo !== undefined) set('memo', p.memo);
  if (p.googleEventId !== undefined) set('google_event_id', p.googleEventId);
  if (sets.length === 0) return getReserveBooking(db, id);
  sets.push(`updated_at = ${NOW_JST}`);
  await db.prepare(`UPDATE reserve_bookings SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  return getReserveBooking(db, id);
}

export async function deleteReserveBooking(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM reserve_bookings WHERE id = ?').bind(id).run();
}

export interface BookingFilter {
  from?: string; // YYYY-MM-DD(その日の0時以降に始まる)
  to?: string; // YYYY-MM-DD(その日の終わりまでに始まる)
  slotIds?: string[]; // 'none' は予約枠なし(指名なし)
  courseIds?: string[];
  statuses?: ReserveBookingStatus[];
  includeBlocks?: boolean;
  onlyBlocks?: boolean;
  friendId?: string;
  visited?: boolean;
  q?: string; // 名前(LINE名・本名・システム表示名・予約の名前)
  friendQ?: string; // 友だち(LINE名・本名・システム表示名)
  guestQ?: string; // お客さま(予約の名前)
  timeFrom?: string; // HH:MM(開始時刻がこれ以降)
  timeTo?: string; // HH:MM(開始時刻がこれ以前)
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

export async function listReserveBookings(db: D1Database, calendarId: string, f: BookingFilter = {}): Promise<{ items: ReserveBookingView[]; total: number }> {
  const where: string[] = ['b.calendar_id = ?'];
  const binds: unknown[] = [calendarId];
  if (f.from) {
    where.push('b.starts_at >= ?');
    binds.push(`${f.from}T00:00`);
  }
  if (f.to) {
    where.push('b.starts_at <= ?');
    binds.push(`${f.to}T23:59`);
  }
  if (f.slotIds && f.slotIds.length) {
    const real = f.slotIds.filter((s) => s !== 'none');
    const parts: string[] = [];
    if (real.length) {
      parts.push(`b.slot_id IN (${real.map(() => '?').join(',')})`);
      binds.push(...real);
    }
    if (f.slotIds.includes('none')) parts.push('b.slot_id IS NULL');
    where.push(`(${parts.join(' OR ')})`);
  }
  if (f.courseIds && f.courseIds.length) {
    where.push(`b.course_id IN (${f.courseIds.map(() => '?').join(',')})`);
    binds.push(...f.courseIds);
  }
  if (f.statuses && f.statuses.length) {
    where.push(`b.status IN (${f.statuses.map(() => '?').join(',')})`);
    binds.push(...f.statuses);
  }
  if (f.onlyBlocks) where.push('b.is_block = 1');
  else if (!f.includeBlocks) where.push('b.is_block = 0');
  if (f.friendId) {
    where.push('b.friend_id = ?');
    binds.push(f.friendId);
  }
  if (f.visited !== undefined) {
    where.push('b.visited = ?');
    binds.push(f.visited ? 1 : 0);
  }
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push("(f.display_name LIKE ? ESCAPE '\\' OR f.real_name LIKE ? ESCAPE '\\' OR f.system_display_name LIKE ? ESCAPE '\\' OR b.guest_name LIKE ? ESCAPE '\\')");
    binds.push(like, like, like, like);
  }
  const like = (v: string) => `%${v.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  if (f.friendQ && f.friendQ.trim()) {
    where.push("(f.display_name LIKE ? ESCAPE '\\' OR f.real_name LIKE ? ESCAPE '\\' OR f.system_display_name LIKE ? ESCAPE '\\')");
    binds.push(like(f.friendQ), like(f.friendQ), like(f.friendQ));
  }
  if (f.guestQ && f.guestQ.trim()) {
    where.push("b.guest_name LIKE ? ESCAPE '\\'");
    binds.push(like(f.guestQ));
  }
  if (f.timeFrom) {
    where.push('substr(b.starts_at, 12, 5) >= ?');
    binds.push(f.timeFrom);
  }
  if (f.timeTo) {
    where.push('substr(b.starts_at, 12, 5) <= ?');
    binds.push(f.timeTo);
  }
  const whereSql = where.join(' AND ');
  const total = await db
    .prepare(`SELECT COUNT(*) AS c FROM reserve_bookings b LEFT JOIN friends f ON f.id = b.friend_id WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();
  const limit = Math.min(f.limit ?? 500, 2000);
  const rows = await db
    .prepare(
      `SELECT b.*, f.display_name AS f_display_name, f.real_name AS f_real_name, f.system_display_name AS f_system_name, f.picture_url AS f_picture
         FROM reserve_bookings b LEFT JOIN friends f ON f.id = b.friend_id
        WHERE ${whereSql} ORDER BY b.starts_at ${f.order === 'desc' ? 'DESC' : 'ASC'}, b.created_at ASC LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, f.offset ?? 0)
    .all<BookingRow & { f_display_name: string | null; f_real_name: string | null; f_system_name: string | null; f_picture: string | null }>();
  const items = (rows.results ?? []).map((r) => ({
    ...toBooking(r),
    friend: r.friend_id ? { id: r.friend_id, displayName: r.f_display_name, realName: r.f_real_name, systemDisplayName: r.f_system_name, pictureUrl: r.f_picture } : null,
  }));
  return { items, total: total?.c ?? 0 };
}

/** 空きの計算用: ある期間にかかる、有効な予約(予約済み・承認待ち・ブロック枠)を取り出す */
export async function listActiveBookingsOverlapping(db: D1Database, calendarId: string, from: string, to: string): Promise<ReserveBooking[]> {
  const rows = await db
    .prepare("SELECT * FROM reserve_bookings WHERE calendar_id = ? AND status IN ('confirmed', 'pending') AND starts_at < ? AND ends_at > ? ORDER BY starts_at")
    .bind(calendarId, to, from)
    .all<BookingRow>();
  return (rows.results ?? []).map(toBooking);
}

export async function countPendingReserveBookings(db: D1Database, calendarId: string): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM reserve_bookings WHERE calendar_id = ? AND status = 'pending'").bind(calendarId).first<{ c: number }>();
  return r?.c ?? 0;
}

export async function addReserveBookingLog(db: D1Database, bookingId: string, kind: string, text: string, actor: string | null): Promise<void> {
  await db.prepare('INSERT INTO reserve_booking_logs (id, booking_id, kind, text, actor) VALUES (?, ?, ?, ?, ?)').bind(newId(), bookingId, kind, text.slice(0, 500), actor).run();
}

export async function listReserveBookingLogs(db: D1Database, bookingId: string): Promise<Array<{ kind: string; text: string; actor: string | null; createdAt: string }>> {
  const rows = await db.prepare('SELECT kind, text, actor, created_at FROM reserve_booking_logs WHERE booking_id = ? ORDER BY created_at').bind(bookingId).all<{ kind: string; text: string; actor: string | null; created_at: string }>();
  return (rows.results ?? []).map((r) => ({ kind: r.kind, text: r.text, actor: r.actor, createdAt: r.created_at }));
}

// ── リマインダ・フォローの配信予定 ──────────────────────────────────────────

export async function cancelReserveDeliveries(db: D1Database, bookingId: string, kind?: 'reminder' | 'follow'): Promise<void> {
  await db
    .prepare(`UPDATE reserve_deliveries SET status = 'cancelled' WHERE booking_id = ? AND status = 'pending'${kind ? ' AND kind = ?' : ''}`)
    .bind(...(kind ? [bookingId, kind] : [bookingId]))
    .run();
}

export async function addReserveDelivery(db: D1Database, d: { bookingId: string; kind: 'reminder' | 'follow'; itemId: string; runAt: string }): Promise<void> {
  await db.prepare('INSERT INTO reserve_deliveries (id, booking_id, kind, item_id, run_at) VALUES (?, ?, ?, ?, ?)').bind(newId(), d.bookingId, d.kind, d.itemId, d.runAt).run();
}

export async function listDueReserveDeliveries(db: D1Database, now: string, limit = 50): Promise<Array<{ id: string; bookingId: string; kind: 'reminder' | 'follow'; itemId: string }>> {
  const rows = await db
    .prepare("SELECT id, booking_id, kind, item_id FROM reserve_deliveries WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT ?")
    .bind(now, limit)
    .all<{ id: string; booking_id: string; kind: 'reminder' | 'follow'; item_id: string }>();
  return (rows.results ?? []).map((r) => ({ id: r.id, bookingId: r.booking_id, kind: r.kind, itemId: r.item_id }));
}

/** 実行を先に取る(同時に走っても二重に実行しない)。取れたら true */
export async function claimReserveDelivery(db: D1Database, id: string): Promise<boolean> {
  const r = await db.prepare("UPDATE reserve_deliveries SET status = 'done' WHERE id = ? AND status = 'pending'").bind(id).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function failReserveDelivery(db: D1Database, id: string, error: string): Promise<void> {
  await db.prepare("UPDATE reserve_deliveries SET status = 'failed', error = ? WHERE id = ?").bind(error.slice(0, 300), id).run();
}

// ── 指定した予約枠・コースの予約URL ─────────────────────────────────────────

export async function listReserveSiteLinks(db: D1Database, calendarId: string): Promise<Array<{ id: string; slotId: string | null; courseId: string | null; createdAt: string }>> {
  const rows = await db.prepare('SELECT id, slot_id, course_id, created_at FROM reserve_site_links WHERE calendar_id = ? ORDER BY created_at DESC').bind(calendarId).all<{ id: string; slot_id: string | null; course_id: string | null; created_at: string }>();
  return (rows.results ?? []).map((r) => ({ id: r.id, slotId: r.slot_id, courseId: r.course_id, createdAt: r.created_at }));
}
export async function createReserveSiteLink(db: D1Database, calendarId: string, slotId: string | null, courseId: string | null): Promise<string> {
  const id = newId();
  await db.prepare('INSERT INTO reserve_site_links (id, calendar_id, slot_id, course_id) VALUES (?, ?, ?, ?)').bind(id, calendarId, slotId, courseId).run();
  return id;
}
export async function getReserveSiteLink(db: D1Database, id: string): Promise<{ slotId: string | null; courseId: string | null; calendarId: string } | null> {
  const r = await db.prepare('SELECT calendar_id, slot_id, course_id FROM reserve_site_links WHERE id = ?').bind(id).first<{ calendar_id: string; slot_id: string | null; course_id: string | null }>();
  return r ? { calendarId: r.calendar_id, slotId: r.slot_id, courseId: r.course_id } : null;
}
export async function deleteReserveSiteLink(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM reserve_site_links WHERE id = ?').bind(id).run();
}

// ── カレンダーのコピー ──────────────────────────────────────────────────────

/** 設定(受付・予約枠・コース・紐づけ・シフト・アクションなど)をコピーして、新しいカレンダーを作る。予約・ブロック枠・Google連携は、コピーしない */
export async function copyReserveCalendar(db: D1Database, sourceId: string, name: string, today: string): Promise<ReserveCalendar> {
  const src = await getReserveCalendar(db, sourceId);
  if (!src) throw new ReserveError('コピー元のカレンダーが見つかりません');
  const created = await createReserveCalendar(db, src.lineAccountId, name);
  await db
    .prepare('UPDATE reserve_calendars SET reception = ?, slot_settings = ?, course_settings = ?, screen = ?, actions = ?, reminders = ?, follow = ? WHERE id = ?')
    .bind(JSON.stringify(src.reception), JSON.stringify(src.slotSettings), JSON.stringify(src.courseSettings), JSON.stringify(src.screen), JSON.stringify(src.actions), JSON.stringify(src.reminders), JSON.stringify(src.follow), created.id)
    .run();
  const slotMap = new Map<string, string>();
  const courseMap = new Map<string, string>();
  for (const s of await listReserveSlots(db, sourceId)) {
    const n = await createReserveSlot(db, created.id, s);
    slotMap.set(s.id, n.id);
  }
  for (const c of await listReserveCourses(db, sourceId)) {
    const n = await createReserveCourse(db, created.id, c);
    courseMap.set(c.id, n.id);
  }
  const links = (await listReserveLinks(db, sourceId)).filter((l) => slotMap.has(l.slotId) && courseMap.has(l.courseId)).map((l) => ({ slotId: slotMap.get(l.slotId)!, courseId: courseMap.get(l.courseId)! }));
  await saveReserveLinks(db, created.id, links);
  // シフトは、コピーした日以降のぶん
  const shifts = await db.prepare('SELECT * FROM reserve_shifts WHERE calendar_id = ? AND work_date >= ?').bind(sourceId, today).all<ShiftRow>();
  const seriesMap = new Map<string, string>();
  const stmts = (shifts.results ?? []).filter((s) => slotMap.has(s.slot_id)).map((s) => {
    let sid: string | null = null;
    if (s.series_id) {
      if (!seriesMap.has(s.series_id)) seriesMap.set(s.series_id, newId());
      sid = seriesMap.get(s.series_id)!;
    }
    return db
      .prepare('INSERT INTO reserve_shifts (id, calendar_id, slot_id, series_id, work_date, start_time, end_time, memo, repeat_rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(newId(), created.id, slotMap.get(s.slot_id)!, sid, s.work_date, s.start_time, s.end_time, s.memo, s.repeat_rule);
  });
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return (await getReserveCalendar(db, created.id))!;
}
