import { describe, expect, test } from 'vitest';
import { defaultReception, defaultScreen, defaultSlotSettings, defaultCourseSettings } from '@line-crm/db';
import type { ReserveBooking, ReserveCourse, ReserveShift, ReserveSlot } from '@line-crm/db';
import { changeLimit, computeDay, dayRuleFor, evaluateCandidate } from './reserve-availability.js';
import type { AvailabilityContext } from './reserve-availability.js';
import { isJapaneseHoliday } from './reserve-time.js';

const slot = (id: string, over: Partial<ReserveSlot> = {}): ReserveSlot => ({
  id,
  calendarId: 'c',
  name: id,
  visible: true,
  price: 0,
  capacity: 1,
  autoAssign: false,
  priority: 1,
  description: '',
  descriptionHtml: false,
  condition: null,
  iconUrl: "",
  sortOrder: 0,
  ...over,
});
const course = (id: string, minutes: number): ReserveCourse => ({
  id,
  calendarId: 'c',
  name: id,
  color: '#000000',
  durationMinutes: minutes,
  displayMinutes: null,
  price: 0,
  visible: true,
  description: '',
  descriptionHtml: false,
  condition: null,
  sortOrder: 0,
});
const booking = (id: string, startsAt: string, endsAt: string, over: Partial<ReserveBooking> = {}): ReserveBooking => ({
  id,
  calendarId: 'c',
  lineAccountId: 'a',
  friendId: null,
  slotId: null,
  courseId: null,
  isBlock: false,
  startsAt,
  endsAt,
  displayEndsAt: null,
  status: 'confirmed',
  pendingKind: null,
  pendingPayload: null,
  followupStatus: null,
  visited: false,
  visitedAt: null,
  followState: 'none',
  createdBy: 'friend',
  answers: {},
  guestName: null,
  price: 0,
  slotPriceApplied: true,
  memo: '',
  requestedAt: '2026-10-01T00:00',
  createdAt: '2026-10-01T00:00',
  updatedAt: '2026-10-01T00:00',
  googleEventId: null,
  ...over,
});

function ctx(over: Partial<AvailabilityContext> & { slots?: ReserveSlot[] } = {}): AvailabilityContext {
  const slots = over.slots ?? [slot('s1')];
  return {
    calendar: {
      reception: defaultReception(),
      slotSettings: { ...defaultSlotSettings(), required: false },
      courseSettings: { ...defaultCourseSettings(), unspecifiedMinutes: 60 },
      screen: { ...defaultScreen(), unitMinutes: 30 },
    },
    slots,
    links: [],
    shifts: [],
    bookings: [],
    now: '2026-10-01T09:00',
    ...over,
  };
}

// 2026-10-12(月)は、スポーツの日(祝日)。2026-10-13(火)は平日
describe('日本の祝日', () => {
  test('固定・ハッピーマンデー・春分秋分・振替・国民の休日', () => {
    expect(isJapaneseHoliday('2026-01-01')).toBe(true);
    expect(isJapaneseHoliday('2026-05-06')).toBe(true); // 5/3(日)の振替休日
    expect(isJapaneseHoliday('2026-09-21')).toBe(true); // 敬老の日
    expect(isJapaneseHoliday('2026-09-22')).toBe(true); // 国民の休日
    expect(isJapaneseHoliday('2026-09-23')).toBe(true); // 秋分の日
    expect(isJapaneseHoliday('2026-10-12')).toBe(true); // スポーツの日
    expect(isJapaneseHoliday('2026-10-13')).toBe(false);
  });
});

describe('受付時間', () => {
  test('特定日 > 祝日 > 曜日。祝日・休業は予約できない', () => {
    const c = ctx();
    expect(dayRuleFor(c.calendar.reception, '2026-10-13').ranges).toEqual([{ from: '10:00', to: '19:00' }]); // 火
    expect(dayRuleFor(c.calendar.reception, '2026-10-12').closed).toBe(true); // 祝日(スポーツの日)=休業
    expect(dayRuleFor(c.calendar.reception, '2026-10-17').closed).toBe(true); // 土
    c.calendar.reception.specialDays = [{ date: '2026-10-17', closed: false, allDay: false, ranges: [{ from: '12:00', to: '13:00' }] }];
    expect(dayRuleFor(c.calendar.reception, '2026-10-17').ranges).toEqual([{ from: '12:00', to: '13:00' }]);
  });

  test('所要時間が受付時間におさまる開始時刻だけが出る(60分・30分刻み)', () => {
    const times = computeDay(ctx(), '2026-10-13', 's1', null).map((x) => x.time);
    expect(times[0]).toBe('10:00');
    expect(times[times.length - 1]).toBe('18:00'); // 18:00開始なら19:00に終わる
    expect(times).not.toContain('18:30');
    expect(computeDay(ctx(), '2026-10-12', 's1', null)).toEqual([]);
  });
});

describe('受付期間', () => {
  test('受付締切(1日前の18:00まで)と受付開始(7日前から)', () => {
    const c = ctx();
    c.calendar.reception.deadline = { mode: 'relative', amount: 1, unit: 'days', time: '18:00' };
    c.calendar.reception.start = { mode: 'relative', amount: 7, unit: 'days' };
    c.now = '2026-10-12T17:00';
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's1', course: null }).ok).toBe(true); // 前日18時までに間に合う
    c.now = '2026-10-12T18:30';
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's1', course: null })).toMatchObject({ ok: false, reason: 'deadline_passed' });
    c.now = '2026-10-01T09:00';
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's1', course: null })).toMatchObject({ ok: false, reason: 'not_started' }); // 12日先は、まだ受付前
    c.now = '2026-10-14T00:00';
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's1', course: null })).toMatchObject({ ok: false, reason: 'past' });
  });

  test('変更・キャンセルの期限: 前日まで=予約日の0時、2日前まで=前日の0時、3時間前まで', () => {
    expect(changeLimit('2026-10-13T10:00', '1d')).toBe('2026-10-13T00:00');
    expect(changeLimit('2026-10-13T10:00', '2d')).toBe('2026-10-12T00:00');
    expect(changeLimit('2026-10-13T10:00', '3h')).toBe('2026-10-13T07:00');
    expect(changeLimit('2026-10-13T10:00', 'start')).toBe('2026-10-13T10:00');
    expect(changeLimit('2026-10-13T10:00', '1w')).toBe('2026-10-06T10:00');
  });
});

describe('同時予約可能数・指名なし予約', () => {
  test('予約枠の同時予約可能数(1)。重なる時間は✕、つぎの時間は◯', () => {
    const c = ctx({ bookings: [booking('b1', '2026-10-13T10:00', '2026-10-13T11:00', { slotId: 's1' })] });
    const ok = (t: string) => evaluateCandidate(c, { startsAt: `2026-10-13T${t}`, slotId: 's1', course: null }).ok;
    expect(ok('10:00')).toBe(false);
    expect(ok('10:30')).toBe(false);
    expect(ok('11:00')).toBe(true);
    expect(ok('09:30')).toBe(false); // 受付時間外(10時から)
  });

  test('全体の同時予約可能数: 予約枠が別でも、同じ時間帯に上限まで', () => {
    const c = ctx({ slots: [slot('s1'), slot('s2')], bookings: [booking('b1', '2026-10-13T10:00', '2026-10-13T11:00', { slotId: 's1' })] });
    c.calendar.reception.totalCapacity = 1;
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's2', course: null })).toMatchObject({ ok: false, reason: 'total_full' });
    c.calendar.reception.totalCapacity = 2;
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's2', course: null }).ok).toBe(true);
  });

  test('マニュアルの例: 担当1人(10〜12時シフト)。指名なしで10:00の予約があると、その人を指定した予約は取れない', () => {
    const shift: ReserveShift = { id: 'sh', calendarId: 'c', slotId: 's1', seriesId: null, workDate: '2026-10-13', startTime: '10:00', endTime: '12:00', memo: '', repeatRule: null };
    const cut = course('cut', 60);
    const perm = course('perm', 120);
    const c = ctx({ shifts: [shift], links: [{ slotId: 's1', courseId: 'cut' }, { slotId: 's1', courseId: 'perm' }], bookings: [booking('b1', '2026-10-13T10:00', '2026-10-13T11:00', { slotId: null })] });
    c.calendar.slotSettings.shiftLinked = true;
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's1', course: cut }).ok).toBe(false);
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T11:00', slotId: 's1', course: cut }).ok).toBe(true);
    // 指名なしでも、10:00-11:00は取れない。11:00-12:00は取れる。12時以降はシフトなし
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: null, course: cut }).ok).toBe(false);
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T11:00', slotId: null, course: cut }).ok).toBe(true);
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T12:00', slotId: null, course: cut })).toMatchObject({ ok: false, reason: 'no_shift' });
    // パーマ(2時間)は、シフト中に確保できない
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T11:00', slotId: null, course: perm }).ok).toBe(false);
  });

  test('自動振り分け: 優先度の高い枠から、空いている枠へ', () => {
    const c = ctx({
      slots: [slot('s1', { autoAssign: true, priority: 2, sortOrder: 0 }), slot('s2', { autoAssign: true, priority: 1, sortOrder: 1 }), slot('s3', { autoAssign: false, priority: 1, sortOrder: 2 })],
      bookings: [],
    });
    c.calendar.slotSettings.autoAssign = true;
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: null, course: null })).toMatchObject({ ok: true, assignedSlotId: 's2' });
    c.bookings = [booking('b1', '2026-10-13T10:00', '2026-10-13T11:00', { slotId: 's2' })];
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: null, course: null })).toMatchObject({ ok: true, assignedSlotId: 's1' });
  });
});

describe('ブロック枠・シフト連動', () => {
  test('予約枠を指定したブロック枠は、その枠だけ。指定なしのブロック枠は、指名なし予約だけ止める', () => {
    const c = ctx({ slots: [slot('s1'), slot('s2')], bookings: [booking('blk', '2026-10-13T10:00', '2026-10-13T12:00', { isBlock: true, slotId: 's1' })] });
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's1', course: null })).toMatchObject({ ok: false });
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's2', course: null }).ok).toBe(true);
    const c2 = ctx({ slots: [slot('s1')], bookings: [booking('blk', '2026-10-13T10:00', '2026-10-13T12:00', { isBlock: true, slotId: null })] });
    expect(evaluateCandidate(c2, { startsAt: '2026-10-13T10:00', slotId: null, course: null })).toMatchObject({ ok: false, reason: 'blocked' });
    expect(evaluateCandidate(c2, { startsAt: '2026-10-13T10:00', slotId: 's1', course: null }).ok).toBe(true);
  });

  test('シフト連動: シフトのある時間だけ。管理者は、シフト外にも入れられる', () => {
    const shift: ReserveShift = { id: 'sh', calendarId: 'c', slotId: 's1', seriesId: null, workDate: '2026-10-13', startTime: '13:00', endTime: '15:00', memo: '', repeatRule: null };
    const c = ctx({ shifts: [shift] });
    c.calendar.slotSettings.shiftLinked = true;
    const times = computeDay(c, '2026-10-13', 's1', null).filter((x) => x.available).map((x) => x.time);
    expect(times).toEqual(['13:00', '13:30', '14:00']);
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's1', course: null }, { adminOverride: true }).ok).toBe(true);
  });

  test('承認待ちの新規リクエストも、枠をふさぐ。キャンセル・否認は、ふさがない', () => {
    const c = ctx({ bookings: [booking('b1', '2026-10-13T10:00', '2026-10-13T11:00', { slotId: 's1', status: 'pending', pendingKind: 'new' })] });
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's1', course: null }).ok).toBe(false);
    c.bookings = [booking('b1', '2026-10-13T10:00', '2026-10-13T11:00', { slotId: 's1', status: 'cancelled' })];
    expect(evaluateCandidate(c, { startsAt: '2026-10-13T10:00', slotId: 's1', course: null }).ok).toBe(true);
  });
});
