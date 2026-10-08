import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  ReserveError,
  copyReserveCalendar,
  countPendingReserveBookings,
  createReserveCalendar,
  createReserveCourse,
  createReserveShifts,
  createReserveSiteLink,
  createReserveSlot,
  deleteReserveCalendar,
  deleteReserveCourse,
  deleteReserveShift,
  deleteReserveSiteLink,
  deleteReserveSlot,
  duplicateReserveCourse,
  duplicateReserveSlot,
  getLineAccountById,
  getReserveBooking,
  getReserveCalendar,
  getReserveCourse,
  getReserveShift,
  getReserveSlot,
  listReserveBookingLogs,
  listReserveBookings,
  listReserveCalendars,
  listReserveCourses,
  listReserveLinks,
  listReserveShifts,
  listReserveSiteLinks,
  listReserveSlots,
  renameReserveCalendar,
  reorderReserveCourses,
  reorderReserveSlots,
  saveReserveCalendarSection,
  saveReserveLinks,
  setReserveCalendarStatus,
  updateReserveBooking,
  updateReserveCourse,
  updateReserveShift,
  updateReserveSlot,
} from '@line-crm/db';
import type { BookingFilter, CalendarSection, ReserveBookingStatus, ReserveCalendar, ShiftScope } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import { FilterError, parseFriendFilter } from '../services/friend-filter.js';
import {
  ReserveBookingError,
  adminCancelBooking,
  adminCreateBooking,
  adminDeleteBooking,
  adminUpdateBooking,
  bookingNames,
  decideRequest,
  markVisited,
} from '../services/reserve-bookings.js';
import { nowJst } from '../services/reserve-time.js';
import type { Env } from '../index.js';

/**
 * カレンダー予約の管理用API(Lステップの「カレンダー予約」の管理画面)。
 * 予約・シフトの操作は、スタッフ全員。設定の変更(予約設定・予約枠・コース・カレンダーの作成削除)は、管理者だけ。
 * 見られる公式アカウントは、スタッフごとの許可に従う。
 */
const reserve = new Hono<Env>();

type Ctx = Context<Env>;

const fail = (c: Ctx, err: unknown): Response => {
  if (err instanceof ReserveBookingError) return c.json({ success: false, error: err.message, code: err.code }, err.status);
  if (err instanceof ReserveError || err instanceof FilterError) return c.json({ success: false, error: err.message }, 400);
  console.error('reserve error:', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
};

function allowedAccount(c: Ctx, accountId: string): boolean {
  const allowed = c.get('allowedAccountIds');
  return allowed == null || allowed.includes(accountId);
}

async function calendarOf(c: Ctx, id: string): Promise<ReserveCalendar | null> {
  const cal = await getReserveCalendar(c.env.DB, id);
  if (!cal || !allowedAccount(c, cal.lineAccountId)) return null;
  return cal;
}

const notFound = (c: Ctx) => c.json({ success: false, error: 'カレンダーが見つかりません' }, 404);
const actorOf = (c: Ctx): string => c.get('staff')?.name ?? '管理者';

async function siteUrls(c: Ctx, cal: ReserveCalendar): Promise<{ reserveUrl: string | null; historyUrl: string | null }> {
  const account = await getLineAccountById(c.env.DB, cal.lineAccountId);
  const liff = (account as unknown as { liff_id?: string | null } | null)?.liff_id;
  if (!liff) return { reserveUrl: null, historyUrl: null };
  const base = `https://liff.line.me/${liff}?page=reserve&calendar=${cal.id}`;
  return { reserveUrl: base, historyUrl: `${base}&view=history` };
}

// ── カレンダー ──────────────────────────────────────────────────────────────

reserve.get('/api/reserve/calendars', async (c) => {
  const accountId = c.req.query('lineAccountId');
  if (!accountId) return c.json({ success: false, error: 'lineAccountId は必須です' }, 400);
  if (!allowedAccount(c, accountId)) return c.json({ success: false, error: 'このアカウントは見られません' }, 403);
  try {
    const list = await listReserveCalendars(c.env.DB, accountId);
    const data = [];
    for (const cal of list) data.push({ id: cal.id, name: cal.name, status: cal.status, pendingCount: await countPendingReserveBookings(c.env.DB, cal.id), ...(await siteUrls(c, cal)) });
    return c.json({ success: true, data });
  } catch (err) {
    return fail(c, err);
  }
});

reserve.post('/api/reserve/calendars', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string; name?: string }>().catch(() => ({}) as { lineAccountId?: string; name?: string });
    if (!body.lineAccountId || !allowedAccount(c, body.lineAccountId)) return c.json({ success: false, error: 'アカウントを選んでください' }, 400);
    const cal = await createReserveCalendar(c.env.DB, body.lineAccountId, body.name ?? '');
    return c.json({ success: true, data: { id: cal.id } }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

reserve.get('/api/reserve/calendars/:id', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  try {
    const [slots, courses, links, siteLinks, pendingCount] = await Promise.all([
      listReserveSlots(c.env.DB, cal.id),
      listReserveCourses(c.env.DB, cal.id),
      listReserveLinks(c.env.DB, cal.id),
      listReserveSiteLinks(c.env.DB, cal.id),
      countPendingReserveBookings(c.env.DB, cal.id),
    ]);
    return c.json({ success: true, data: { calendar: cal, slots, courses, links, siteLinks, pendingCount, ...(await siteUrls(c, cal)) } });
  } catch (err) {
    return fail(c, err);
  }
});

reserve.patch('/api/reserve/calendars/:id', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  try {
    const body = await c.req.json<{ name?: string; status?: string }>().catch(() => ({}) as { name?: string; status?: string });
    if (body.name !== undefined) {
      if (c.get('staff')?.role === 'staff') return c.json({ success: false, error: 'カレンダー名の変更は、管理者だけができます' }, 403);
      await renameReserveCalendar(c.env.DB, cal.id, body.name);
    }
    if (body.status === 'active' || body.status === 'stopped') await setReserveCalendarStatus(c.env.DB, cal.id, body.status);
    return c.json({ success: true, data: null });
  } catch (err) {
    return fail(c, err);
  }
});

reserve.post('/api/reserve/calendars/:id/copy', requireRole('owner', 'admin'), async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  try {
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const copy = await copyReserveCalendar(c.env.DB, cal.id, body.name ?? `${cal.name}のコピー`, nowJst().slice(0, 10));
    return c.json({ success: true, data: { id: copy.id } }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

reserve.delete('/api/reserve/calendars/:id', requireRole('owner', 'admin'), async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  await deleteReserveCalendar(c.env.DB, cal.id);
  return c.json({ success: true, data: null });
});

reserve.put('/api/reserve/calendars/:id/settings/:section', requireRole('owner', 'admin'), async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  const section = c.req.param('section') as CalendarSection;
  if (!['reception', 'slotSettings', 'courseSettings', 'screen', 'actions', 'reminders', 'follow', 'external'].includes(section)) return c.json({ success: false, error: '設定の区分が正しくありません' }, 400);
  try {
    let body = await c.req.json<unknown>().catch(() => ({}));
    // アクションの条件(友だち絞り込み)は、形を検証する
    body = validateConditions(section, body);
    const saved = await saveReserveCalendarSection(c.env.DB, cal, section, body);
    return c.json({ success: true, data: saved });
  } catch (err) {
    return fail(c, err);
  }
});

function validateConditions(section: string, body: unknown): unknown {
  const fixList = (list: unknown): unknown => (Array.isArray(list) ? list.map((a) => (a && typeof a === 'object' && (a as { condition?: unknown }).condition ? { ...(a as object), condition: parseFriendFilter((a as { condition: unknown }).condition) } : a)) : list);
  if (!body || typeof body !== 'object') return body;
  const b = body as Record<string, unknown>;
  if (section === 'actions') {
    const out: Record<string, unknown> = { ...b };
    for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = fixList(out[k]);
    return out;
  }
  if (section === 'reminders' || section === 'follow') {
    const items = Array.isArray(b.items) ? b.items.map((it) => (it && typeof it === 'object' ? { ...(it as object), actions: fixList((it as { actions?: unknown }).actions) } : it)) : b.items;
    return { ...b, items };
  }
  return body;
}

// ── 予約枠・コース・紐づけ ───────────────────────────────────────────────────

function withCondition<T extends { condition?: unknown }>(body: T): T {
  return body.condition ? { ...body, condition: parseFriendFilter(body.condition) } : body;
}

reserve.post('/api/reserve/calendars/:id/slots', requireRole('owner', 'admin'), async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  try {
    const body = withCondition(await c.req.json<Record<string, unknown>>().catch(() => ({})));
    return c.json({ success: true, data: await createReserveSlot(c.env.DB, cal.id, body) }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

async function slotOf(c: Ctx): Promise<{ cal: ReserveCalendar; slotId: string } | null> {
  const slot = await getReserveSlot(c.env.DB, c.req.param('slotId') ?? '');
  if (!slot) return null;
  const cal = await calendarOf(c, slot.calendarId);
  return cal ? { cal, slotId: slot.id } : null;
}

reserve.put('/api/reserve/slots/:slotId', requireRole('owner', 'admin'), async (c) => {
  const s = await slotOf(c);
  if (!s) return notFound(c);
  try {
    const body = withCondition(await c.req.json<Record<string, unknown>>().catch(() => ({})));
    return c.json({ success: true, data: await updateReserveSlot(c.env.DB, s.slotId, body) });
  } catch (err) {
    return fail(c, err);
  }
});

reserve.post('/api/reserve/slots/:slotId/duplicate', requireRole('owner', 'admin'), async (c) => {
  const s = await slotOf(c);
  if (!s) return notFound(c);
  try {
    return c.json({ success: true, data: await duplicateReserveSlot(c.env.DB, s.slotId) }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

reserve.delete('/api/reserve/slots/:slotId', requireRole('owner', 'admin'), async (c) => {
  const s = await slotOf(c);
  if (!s) return notFound(c);
  if (s.cal.slotSettings.autoAssign) {
    const slots = await listReserveSlots(c.env.DB, s.cal.id);
    if (slots.length <= 1) return c.json({ success: false, error: '自動振り分けが有効のため、予約枠をすべて削除することはできません' }, 400);
  }
  await deleteReserveSlot(c.env.DB, s.slotId);
  return c.json({ success: true, data: null });
});

reserve.put('/api/reserve/calendars/:id/slots-order', requireRole('owner', 'admin'), async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
  await reorderReserveSlots(c.env.DB, cal.id, Array.isArray(body.ids) ? body.ids : []);
  return c.json({ success: true, data: null });
});

reserve.post('/api/reserve/calendars/:id/courses', requireRole('owner', 'admin'), async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  try {
    const body = withCondition(await c.req.json<Record<string, unknown>>().catch(() => ({})));
    return c.json({ success: true, data: await createReserveCourse(c.env.DB, cal.id, body) }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

async function courseOf(c: Ctx): Promise<{ cal: ReserveCalendar; courseId: string } | null> {
  const course = await getReserveCourse(c.env.DB, c.req.param('courseId') ?? '');
  if (!course) return null;
  const cal = await calendarOf(c, course.calendarId);
  return cal ? { cal, courseId: course.id } : null;
}

reserve.put('/api/reserve/courses/:courseId', requireRole('owner', 'admin'), async (c) => {
  const s = await courseOf(c);
  if (!s) return notFound(c);
  try {
    const body = withCondition(await c.req.json<Record<string, unknown>>().catch(() => ({})));
    return c.json({ success: true, data: await updateReserveCourse(c.env.DB, s.courseId, body) });
  } catch (err) {
    return fail(c, err);
  }
});

reserve.post('/api/reserve/courses/:courseId/duplicate', requireRole('owner', 'admin'), async (c) => {
  const s = await courseOf(c);
  if (!s) return notFound(c);
  try {
    return c.json({ success: true, data: await duplicateReserveCourse(c.env.DB, s.courseId) }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

reserve.delete('/api/reserve/courses/:courseId', requireRole('owner', 'admin'), async (c) => {
  const s = await courseOf(c);
  if (!s) return notFound(c);
  await deleteReserveCourse(c.env.DB, s.courseId);
  return c.json({ success: true, data: null });
});

reserve.put('/api/reserve/calendars/:id/courses-order', requireRole('owner', 'admin'), async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
  await reorderReserveCourses(c.env.DB, cal.id, Array.isArray(body.ids) ? body.ids : []);
  return c.json({ success: true, data: null });
});

reserve.put('/api/reserve/calendars/:id/links', requireRole('owner', 'admin'), async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  try {
    const body = await c.req.json<{ pairs?: Array<{ slotId: string; courseId: string }> }>().catch(() => ({}) as { pairs?: Array<{ slotId: string; courseId: string }> });
    await saveReserveLinks(c.env.DB, cal.id, Array.isArray(body.pairs) ? body.pairs : []);
    return c.json({ success: true, data: null });
  } catch (err) {
    return fail(c, err);
  }
});

// ── シフト ──────────────────────────────────────────────────────────────────

reserve.get('/api/reserve/calendars/:id/shifts', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) return c.json({ success: false, error: 'from と to は必須です' }, 400);
  const slotIds = (c.req.query('slotIds') ?? '').split(',').filter(Boolean);
  return c.json({ success: true, data: await listReserveShifts(c.env.DB, cal.id, from, to, slotIds) });
});

reserve.post('/api/reserve/calendars/:id/shifts', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  try {
    const body = await c.req.json<{ slotId: string; date: string; startTime: string; endTime: string; memo?: string; repeat?: { freq?: unknown; until?: unknown } | null }>();
    return c.json({ success: true, data: await createReserveShifts(c.env.DB, cal.id, body) }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

reserve.put('/api/reserve/shifts/:shiftId', async (c) => {
  const shift = await getReserveShift(c.env.DB, c.req.param('shiftId'));
  if (!shift || !(await calendarOf(c, shift.calendarId))) return notFound(c);
  try {
    const scope = (c.req.query('scope') ?? 'this') as ShiftScope;
    const body = await c.req.json<{ slotId?: string; startTime?: string; endTime?: string; memo?: string; date?: string }>();
    await updateReserveShift(c.env.DB, shift.id, body, scope);
    return c.json({ success: true, data: null });
  } catch (err) {
    return fail(c, err);
  }
});

reserve.delete('/api/reserve/shifts/:shiftId', async (c) => {
  const shift = await getReserveShift(c.env.DB, c.req.param('shiftId'));
  if (!shift || !(await calendarOf(c, shift.calendarId))) return notFound(c);
  await deleteReserveShift(c.env.DB, shift.id, (c.req.query('scope') ?? 'this') as ShiftScope);
  return c.json({ success: true, data: null });
});

// ── 予約 ────────────────────────────────────────────────────────────────────

function bookingFilter(c: Ctx): BookingFilter {
  const q = (k: string) => c.req.query(k) ?? '';
  const list = (k: string) => q(k).split(',').filter(Boolean);
  return {
    from: q('from') || undefined,
    to: q('to') || undefined,
    slotIds: list('slotIds'),
    courseIds: list('courseIds'),
    statuses: list('statuses') as ReserveBookingStatus[],
    includeBlocks: q('includeBlocks') === '1',
    onlyBlocks: q('onlyBlocks') === '1',
    friendId: q('friendId') || undefined,
    visited: q('visited') === '' ? undefined : q('visited') === '1',
    q: q('q') || undefined,
    friendQ: q('friendQ') || undefined,
    guestQ: q('guestQ') || undefined,
    timeFrom: /^\d{2}:\d{2}$/.test(q('timeFrom')) ? q('timeFrom') : undefined,
    timeTo: /^\d{2}:\d{2}$/.test(q('timeTo')) ? q('timeTo') : undefined,
    limit: q('limit') ? Number(q('limit')) : undefined,
    offset: q('offset') ? Number(q('offset')) : undefined,
    order: q('order') === 'desc' ? 'desc' : 'asc',
  };
}

const displayName = (f: { displayName: string | null; realName: string | null; systemDisplayName: string | null } | null, guest: string | null): string => guest || f?.realName || f?.systemDisplayName || f?.displayName || '(名前なし)';

reserve.get('/api/reserve/calendars/:id/bookings', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  try {
    const { items, total } = await listReserveBookings(c.env.DB, cal.id, bookingFilter(c));
    return c.json({ success: true, data: { total, items: items.map((b) => ({ ...b, name: displayName(b.friend, b.guestName) })) } });
  } catch (err) {
    return fail(c, err);
  }
});

reserve.get('/api/reserve/calendars/:id/bookings.csv', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  const [{ items }, slots, courses] = await Promise.all([listReserveBookings(c.env.DB, cal.id, { ...bookingFilter(c), limit: 2000 }), listReserveSlots(c.env.DB, cal.id), listReserveCourses(c.env.DB, cal.id)]);
  const slotName = new Map(slots.map((s) => [s.id, s.name]));
  const courseName = new Map(courses.map((x) => [x.id, x.name]));
  const statusText: Record<string, string> = { confirmed: '予約済み', pending: '承認待ち', cancelled: 'キャンセル済み', rejected: '否認' };
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['予約ID', '友だちID', '友だち名', '日付', '開始', '終了', '予約枠', 'コース', 'ステータス', '来店/来場済み', '料金', '申し込み日時', '予約メモ', ...cal.screen.fields.map((f) => f.label)];
  const rows = items.map((b) => [
    b.id,
    b.friendId ?? '',
    displayName(b.friend, b.guestName),
    b.startsAt.slice(0, 10),
    b.startsAt.slice(11, 16),
    b.endsAt.slice(11, 16),
    b.isBlock ? 'ブロック枠' : (b.slotId ? slotName.get(b.slotId) : '指定なし') ?? '',
    b.courseId ? courseName.get(b.courseId) ?? '' : '',
    b.isBlock ? 'ブロック' : (statusText[b.status] ?? b.status),
    b.visited ? '済' : '',
    b.price,
    b.requestedAt.slice(0, 16).replace('T', ' '),
    b.memo,
    ...cal.screen.fields.map((f) => b.answers[f.id] ?? ''),
  ]);
  const csv = '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const stamp = nowJst().replace(/[-:T]/g, '').slice(0, 12);
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="reserve-${stamp}.csv"` } });
});

async function bookingOf(c: Ctx): Promise<{ cal: ReserveCalendar; id: string } | null> {
  const b = await getReserveBooking(c.env.DB, c.req.param('bid') ?? '');
  if (!b) return null;
  const cal = await calendarOf(c, b.calendarId);
  return cal ? { cal, id: b.id } : null;
}

reserve.get('/api/reserve/bookings/:bid', async (c) => {
  const s = await bookingOf(c);
  if (!s) return notFound(c);
  const b = await getReserveBooking(c.env.DB, s.id);
  if (!b) return notFound(c);
  const [names, logs] = await Promise.all([bookingNames(c.env.DB, b), listReserveBookingLogs(c.env.DB, b.id)]);
  let friend = null;
  let recent: unknown[] = [];
  if (b.friendId) {
    friend = await c.env.DB.prepare('SELECT id, display_name, real_name, system_display_name, picture_url, notes FROM friends WHERE id = ?').bind(b.friendId).first();
    const r = await listReserveBookings(c.env.DB, s.cal.id, { friendId: b.friendId, limit: 5, order: 'desc' });
    recent = r.items.filter((x) => x.id !== b.id).map((x) => ({ id: x.id, startsAt: x.startsAt, status: x.status }));
  }
  return c.json({ success: true, data: { booking: b, names, logs, friend, recent } });
});

reserve.post('/api/reserve/calendars/:id/bookings', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  try {
    const body = await c.req.json<Record<string, unknown>>();
    const created = await adminCreateBooking(c.env.DB, c.env, {
      calendar: cal,
      actor: actorOf(c),
      friendId: typeof body.friendId === 'string' && body.friendId ? body.friendId : null,
      slotId: typeof body.slotId === 'string' && body.slotId ? body.slotId : null,
      courseId: typeof body.courseId === 'string' && body.courseId ? body.courseId : null,
      startsAt: String(body.startsAt ?? ''),
      endsAt: typeof body.endsAt === 'string' && body.endsAt ? body.endsAt : null,
      isBlock: body.isBlock === true,
      answers: (body.answers as Record<string, unknown>) ?? {},
      runActions: body.runActions !== false,
      slotPriceApplied: body.slotPriceApplied !== false,
      overwriteFriend: body.overwriteFriend === true,
      memo: typeof body.memo === 'string' ? body.memo : '',
    });
    return c.json({ success: true, data: created }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

reserve.put('/api/reserve/bookings/:bid', async (c) => {
  const s = await bookingOf(c);
  if (!s) return notFound(c);
  try {
    const body = await c.req.json<Record<string, unknown>>();
    // メモ・完了後のステータスだけの更新は、再計算しない
    if (body.memo !== undefined || body.followupStatus !== undefined) {
      const patch: { memo?: string; followupStatus?: string | null } = {};
      if (typeof body.memo === 'string') patch.memo = body.memo.slice(0, 5000);
      if (body.followupStatus !== undefined) patch.followupStatus = typeof body.followupStatus === 'string' && body.followupStatus ? body.followupStatus.slice(0, 50) : null;
      await updateReserveBooking(c.env.DB, s.id, patch);
      if (body.startsAt === undefined && body.slotId === undefined && body.courseId === undefined && body.answers === undefined) return c.json({ success: true, data: await getReserveBooking(c.env.DB, s.id) });
    }
    const updated = await adminUpdateBooking(c.env.DB, c.env, {
      calendar: s.cal,
      actor: actorOf(c),
      bookingId: s.id,
      startsAt: typeof body.startsAt === 'string' ? body.startsAt : undefined,
      endsAt: body.endsAt === undefined ? undefined : (body.endsAt as string | null),
      slotId: body.slotId === undefined ? undefined : (body.slotId as string | null) || null,
      courseId: body.courseId === undefined ? undefined : (body.courseId as string | null) || null,
      friendId: body.friendId === undefined ? undefined : (body.friendId as string | null) || null,
      answers: body.answers as Record<string, unknown> | undefined,
      slotPriceApplied: typeof body.slotPriceApplied === 'boolean' ? body.slotPriceApplied : undefined,
      runActions: body.runActions !== false,
    });
    return c.json({ success: true, data: updated });
  } catch (err) {
    return fail(c, err);
  }
});

reserve.post('/api/reserve/bookings/:bid/cancel', async (c) => {
  const s = await bookingOf(c);
  if (!s) return notFound(c);
  try {
    const body = await c.req.json<{ runActions?: boolean }>().catch(() => ({}) as { runActions?: boolean });
    return c.json({ success: true, data: await adminCancelBooking(c.env.DB, c.env, { calendar: s.cal, actor: actorOf(c), bookingId: s.id, runActions: body.runActions !== false }) });
  } catch (err) {
    return fail(c, err);
  }
});

reserve.delete('/api/reserve/bookings/:bid', async (c) => {
  const s = await bookingOf(c);
  if (!s) return notFound(c);
  try {
    await adminDeleteBooking(c.env.DB, { calendar: s.cal, bookingId: s.id });
    return c.json({ success: true, data: null });
  } catch (err) {
    return fail(c, err);
  }
});

reserve.post('/api/reserve/bookings/:bid/decision', async (c) => {
  const s = await bookingOf(c);
  if (!s) return notFound(c);
  try {
    const body = await c.req.json<{ decision?: string; runActions?: boolean }>();
    if (body.decision !== 'approve' && body.decision !== 'reject') return c.json({ success: false, error: '承認か否認かを選んでください' }, 400);
    return c.json({ success: true, data: await decideRequest(c.env.DB, c.env, { calendar: s.cal, actor: actorOf(c), bookingId: s.id, decision: body.decision, runActions: body.runActions !== false }) });
  } catch (err) {
    return fail(c, err);
  }
});

/** 来店/来場済みにする(個別・一括) */
reserve.post('/api/reserve/calendars/:id/visited', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  try {
    const body = await c.req.json<{ ids?: string[]; visited?: boolean; runFollow?: boolean }>();
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 500) : [];
    for (const id of ids) await markVisited(c.env.DB, cal, actorOf(c), id, body.visited !== false, body.runFollow === true);
    return c.json({ success: true, data: { count: ids.length } });
  } catch (err) {
    return fail(c, err);
  }
});

/** お知らせ(新規予約・承認待ちのリクエスト)。新しい順 */
reserve.get('/api/reserve/calendars/:id/notices', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  const rows = await c.env.DB
    .prepare(
      `SELECT b.id, b.status, b.pending_kind, b.starts_at, b.requested_at, b.created_by, b.guest_name, f.display_name, f.real_name, f.system_display_name
         FROM reserve_bookings b LEFT JOIN friends f ON f.id = b.friend_id
        WHERE b.calendar_id = ? AND b.is_block = 0 AND b.created_by = 'friend'
        ORDER BY b.requested_at DESC LIMIT 30`,
    )
    .bind(cal.id)
    .all<{ id: string; status: string; pending_kind: string | null; starts_at: string; requested_at: string; guest_name: string | null; display_name: string | null; real_name: string | null; system_display_name: string | null }>();
  const data = (rows.results ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    pendingKind: r.status === 'pending' ? 'new' : r.pending_kind,
    startsAt: r.starts_at,
    requestedAt: r.requested_at,
    name: r.guest_name || r.real_name || r.system_display_name || r.display_name || '(名前なし)',
  }));
  return c.json({ success: true, data: { pendingCount: await countPendingReserveBookings(c.env.DB, cal.id), items: data } });
});

// ── 予約サイト確認(指定した予約枠・コースのURLの発行) ───────────────────────

reserve.post('/api/reserve/calendars/:id/site-links', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  const body = await c.req.json<{ slotId?: string | null; courseId?: string | null }>().catch(() => ({}) as { slotId?: string | null; courseId?: string | null });
  const id = await createReserveSiteLink(c.env.DB, cal.id, body.slotId || null, body.courseId || null);
  const urls = await siteUrls(c, cal);
  return c.json({ success: true, data: { id, url: urls.reserveUrl ? `${urls.reserveUrl}&link=${id}` : null } }, 201);
});

reserve.delete('/api/reserve/calendars/:id/site-links/:linkId', async (c) => {
  const cal = await calendarOf(c, c.req.param('id') ?? '');
  if (!cal) return notFound(c);
  await deleteReserveSiteLink(c.env.DB, c.req.param('linkId'));
  return c.json({ success: true, data: null });
});

export { reserve };
