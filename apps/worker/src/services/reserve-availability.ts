/**
 * カレンダー予約の、空き(◯/✕)の判断。Lステップのカレンダー予約と同じルール:
 *  - 受付時間(曜日ごと/毎日共通。特定日 > 祝日 > 曜日)の範囲に、所要時間がおさまること
 *  - 受付期間(受付開始・受付締切)
 *  - シフト連動(予約枠にシフトがある時間だけ)
 *  - 全体の同時予約可能数・予約枠ごとの同時予約可能数
 *  - 予約枠を選ばない(指名なし)予約は、「予約可能な予約枠の空き」と「同じ時間帯の全予約(指名なし含む)」を照らして判断
 *  - ブロック枠(予約枠を指定=その枠だけ/指定なし=指名なし予約だけ、入らない)
 * 時刻は、すべて日本時間の文字(YYYY-MM-DDTHH:MM)。
 */
import type { DayRule, ReceptionSettings, ReserveBooking, ReserveCalendar, ReserveCourse, ReserveShift, ReserveSlot, TimeRange } from '@line-crm/db';
import { deadlineDays, deadlineMinutesBefore } from '@line-crm/db';
import { addDays, addMinutes, dateOf, hhmmToMinutes, isJapaneseHoliday, minutesToHhmm, timeOf, toMs, weekdayOf } from './reserve-time.js';

export type NoReason =
  | 'outside_hours'
  | 'not_started'
  | 'deadline_passed'
  | 'past'
  | 'no_slot'
  | 'slot_full'
  | 'total_full'
  | 'blocked'
  | 'no_shift'
  | 'not_linked';

export interface AvailabilityContext {
  calendar: Pick<ReserveCalendar, 'reception' | 'slotSettings' | 'courseSettings' | 'screen'>;
  /** この友だち(または管理者)が選べる予約枠(表示中で、条件を満たすもの) */
  slots: ReserveSlot[];
  links: Array<{ slotId: string; courseId: string }>;
  shifts: ReserveShift[];
  /** 有効な予約(予約済み・承認待ち・ブロック枠)。対象の期間にかかるもの */
  bookings: ReserveBooking[];
  now: string;
}

export interface Candidate {
  startsAt: string;
  /** null=予約枠なし(指名なし) */
  slotId: string | null;
  course: ReserveCourse | null;
}

export interface Evaluation {
  ok: boolean;
  reason?: NoReason;
  /** 自動振り分けで決まる予約枠(指名なしのとき) */
  assignedSlotId?: string | null;
}

const INF = Number.POSITIVE_INFINITY;

/** 受付時間の1日ぶんの規則 */
export function dayRuleFor(r: ReceptionSettings, date: string): DayRule {
  const special = r.specialDays.find((s) => s.date === date);
  if (special) return special;
  if (r.hoursMode === 'daily') return r.daily;
  if (isJapaneseHoliday(date)) return r.weekdays.holiday;
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  return r.weekdays[keys[weekdayOf(date)]];
}

export function rangesOfRule(rule: DayRule): TimeRange[] {
  if (rule.closed) return [];
  if (rule.allDay) return [{ from: '00:00', to: '24:00' }];
  return rule.ranges;
}

export function occupancyMinutes(ctx: Pick<AvailabilityContext, 'calendar'>, course: ReserveCourse | null): number {
  return course ? course.durationMinutes : ctx.calendar.courseSettings.unspecifiedMinutes;
}

const slotCapacity = (ctx: AvailabilityContext, s: ReserveSlot): number => s.capacity ?? ctx.calendar.slotSettings.defaultCapacity ?? INF;

interface Span {
  s: number;
  e: number;
}

/** 区間 [s, e) の中で、同時に重なっている数の最大 */
function peak(items: Span[], s: number, e: number): number {
  const ev: Array<[number, number]> = [];
  for (const it of items) {
    if (it.s < e && it.e > s) ev.push([Math.max(it.s, s), 1], [Math.min(it.e, e), -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of ev) {
    cur += d;
    if (cur > max) max = cur;
  }
  return max;
}

const spanOf = (b: Pick<ReserveBooking, 'startsAt' | 'endsAt'>): Span => ({ s: toMs(b.startsAt), e: toMs(b.endsAt) });

/** 受付開始・受付締切(受付期間)を、この予約日時に当てはめて判断する */
export function checkReceptionPeriod(r: ReceptionSettings, startsAt: string, now: string): NoReason | null {
  const startMs = toMs(startsAt);
  const nowMs = toMs(now);
  if (startMs <= nowMs) return 'past';
  const st = r.start;
  if (st.mode === 'relative') {
    const unitMin = st.unit === 'days' ? 1440 : st.unit === 'hours' ? 60 : 1;
    if (nowMs < startMs - st.amount * unitMin * 60_000) return 'not_started';
  } else if (st.mode === 'at') {
    if (nowMs < toMs(st.at)) return 'not_started';
  }
  const dl = r.deadline;
  if (dl.mode === 'relative') {
    let limit: number;
    if (dl.unit === 'days') {
      const d = addDays(dateOf(startsAt), -dl.amount);
      limit = toMs(`${d}T${dl.time ?? '00:00'}`);
    } else {
      limit = startMs - dl.amount * (dl.unit === 'hours' ? 60 : 1) * 60_000;
    }
    if (nowMs > limit) return 'deadline_passed';
  } else if (dl.mode === 'at') {
    if (nowMs > toMs(dl.at)) return 'deadline_passed';
  }
  return null;
}

/** 友だちが、予約の変更・キャンセルをできる最終の日時(日本時間)。これを過ぎたらできない */
export function changeLimit(startsAt: string, key: ReceptionSettings['changeDeadline']): string {
  const days = deadlineDays(key);
  if (days !== null) {
    // 前日まで=予約日の0時まで、2日前まで=予約日の前日の0時まで…
    return `${addDays(dateOf(startsAt), -(days - 1))}T00:00`;
  }
  return addMinutes(startsAt, -(deadlineMinutesBefore(key) ?? 0));
}

/** シフトが、区間をまるごと覆っているか(予約枠・日付ごと。つながったシフトは、まとめて覆うとみなす) */
function shiftCovers(shifts: ReserveShift[], slotId: string, date: string, from: number, to: number): boolean {
  const ranges = shifts
    .filter((x) => x.slotId === slotId && x.workDate === date)
    .map((x) => [hhmmToMinutes(x.startTime), hhmmToMinutes(x.endTime)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let cur = from;
  for (const [s, e] of ranges) {
    if (s <= cur && e > cur) cur = e;
    if (cur >= to) return true;
  }
  return cur >= to;
}

/** 予約枠が、この予約日時・コースで、受け付けられるか(シフト・紐づけ・時間帯。人数は見ない) */
function slotUsable(ctx: AvailabilityContext, s: ReserveSlot, cand: Candidate, from: number, to: number): NoReason | null {
  if (cand.course && !ctx.links.some((l) => l.slotId === s.id && l.courseId === cand.course!.id)) return 'not_linked';
  if (ctx.calendar.slotSettings.shiftLinked && !shiftCovers(ctx.shifts, s.id, dateOf(cand.startsAt), from, to)) return 'no_shift';
  return null;
}

/** 1つの予約日時が、予約できるかを判断する */
export function evaluateCandidate(ctx: AvailabilityContext, cand: Candidate, opts: { ignoreBookingId?: string; adminOverride?: boolean } = {}): Evaluation {
  const r = ctx.calendar.reception;
  const date = dateOf(cand.startsAt);
  const occ = occupancyMinutes(ctx, cand.course);
  const fromMin = hhmmToMinutes(timeOf(cand.startsAt));
  const toMin = fromMin + occ;
  const endsAt = addMinutes(cand.startsAt, occ);
  const sMs = toMs(cand.startsAt);
  const eMs = toMs(endsAt);

  if (!opts.adminOverride) {
    // 受付時間
    const ranges = rangesOfRule(dayRuleFor(r, date));
    const inHours = ranges.some((x) => hhmmToMinutes(x.from) <= fromMin && toMin <= (x.to === '24:00' ? 1440 : hhmmToMinutes(x.to)));
    if (!inHours) return { ok: false, reason: 'outside_hours' };
    // 受付期間
    const period = checkReceptionPeriod(r, cand.startsAt, ctx.now);
    if (period) return { ok: false, reason: period };
  }

  const active = ctx.bookings.filter((b) => b.id !== opts.ignoreBookingId && (b.status === 'confirmed' || b.status === 'pending'));
  const blocks = active.filter((b) => b.isBlock);
  const normal = active.filter((b) => !b.isBlock);

  // 全体の同時予約可能数
  if (r.totalCapacity !== null && !opts.adminOverride) {
    if (peak(normal.map(spanOf), sMs, eMs) + 1 > r.totalCapacity) return { ok: false, reason: 'total_full' };
  }

  const slotsAll = ctx.slots.filter((s) => s.visible);

  // 予約枠が1つも無いカレンダーは、「予約枠なし」の1本だけの枠として扱う
  if (slotsAll.length === 0) {
    if (cand.slotId) return { ok: false, reason: 'no_slot' };
    if (blocks.some((b) => b.slotId === null && spanOf(b).s < eMs && spanOf(b).e > sMs)) return { ok: false, reason: 'blocked' };
    const cap = ctx.calendar.slotSettings.defaultCapacity ?? INF;
    const used = peak(normal.map(spanOf), sMs, eMs);
    return used + 1 <= cap || opts.adminOverride ? { ok: true, assignedSlotId: null } : { ok: false, reason: 'slot_full' };
  }

  const overlapsBlock = (slotId: string | null) => blocks.some((b) => b.slotId === slotId && spanOf(b).s < eMs && spanOf(b).e > sMs);
  const usedBySlot = (slotId: string) => peak(normal.filter((b) => b.slotId === slotId).map(spanOf), sMs, eMs);
  const unassignedPeak = peak(normal.filter((b) => b.slotId === null).map(spanOf), sMs, eMs);

  // 受け付けられる予約枠(シフト・紐づけ・時間帯)と、それぞれの空き
  const usable: Array<{ slot: ReserveSlot; free: number; reason: NoReason | null }> = slotsAll.map((s) => {
    const reason = slotUsable(ctx, s, cand, fromMin, toMin);
    const cap = slotCapacity(ctx, s);
    const free = overlapsBlock(s.id) ? 0 : cap === INF ? INF : Math.max(0, cap - usedBySlot(s.id));
    return { slot: s, free, reason: overlapsBlock(s.id) && !reason ? 'blocked' : reason };
  });

  if (cand.slotId) {
    const me = usable.find((u) => u.slot.id === cand.slotId);
    if (!me) return { ok: false, reason: 'no_slot' };
    if (me.reason && !(opts.adminOverride && (me.reason === 'no_shift' || me.reason === 'blocked'))) return { ok: false, reason: me.reason };
    if (opts.adminOverride) return { ok: true, assignedSlotId: cand.slotId };
    if (me.free < 1) return { ok: false, reason: 'slot_full' };
    // 指名なしの予約が、すでに入っているぶんを、他の枠で受けられなくなるなら、この枠は取れない
    const others = usable.filter((u) => u.slot.id !== cand.slotId && !u.reason).reduce((sum, u) => sum + u.free, 0);
    if (me.free - 1 + others < unassignedPeak) return { ok: false, reason: 'slot_full' };
    return { ok: true, assignedSlotId: cand.slotId };
  }

  // 指名なし
  if (!opts.adminOverride && overlapsBlock(null)) return { ok: false, reason: 'blocked' };
  const pool = usable.filter((u) => !u.reason);
  if (pool.length === 0) {
    const why = usable.find((u) => u.reason)?.reason ?? 'no_slot';
    return { ok: false, reason: why };
  }
  const totalFree = pool.reduce((sum, u) => sum + u.free, 0);
  if (totalFree - unassignedPeak < 1 && !opts.adminOverride) return { ok: false, reason: 'slot_full' };

  // 自動振り分け(予約枠の選択が任意で、有効のとき): 優先度の高い順に、空きのある枠へ
  let assignedSlotId: string | null = null;
  if (ctx.calendar.slotSettings.autoAssign && !ctx.calendar.slotSettings.required) {
    const order = pool
      .filter((u) => u.slot.autoAssign && u.free >= 1)
      .sort((a, b) => a.slot.priority - b.slot.priority || a.slot.sortOrder - b.slot.sortOrder);
    if (order.length === 0 && !opts.adminOverride) return { ok: false, reason: 'slot_full' };
    assignedSlotId = order[0]?.slot.id ?? null;
  }
  return { ok: true, assignedSlotId };
}

/** 1日ぶんの、予約できる開始時刻の一覧(◯/✕つき) */
export function computeDay(ctx: AvailabilityContext, date: string, slotId: string | null, course: ReserveCourse | null): Array<{ time: string; available: boolean; reason?: NoReason }> {
  const r = ctx.calendar.reception;
  const occ = occupancyMinutes(ctx, course);
  const unit = ctx.calendar.screen.unitMinutes;
  const out: Array<{ time: string; available: boolean; reason?: NoReason }> = [];
  for (const range of rangesOfRule(dayRuleFor(r, date))) {
    const from = hhmmToMinutes(range.from);
    const to = range.to === '24:00' ? 1440 : hhmmToMinutes(range.to);
    for (let t = from; t + occ <= to; t += unit) {
      const time = minutesToHhmm(t);
      const ev = evaluateCandidate(ctx, { startsAt: `${date}T${time}`, slotId, course });
      out.push({ time, available: ev.ok, reason: ev.reason });
    }
  }
  return out;
}

/** 期間(日付)ぶんの、予約できる開始時刻 */
export function computeAvailability(ctx: AvailabilityContext, from: string, to: string, slotId: string | null, course: ReserveCourse | null): Record<string, Array<{ time: string; available: boolean }>> {
  const out: Record<string, Array<{ time: string; available: boolean }>> = {};
  const max = 62;
  let n = 0;
  for (let d = from; d <= to && n < max; d = addDays(d, 1), n++) {
    out[d] = computeDay(ctx, d, slotId, course).map((x) => ({ time: x.time, available: x.available }));
  }
  return out;
}
