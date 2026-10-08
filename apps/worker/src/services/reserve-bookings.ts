/**
 * カレンダー予約の、予約の作成・変更・キャンセル・承認・来店済み・リマインダ/フォロー。
 * Lステップのカレンダー予約と同じ動き。受付の判断は reserve-availability.ts。
 */
import {
  addReserveBookingLog,
  addReserveDelivery,
  cancelReserveDeliveries,
  claimReserveDelivery,
  deleteReserveBooking,
  failReserveDelivery,
  getLineAccountById,
  getReserveBooking,
  getReserveCalendar,
  insertReserveBooking,
  listActiveBookingsOverlapping,
  listDueReserveDeliveries,
  listReserveCourses,
  listReserveLinks,
  listReserveShifts,
  listReserveSlots,
  updateReserveBooking,
} from '@line-crm/db';
import type { ReserveBooking, ReserveCalendar, ReserveCourse, ReserveSlot, ReserveActionKey, ScreenSettings, ScreenField } from '@line-crm/db';
import { evaluateCandidate, changeLimit, occupancyMinutes } from './reserve-availability.js';
import type { AvailabilityContext, NoReason } from './reserve-availability.js';
import { executeFriendAddAction, friendMatchesCondition } from './friend-add-settings.js';
import { notifyEvent } from './notifications.js';
import { addDays, addMinutes, dateOf, nowJst, timeOf, toMs, weekdayOf } from './reserve-time.js';

export class ReserveBookingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export interface ReserveEnv {
  WORKER_URL?: string;
}

const REASON_TEXT: Record<NoReason, string> = {
  outside_hours: '受付時間外です',
  not_started: 'まだ予約を受け付けていません',
  deadline_passed: '予約の受付を締め切りました',
  past: '過ぎた日時は予約できません',
  no_slot: '選べる予約枠がありません',
  slot_full: '選んだ日時は、すでに予約が入っています',
  total_full: '選んだ日時は、すでに予約が埋まっています',
  blocked: '選んだ日時は、予約できません',
  no_shift: '選んだ日時は、受付できる時間ではありません',
  not_linked: '選んだ予約枠では、このコースは受けられません',
};

// ── 文脈(空きの計算に必要な情報)の読み込み ──────────────────────────────────

export interface Selectable {
  slots: ReserveSlot[];
  courses: ReserveCourse[];
  links: Array<{ slotId: string; courseId: string }>;
}

/** 友だちが選べる予約枠・コース(表示中で、友だち予約可能条件を満たすもの)。管理者は全部 */
export async function loadSelectable(db: D1Database, calendar: ReserveCalendar, friendId: string | null, admin: boolean): Promise<Selectable> {
  const [slots, courses, links] = await Promise.all([listReserveSlots(db, calendar.id), listReserveCourses(db, calendar.id), listReserveLinks(db, calendar.id)]);
  const ok = async (item: { visible: boolean; condition: Record<string, unknown> | null }): Promise<boolean> => {
    if (admin) return true;
    if (!item.visible) return false;
    if (!item.condition) return true;
    if (!friendId) return false;
    try {
      return await friendMatchesCondition(db, friendId, item.condition);
    } catch {
      return false;
    }
  };
  const eligibleSlots: ReserveSlot[] = [];
  for (const s of slots) if (await ok(s)) eligibleSlots.push(admin ? { ...s, visible: true } : s);
  const eligibleCourses: ReserveCourse[] = [];
  for (const c of courses) if (await ok(c)) eligibleCourses.push(c);
  return { slots: eligibleSlots, courses: eligibleCourses, links };
}

export async function loadAvailabilityContext(
  db: D1Database,
  calendar: ReserveCalendar,
  sel: Selectable,
  range: { from: string; to: string },
  now: string = nowJst(),
): Promise<AvailabilityContext> {
  const [shifts, bookings] = await Promise.all([
    listReserveShifts(db, calendar.id, range.from, range.to),
    listActiveBookingsOverlapping(db, calendar.id, `${addDays(range.from, -1)}T00:00`, `${addDays(range.to, 1)}T23:59`),
  ]);
  return { calendar, slots: sel.slots, links: sel.links, shifts, bookings, now };
}

// ── 入力の検証 ──────────────────────────────────────────────────────────────

const KATAKANA = /^[゠-ヿ　\s・ー]+$/;

export function validateAnswers(screen: ScreenSettings, raw: Record<string, unknown>, admin: boolean): { clean: Record<string, string>; guestName: string | null } {
  const clean: Record<string, string> = {};
  let guestName: string | null = null;
  for (const f of screen.fields) {
    const v = typeof raw[f.id] === 'string' ? (raw[f.id] as string).trim() : '';
    if (!v) {
      if (f.required && !admin) throw new ReserveBookingError('invalid_answer', `「${f.label}」を入力してください`);
      continue;
    }
    if (v.length > 2000) throw new ReserveBookingError('invalid_answer', `「${f.label}」は2000文字以内で入力してください`);
    if (f.type === 'select' && !f.options.includes(v)) throw new ReserveBookingError('invalid_answer', `「${f.label}」の選択が正しくありません`);
    if (f.type === 'text') {
      if (f.textKind === 'kana' && !KATAKANA.test(v)) throw new ReserveBookingError('invalid_answer', `「${f.label}」は、カタカナで入力してください`);
      if (f.textKind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ReserveBookingError('invalid_answer', `「${f.label}」は、メールアドレスの形式で入力してください`);
      if (f.textKind === 'phone' && !/^\d{9,11}$/.test(v)) throw new ReserveBookingError('invalid_answer', `「${f.label}」は、半角数字で入力してください`);
      if (f.textKind === 'integer' && !/^-?\d+$/.test(v)) throw new ReserveBookingError('invalid_answer', `「${f.label}」は、半角の整数で入力してください`);
      if (f.textKind === 'name' && guestName === null) guestName = v;
    }
    clean[f.id] = v;
  }
  return { clean, guestName };
}

/** 回答を、友だち情報欄・本名に反映する */
export async function applyAnswersToFriend(db: D1Database, friendId: string, screen: ScreenSettings, answers: Record<string, string>): Promise<void> {
  const linked = screen.fields.filter((f: ScreenField) => (f.friendFieldKey || f.linkRealName) && answers[f.id]);
  if (linked.length === 0) return;
  const row = await db.prepare('SELECT metadata FROM friends WHERE id = ?').bind(friendId).first<{ metadata: string | null }>();
  if (!row) return;
  const meta = JSON.parse(row.metadata || '{}') as Record<string, unknown>;
  let realName: string | null = null;
  for (const f of linked) {
    if (f.friendFieldKey) meta[f.friendFieldKey] = answers[f.id];
    if (f.linkRealName) realName = answers[f.id];
  }
  const now = nowJst();
  if (realName !== null) await db.prepare('UPDATE friends SET metadata = ?, real_name = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(meta), realName, now, friendId).run();
  else await db.prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(meta), now, friendId).run();
}

// ── 表示・差し込み用 ────────────────────────────────────────────────────────

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
export function formatJaDateTime(dt: string): string {
  const [y, m, d] = dateOf(dt).split('-').map(Number);
  return `${y}年${m}月${d}日(${WEEK[weekdayOf(dateOf(dt))]}) ${timeOf(dt)}`;
}

export interface BookingNames {
  slotName: string;
  courseName: string;
}

export async function bookingNames(db: D1Database, b: Pick<ReserveBooking, 'slotId' | 'courseId'>): Promise<BookingNames> {
  const [slot, course] = await Promise.all([
    b.slotId ? db.prepare('SELECT name FROM reserve_slots WHERE id = ?').bind(b.slotId).first<{ name: string }>() : Promise.resolve(null),
    b.courseId ? db.prepare('SELECT name FROM reserve_courses WHERE id = ?').bind(b.courseId).first<{ name: string }>() : Promise.resolve(null),
  ]);
  return { slotName: slot?.name ?? '指定なし', courseName: course?.name ?? '指定なし' };
}

/** 予約から、テキスト送信の差し込み用の値を作る(予約者名・料金・予約日時・コース名・予約枠・予約確認URL。変更前の値も) */
export async function reserveVars(db: D1Database, env: ReserveEnv, calendar: ReserveCalendar, b: ReserveBooking, before?: ReserveBooking | null): Promise<Record<string, string>> {
  const account = await getLineAccountById(db, calendar.lineAccountId);
  const friend = b.friendId ? await db.prepare('SELECT display_name FROM friends WHERE id = ?').bind(b.friendId).first<{ display_name: string | null }>() : null;
  const names = await bookingNames(db, b);
  const liff = (account as unknown as { liff_id?: string | null } | null)?.liff_id;
  const base = liff ? `https://liff.line.me/${liff}` : (env.WORKER_URL ?? '');
  const vars: Record<string, string> = {
    'reserve.name': b.guestName || friend?.display_name || '',
    'reserve.price': `${b.price.toLocaleString('ja-JP')}円`,
    'reserve.datetime': formatJaDateTime(b.startsAt),
    'reserve.course': names.courseName,
    'reserve.slot': names.slotName,
    'reserve.url': `${base}?page=reserve&view=detail&id=${b.id}`,
  };
  if (before) {
    const bn = await bookingNames(db, before);
    vars['reserve.before.datetime'] = formatJaDateTime(before.startsAt);
    vars['reserve.before.course'] = bn.courseName;
    vars['reserve.before.slot'] = bn.slotName;
    vars['reserve.before.price'] = `${before.price.toLocaleString('ja-JP')}円`;
  }
  return vars;
}

/** 予約アクション(予約完了時など)を実行する。失敗しても、予約の処理は止めない */
export async function runReserveActions(db: D1Database, env: ReserveEnv, calendar: ReserveCalendar, key: ReserveActionKey, b: ReserveBooking, before?: ReserveBooking | null): Promise<void> {
  const actions = calendar.actions[key];
  if (!actions || actions.length === 0 || !b.friendId) return;
  try {
    const account = await getLineAccountById(db, calendar.lineAccountId);
    const vars = await reserveVars(db, env, calendar, b, before);
    for (const action of actions) {
      try {
        await executeFriendAddAction(db, { friendId: b.friendId, lineAccountId: calendar.lineAccountId, lineAccessToken: account?.channel_access_token, workerUrl: env.WORKER_URL, vars }, action);
      } catch (err) {
        console.error('[reserve] action failed', key, action.type, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[reserve] actions failed', key, err);
  }
}

type NotifyTiming = 'calendar_booked' | 'calendar_cancelled' | 'calendar_changed' | 'calendar_request' | 'calendar_request_approved' | 'calendar_request_rejected' | 'calendar_deleted';

async function notify(db: D1Database, timing: NotifyTiming, calendar: ReserveCalendar, b: ReserveBooking): Promise<void> {
  if (!b.friendId) return;
  const names = await bookingNames(db, b);
  await notifyEvent(db, {
    accountId: calendar.lineAccountId,
    timing,
    friendId: b.friendId,
    detail: `${calendar.name} / ${formatJaDateTime(b.startsAt)} / ${names.slotName} / ${names.courseName}`,
  });
}

// ── リマインダ・フォローの予定 ──────────────────────────────────────────────

export async function scheduleReminders(db: D1Database, calendar: ReserveCalendar, b: ReserveBooking, now: string = nowJst()): Promise<void> {
  await cancelReserveDeliveries(db, b.id, 'reminder');
  const r = calendar.reminders;
  if (!r.enabled || !r.enabledAt || b.isBlock || b.status !== 'confirmed' || !b.friendId) return;
  // オンにする前に入っていた予約には、送らない(オンにしたあとに作った・更新した予約だけ)
  const touched = b.updatedAt.slice(0, 16) > b.createdAt.slice(0, 16) ? b.updatedAt.slice(0, 16) : b.createdAt.slice(0, 16);
  if (touched < r.enabledAt) return;
  for (const item of r.items) {
    let runAt: string;
    if (item.kind === 'time') runAt = `${addDays(dateOf(b.startsAt), -item.daysBefore)}T${item.time}`;
    else runAt = addMinutes(b.startsAt, -item.amount * (item.unit === 'hours' ? 60 : 1));
    if (runAt <= now) continue;
    await addReserveDelivery(db, { bookingId: b.id, kind: 'reminder', itemId: item.id, runAt });
  }
}

export async function scheduleFollow(db: D1Database, calendar: ReserveCalendar, b: ReserveBooking, now: string = nowJst()): Promise<number> {
  await cancelReserveDeliveries(db, b.id, 'follow');
  const f = calendar.follow;
  if (!f.enabled || b.isBlock || !b.friendId) return 0;
  let count = 0;
  for (const item of f.items) {
    let runAt: string;
    if (item.kind === 'time') runAt = `${addDays(dateOf(b.startsAt), item.daysAfter)}T${item.time}`;
    else runAt = addMinutes(b.displayEndsAt ?? b.endsAt, item.amount * (item.unit === 'hours' ? 60 : 1));
    if (runAt < now) runAt = now; // すでに過ぎていれば、すぐ
    await addReserveDelivery(db, { bookingId: b.id, kind: 'follow', itemId: item.id, runAt });
    count++;
  }
  return count;
}

// ── 友だちの予約 ────────────────────────────────────────────────────────────

export interface FriendRow {
  id: string;
  line_account_id: string | null;
  line_user_id: string;
  is_following: number;
}

export interface CreateInput {
  calendar: ReserveCalendar;
  friend: FriendRow;
  slotId: string | null;
  courseId: string | null;
  startsAt: string;
  answers: Record<string, unknown>;
  consent: boolean;
  now?: string;
}

function priceOf(calendar: ReserveCalendar, course: ReserveCourse | null, slot: ReserveSlot | null, slotPriceApplied: boolean): number {
  const c = calendar.courseSettings.priceEnabled && course ? course.price : 0;
  const s = calendar.slotSettings.priceEnabled && slot && slotPriceApplied ? slot.price : 0;
  return c + s;
}

function pickSelections(calendar: ReserveCalendar, sel: Selectable, slotId: string | null, courseId: string | null, admin: boolean) {
  const slot = slotId ? sel.slots.find((s) => s.id === slotId) ?? null : null;
  const course = courseId ? sel.courses.find((c) => c.id === courseId) ?? null : null;
  if (slotId && !slot) throw new ReserveBookingError('invalid_slot', '選べない予約枠です');
  if (courseId && !course) throw new ReserveBookingError('invalid_course', '選べないコースです');
  if (!admin && calendar.slotSettings.required && sel.slots.length > 0 && !slot) throw new ReserveBookingError('slot_required', `${calendar.slotSettings.title}を選んでください`);
  if (!admin && calendar.courseSettings.required && sel.courses.length > 0 && !course) throw new ReserveBookingError('course_required', `${calendar.courseSettings.title}を選んでください`);
  return { slot, course };
}

export async function createFriendBooking(db: D1Database, env: ReserveEnv, input: CreateInput): Promise<ReserveBooking> {
  const { calendar, friend } = input;
  const now = input.now ?? nowJst();
  if (calendar.status !== 'active') throw new ReserveBookingError('stopped', '現在、予約受付を停止しています。', 403);
  if (!friend.is_following) throw new ReserveBookingError('cannot_book', '予約できません', 403);
  if (calendar.screen.consent.show && !input.consent) throw new ReserveBookingError('consent_required', `${calendar.screen.consent.title || '注意事項・利用規約'}に同意してください`);
  const sel = await loadSelectable(db, calendar, friend.id, false);
  const { slot, course } = pickSelections(calendar, sel, input.slotId, input.courseId, false);
  const { clean, guestName } = validateAnswers(calendar.screen, input.answers, false);

  const date = dateOf(input.startsAt);
  const ctx = await loadAvailabilityContext(db, calendar, sel, { from: date, to: date }, now);
  const ev = evaluateCandidate(ctx, { startsAt: input.startsAt, slotId: slot?.id ?? null, course });
  if (!ev.ok) throw new ReserveBookingError('unavailable', REASON_TEXT[ev.reason ?? 'slot_full'], 409);

  const assignedSlot = slot ?? (ev.assignedSlotId ? sel.slots.find((s) => s.id === ev.assignedSlotId) ?? null : null);
  const occ = occupancyMinutes(ctx, course);
  const isRequest = calendar.reception.approval.newBooking === 'request';
  const booking = await insertReserveBooking(db, {
    calendarId: calendar.id,
    lineAccountId: calendar.lineAccountId,
    friendId: friend.id,
    slotId: assignedSlot?.id ?? null,
    courseId: course?.id ?? null,
    startsAt: input.startsAt,
    endsAt: addMinutes(input.startsAt, occ),
    displayEndsAt: course?.displayMinutes ? addMinutes(input.startsAt, course.displayMinutes) : null,
    status: isRequest ? 'pending' : 'confirmed',
    pendingKind: isRequest ? 'new' : null,
    createdBy: 'friend',
    answers: clean,
    guestName,
    price: priceOf(calendar, course, assignedSlot, true),
    slotPriceApplied: true,
  });

  // 同時に、別の人が同じ枠を取っていないか、もう一度確かめる(取り合いになったら、あとの人を断る)
  const ctx2 = await loadAvailabilityContext(db, calendar, sel, { from: date, to: date }, now);
  const again = evaluateCandidate(ctx2, { startsAt: input.startsAt, slotId: booking.slotId, course }, { ignoreBookingId: booking.id });
  if (!again.ok) {
    await deleteReserveBooking(db, booking.id);
    throw new ReserveBookingError('unavailable', REASON_TEXT[again.reason ?? 'slot_full'], 409);
  }

  await addReserveBookingLog(db, booking.id, isRequest ? 'request' : 'created', isRequest ? '友だちが予約をリクエストしました' : '友だちが予約しました', 'friend');
  await applyAnswersToFriend(db, friend.id, calendar.screen, clean).catch((e) => console.error('[reserve] apply answers failed', e));
  if (isRequest) {
    await runReserveActions(db, env, calendar, 'requestNewSubmitted', booking);
    await notify(db, 'calendar_request', calendar, booking);
  } else {
    await scheduleReminders(db, calendar, booking, now);
    await runReserveActions(db, env, calendar, 'onBooked', booking);
    await notify(db, 'calendar_booked', calendar, booking);
  }
  return booking;
}

function assertOwner(calendar: ReserveCalendar, booking: ReserveBooking | null, friendId: string): ReserveBooking {
  if (!booking || booking.calendarId !== calendar.id || booking.friendId !== friendId || booking.isBlock) throw new ReserveBookingError('not_found', '予約が見つかりません', 404);
  return booking;
}

export interface ChangeInput {
  calendar: ReserveCalendar;
  friend: FriendRow;
  bookingId: string;
  slotId: string | null;
  courseId: string | null;
  startsAt: string;
  answers?: Record<string, unknown>;
  now?: string;
}

/** 友だちが、予約を変更する(リクエスト制なら、リクエストにする) */
export async function changeFriendBooking(db: D1Database, env: ReserveEnv, input: ChangeInput): Promise<ReserveBooking> {
  const { calendar, friend } = input;
  const now = input.now ?? nowJst();
  const cur = assertOwner(calendar, await getReserveBooking(db, input.bookingId), friend.id);
  if (calendar.status !== 'active') throw new ReserveBookingError('stopped', '現在、予約受付を停止しています。', 403);
  if (cur.status === 'cancelled' || cur.status === 'rejected') throw new ReserveBookingError('not_changeable', 'この予約は、変更できません', 409);
  if (cur.pendingKind) throw new ReserveBookingError('pending_exists', '承認待ちのリクエストがあるため、変更できません', 409);
  const unapproved = cur.status === 'pending';
  const mode = calendar.reception.approval.change;
  if (!unapproved && mode === 'deny') throw new ReserveBookingError('not_allowed', 'この予約は、友だちからは変更できません', 403);
  if (!unapproved && now > changeLimit(cur.startsAt, calendar.reception.changeDeadline)) throw new ReserveBookingError('deadline_passed', '変更の受付期限を過ぎています', 403);

  const sel = await loadSelectable(db, calendar, friend.id, false);
  const { slot, course } = pickSelections(calendar, sel, input.slotId, input.courseId, false);
  const answersIn = input.answers ?? cur.answers;
  const { clean, guestName } = validateAnswers(calendar.screen, answersIn as Record<string, unknown>, false);
  const date = dateOf(input.startsAt);
  const ctx = await loadAvailabilityContext(db, calendar, sel, { from: date, to: date }, now);
  const ev = evaluateCandidate(ctx, { startsAt: input.startsAt, slotId: slot?.id ?? null, course }, { ignoreBookingId: cur.id });
  if (!ev.ok) throw new ReserveBookingError('unavailable', REASON_TEXT[ev.reason ?? 'slot_full'], 409);
  const assignedSlot = slot ?? (ev.assignedSlotId ? sel.slots.find((s) => s.id === ev.assignedSlotId) ?? null : null);
  const occ = occupancyMinutes(ctx, course);
  const next = {
    slotId: assignedSlot?.id ?? null,
    courseId: course?.id ?? null,
    startsAt: input.startsAt,
    endsAt: addMinutes(input.startsAt, occ),
    displayEndsAt: course?.displayMinutes ? addMinutes(input.startsAt, course.displayMinutes) : null,
    price: priceOf(calendar, course, assignedSlot, true),
  };

  if (!unapproved && mode === 'request') {
    const updated = (await updateReserveBooking(db, cur.id, { pendingKind: 'change', pendingPayload: { ...next, answers: clean, guestName } }))!;
    await addReserveBookingLog(db, cur.id, 'change_request', '友だちが予約の変更をリクエストしました', 'friend');
    await runReserveActions(db, env, calendar, 'requestChangeSubmitted', updated, cur);
    await notify(db, 'calendar_request', calendar, updated);
    return updated;
  }
  const updated = (await updateReserveBooking(db, cur.id, { ...next, answers: clean, guestName }))!;
  await addReserveBookingLog(db, cur.id, 'changed', '友だちが予約を変更しました', 'friend');
  await applyAnswersToFriend(db, friend.id, calendar.screen, clean).catch(() => undefined);
  if (updated.status === 'confirmed') await scheduleReminders(db, calendar, updated, now);
  await runReserveActions(db, env, calendar, unapproved ? 'requestNewSubmitted' : 'onChanged', updated, cur);
  await notify(db, 'calendar_changed', calendar, updated);
  return updated;
}

export async function cancelFriendBooking(db: D1Database, env: ReserveEnv, input: { calendar: ReserveCalendar; friend: FriendRow; bookingId: string; now?: string }): Promise<ReserveBooking> {
  const { calendar, friend } = input;
  const now = input.now ?? nowJst();
  const cur = assertOwner(calendar, await getReserveBooking(db, input.bookingId), friend.id);
  if (cur.status === 'cancelled' || cur.status === 'rejected') throw new ReserveBookingError('not_cancellable', 'この予約は、すでにキャンセルされています', 409);
  if (cur.pendingKind && cur.pendingKind !== 'new') throw new ReserveBookingError('pending_exists', '承認待ちのリクエストがあるため、キャンセルできません', 409);
  const unapproved = cur.status === 'pending';
  const mode = calendar.reception.approval.cancel;
  if (!unapproved && mode === 'deny') throw new ReserveBookingError('not_allowed', 'この予約は、友だちからはキャンセルできません', 403);
  if (!unapproved && now > changeLimit(cur.startsAt, calendar.reception.cancelDeadline)) throw new ReserveBookingError('deadline_passed', 'キャンセルの受付期限を過ぎています', 403);

  if (!unapproved && mode === 'request') {
    const updated = (await updateReserveBooking(db, cur.id, { pendingKind: 'cancel', pendingPayload: null }))!;
    await addReserveBookingLog(db, cur.id, 'cancel_request', '友だちが予約のキャンセルをリクエストしました', 'friend');
    await runReserveActions(db, env, calendar, 'requestCancelSubmitted', updated);
    await notify(db, 'calendar_request', calendar, updated);
    return updated;
  }
  const updated = (await updateReserveBooking(db, cur.id, { status: 'cancelled', pendingKind: null, pendingPayload: null }))!;
  await cancelReserveDeliveries(db, cur.id);
  await addReserveBookingLog(db, cur.id, 'cancelled', '友だちが予約をキャンセルしました', 'friend');
  await runReserveActions(db, env, calendar, 'onCancelled', updated);
  await notify(db, 'calendar_cancelled', calendar, updated);
  return updated;
}

// ── 管理者の操作 ────────────────────────────────────────────────────────────

export interface AdminCreateInput {
  calendar: ReserveCalendar;
  actor: string;
  friendId: string | null;
  slotId: string | null;
  courseId: string | null;
  startsAt: string;
  /** 終了時刻を直接指定するとき(日時)。なければ、コースの所要時間(なければ、未指定時の所要時間) */
  endsAt?: string | null;
  isBlock: boolean;
  answers: Record<string, unknown>;
  runActions: boolean;
  slotPriceApplied: boolean;
  /** 友だちを選んだとき、回答を友だち情報・本名に上書きするか */
  overwriteFriend: boolean;
  memo?: string;
}

export async function adminCreateBooking(db: D1Database, env: ReserveEnv, input: AdminCreateInput): Promise<ReserveBooking> {
  const { calendar } = input;
  const sel = await loadSelectable(db, calendar, input.friendId, true);
  const { slot, course } = pickSelections(calendar, sel, input.slotId, input.courseId, true);
  if (!input.isBlock && !input.friendId && !input.answers) throw new ReserveBookingError('friend_required', '友だちを選ぶか、お名前を入力してください');
  const { clean, guestName } = validateAnswers(calendar.screen, input.answers ?? {}, true);
  const occ = course ? course.durationMinutes : calendar.courseSettings.unspecifiedMinutes;
  const endsAt = input.endsAt ?? addMinutes(input.startsAt, occ);
  if (toMs(endsAt) <= toMs(input.startsAt)) throw new ReserveBookingError('invalid_time', '終了時間は、開始時間より後にしてください');
  if (input.friendId) {
    const f = await db.prepare('SELECT id, line_account_id, is_following FROM friends WHERE id = ?').bind(input.friendId).first<{ id: string; line_account_id: string | null; is_following: number }>();
    if (!f || f.line_account_id !== calendar.lineAccountId) throw new ReserveBookingError('friend_not_found', '友だちが見つかりません', 404);
    if (!f.is_following) throw new ReserveBookingError('friend_blocked', 'ブロックされている友だちは、選べません');
  }
  const booking = await insertReserveBooking(db, {
    calendarId: calendar.id,
    lineAccountId: calendar.lineAccountId,
    friendId: input.isBlock ? null : input.friendId,
    slotId: slot?.id ?? null,
    courseId: input.isBlock ? null : (course?.id ?? null),
    isBlock: input.isBlock,
    startsAt: input.startsAt,
    endsAt,
    displayEndsAt: !input.isBlock && course?.displayMinutes ? addMinutes(input.startsAt, course.displayMinutes) : null,
    status: 'confirmed',
    createdBy: 'admin',
    answers: input.isBlock ? {} : clean,
    guestName: input.isBlock ? null : guestName,
    price: input.isBlock ? 0 : priceOf(calendar, course, slot, input.slotPriceApplied),
    slotPriceApplied: input.slotPriceApplied,
    memo: input.memo ?? '',
  });
  await addReserveBookingLog(db, booking.id, input.isBlock ? 'block' : 'created', input.isBlock ? '管理者がブロック枠を作成しました' : '管理者が予約を登録しました', input.actor);
  if (!input.isBlock && input.friendId) {
    if (input.overwriteFriend) await applyAnswersToFriend(db, input.friendId, calendar.screen, clean).catch(() => undefined);
    await scheduleReminders(db, calendar, booking);
    if (input.runActions) await runReserveActions(db, env, calendar, 'onBooked', booking);
    await notify(db, 'calendar_booked', calendar, booking);
  }
  return booking;
}

export interface AdminUpdateInput {
  calendar: ReserveCalendar;
  actor: string;
  bookingId: string;
  startsAt?: string;
  endsAt?: string | null;
  slotId?: string | null;
  courseId?: string | null;
  friendId?: string | null;
  answers?: Record<string, unknown>;
  slotPriceApplied?: boolean;
  runActions: boolean;
}

export async function adminUpdateBooking(db: D1Database, env: ReserveEnv, input: AdminUpdateInput): Promise<ReserveBooking> {
  const { calendar } = input;
  const cur = await getReserveBooking(db, input.bookingId);
  if (!cur || cur.calendarId !== calendar.id) throw new ReserveBookingError('not_found', '予約が見つかりません', 404);
  const sel = await loadSelectable(db, calendar, input.friendId ?? cur.friendId, true);
  const slotId = input.slotId === undefined ? cur.slotId : input.slotId;
  const courseId = input.courseId === undefined ? cur.courseId : input.courseId;
  const { slot, course } = pickSelections(calendar, sel, slotId, courseId, true);
  const startsAt = input.startsAt ?? cur.startsAt;
  const timeChanged = input.startsAt !== undefined || input.courseId !== undefined || input.endsAt !== undefined;
  const occ = course ? course.durationMinutes : calendar.courseSettings.unspecifiedMinutes;
  const endsAt = input.endsAt ?? (timeChanged ? addMinutes(startsAt, occ) : cur.endsAt);
  if (toMs(endsAt) <= toMs(startsAt)) throw new ReserveBookingError('invalid_time', '終了時間は、開始時間より後にしてください');
  let answers = cur.answers;
  let guestName = cur.guestName;
  if (input.answers) {
    const v = validateAnswers(calendar.screen, input.answers, true);
    answers = v.clean;
    guestName = v.guestName;
  }
  const slotPriceApplied = input.slotPriceApplied ?? cur.slotPriceApplied;
  const updated = (await updateReserveBooking(db, cur.id, {
    slotId: slot?.id ?? null,
    courseId: course?.id ?? null,
    friendId: input.friendId === undefined ? cur.friendId : input.friendId,
    startsAt,
    endsAt,
    displayEndsAt: course?.displayMinutes ? addMinutes(startsAt, course.displayMinutes) : null,
    answers,
    guestName,
    slotPriceApplied,
    price: cur.isBlock ? 0 : priceOf(calendar, course, slot, slotPriceApplied),
  }))!;
  await addReserveBookingLog(db, cur.id, 'changed', '管理者が予約を変更しました', input.actor);
  if (!updated.isBlock) {
    if (updated.status === 'confirmed') await scheduleReminders(db, calendar, updated);
    if (input.runActions && timeChanged) await runReserveActions(db, env, calendar, 'onChanged', updated, cur);
    await notify(db, 'calendar_changed', calendar, updated);
  }
  return updated;
}

/** 管理者が、予約のステータスを変える(キャンセル済みに) */
export async function adminCancelBooking(db: D1Database, env: ReserveEnv, input: { calendar: ReserveCalendar; actor: string; bookingId: string; runActions: boolean }): Promise<ReserveBooking> {
  const cur = await getReserveBooking(db, input.bookingId);
  if (!cur || cur.calendarId !== input.calendar.id) throw new ReserveBookingError('not_found', '予約が見つかりません', 404);
  const updated = (await updateReserveBooking(db, cur.id, { status: 'cancelled', pendingKind: null, pendingPayload: null }))!;
  await cancelReserveDeliveries(db, cur.id);
  await addReserveBookingLog(db, cur.id, 'cancelled', '管理者が予約をキャンセルしました', input.actor);
  if (!cur.isBlock) {
    if (input.runActions) await runReserveActions(db, env, input.calendar, 'onCancelled', updated);
    await notify(db, 'calendar_cancelled', input.calendar, updated);
  }
  return updated;
}

export async function adminDeleteBooking(db: D1Database, input: { calendar: ReserveCalendar; bookingId: string }): Promise<void> {
  const cur = await getReserveBooking(db, input.bookingId);
  if (!cur || cur.calendarId !== input.calendar.id) throw new ReserveBookingError('not_found', '予約が見つかりません', 404);
  await deleteReserveBooking(db, cur.id);
  if (!cur.isBlock) await notify(db, 'calendar_deleted', input.calendar, cur);
}

/** 友だちからのリクエスト(新規・変更・キャンセル)を、承認・否認する */
export async function decideRequest(
  db: D1Database,
  env: ReserveEnv,
  input: { calendar: ReserveCalendar; actor: string; bookingId: string; decision: 'approve' | 'reject'; runActions: boolean; now?: string },
): Promise<ReserveBooking> {
  const { calendar } = input;
  const now = input.now ?? nowJst();
  const cur = await getReserveBooking(db, input.bookingId);
  if (!cur || cur.calendarId !== calendar.id) throw new ReserveBookingError('not_found', '予約が見つかりません', 404);
  const kind = cur.status === 'pending' ? 'new' : cur.pendingKind;
  if (!kind) throw new ReserveBookingError('no_request', '承認待ちのリクエストではありません', 409);
  const approve = input.decision === 'approve';
  let updated: ReserveBooking;
  let key: ReserveActionKey;

  if (kind === 'new') {
    if (approve) {
      // 承認するときも、まだ空いているか確かめる(自分の分は、数えない)
      const sel = await loadSelectable(db, calendar, cur.friendId, true);
      const date = dateOf(cur.startsAt);
      const ctx = await loadAvailabilityContext(db, calendar, sel, { from: date, to: date }, now);
      const course = cur.courseId ? sel.courses.find((c) => c.id === cur.courseId) ?? null : null;
      const ev = evaluateCandidate(ctx, { startsAt: cur.startsAt, slotId: cur.slotId, course }, { ignoreBookingId: cur.id, adminOverride: true });
      if (!ev.ok) throw new ReserveBookingError('unavailable', REASON_TEXT[ev.reason ?? 'slot_full'], 409);
      updated = (await updateReserveBooking(db, cur.id, { status: 'confirmed', pendingKind: null }))!;
      await scheduleReminders(db, calendar, updated, now);
    } else {
      updated = (await updateReserveBooking(db, cur.id, { status: 'rejected', pendingKind: null }))!;
    }
    key = approve ? 'requestNewApproved' : 'requestNewRejected';
  } else if (kind === 'change') {
    if (approve) {
      const p = (cur.pendingPayload ?? {}) as Record<string, unknown>;
      updated = (await updateReserveBooking(db, cur.id, {
        slotId: (p.slotId as string | null) ?? null,
        courseId: (p.courseId as string | null) ?? null,
        startsAt: String(p.startsAt ?? cur.startsAt),
        endsAt: String(p.endsAt ?? cur.endsAt),
        displayEndsAt: (p.displayEndsAt as string | null) ?? null,
        price: typeof p.price === 'number' ? p.price : cur.price,
        answers: (p.answers as Record<string, string>) ?? cur.answers,
        guestName: (p.guestName as string | null) ?? cur.guestName,
        pendingKind: null,
        pendingPayload: null,
      }))!;
      await scheduleReminders(db, calendar, updated, now);
    } else {
      updated = (await updateReserveBooking(db, cur.id, { pendingKind: null, pendingPayload: null }))!;
    }
    key = approve ? 'requestChangeApproved' : 'requestChangeRejected';
  } else {
    if (approve) {
      updated = (await updateReserveBooking(db, cur.id, { status: 'cancelled', pendingKind: null, pendingPayload: null }))!;
      await cancelReserveDeliveries(db, cur.id);
    } else {
      updated = (await updateReserveBooking(db, cur.id, { pendingKind: null, pendingPayload: null }))!;
    }
    key = approve ? 'requestCancelApproved' : 'requestCancelRejected';
  }
  await addReserveBookingLog(db, cur.id, approve ? 'approved' : 'rejected', `管理者がリクエストを${approve ? '承認' : '否認'}しました`, input.actor);
  if (input.runActions) await runReserveActions(db, env, calendar, key, updated, kind === 'change' ? cur : null);
  await notify(db, approve ? 'calendar_request_approved' : 'calendar_request_rejected', calendar, updated);
  return updated;
}

/** 来店/来場済みにする(フォローを実行するか選べる) */
export async function markVisited(db: D1Database, calendar: ReserveCalendar, actor: string, bookingId: string, visited: boolean, runFollow: boolean): Promise<ReserveBooking> {
  const cur = await getReserveBooking(db, bookingId);
  if (!cur || cur.calendarId !== calendar.id || cur.isBlock) throw new ReserveBookingError('not_found', '予約が見つかりません', 404);
  if (!visited) {
    await cancelReserveDeliveries(db, cur.id, 'follow');
    const u = (await updateReserveBooking(db, cur.id, { visited: false, visitedAt: null, followState: 'none' }))!;
    await addReserveBookingLog(db, cur.id, 'visited_off', '来店/来場済みを解除しました', actor);
    return u;
  }
  let followState: 'none' | 'running' = 'none';
  if (runFollow && calendar.follow.enabled) {
    const n = await scheduleFollow(db, calendar, cur);
    followState = n > 0 ? 'running' : 'none';
  }
  const updated = (await updateReserveBooking(db, cur.id, { visited: true, visitedAt: nowJst(), followState }))!;
  await addReserveBookingLog(db, cur.id, 'visited', `来店/来場済みにしました${followState === 'running' ? '(フォローを開始)' : ''}`, actor);
  return updated;
}

// ── 時刻が来たリマインダ・フォローの実行(cron) ──────────────────────────────

export async function processReserveDeliveries(db: D1Database, env: ReserveEnv, limit = 50): Promise<number> {
  const due = await listDueReserveDeliveries(db, nowJst(), limit);
  let done = 0;
  for (const d of due) {
    if (!(await claimReserveDelivery(db, d.id))) continue;
    try {
      const b = await getReserveBooking(db, d.bookingId);
      if (!b || !b.friendId || b.isBlock) continue;
      const calendar = await getReserveCalendar(db, b.calendarId);
      if (!calendar) continue;
      const items = d.kind === 'reminder' ? calendar.reminders : calendar.follow;
      const enabled = items.enabled;
      const item = (items.items as Array<{ id: string; actions: import('@line-crm/db').FriendAddAction[] }>).find((x) => x.id === d.itemId);
      if (!enabled || !item) continue;
      if (d.kind === 'reminder' && b.status !== 'confirmed') continue;
      if (d.kind === 'follow' && !b.visited) continue;
      const account = await getLineAccountById(db, calendar.lineAccountId);
      const vars = await reserveVars(db, env, calendar, b);
      for (const action of item.actions) {
        await executeFriendAddAction(db, { friendId: b.friendId, lineAccountId: calendar.lineAccountId, lineAccessToken: account?.channel_access_token, workerUrl: env.WORKER_URL, vars }, action).catch((e) => {
          throw e;
        });
      }
      done++;
      if (d.kind === 'follow') {
        const left = await db.prepare("SELECT COUNT(*) AS c FROM reserve_deliveries WHERE booking_id = ? AND kind = 'follow' AND status = 'pending'").bind(b.id).first<{ c: number }>();
        if ((left?.c ?? 0) === 0) await updateReserveBooking(db, b.id, { followState: 'done' });
      }
    } catch (err) {
      await failReserveDelivery(db, d.id, err instanceof Error ? err.message : String(err));
    }
  }
  return done;
}
