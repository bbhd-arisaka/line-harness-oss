import { Hono } from 'hono';
import type { Context } from 'hono';
import { ReserveError, getReserveBooking, getReserveCalendar, getReserveSiteLink, listReserveBookings } from '@line-crm/db';
import type { ReserveBooking, ReserveCalendar, ReserveCourse, ReserveSlot } from '@line-crm/db';
import { resolveAccountIdFromLiff, verifyCallerLineUserId } from './booking.js';
import { changeLimit, computeAvailability } from '../services/reserve-availability.js';
import {
  ReserveBookingError,
  bookingNames,
  cancelFriendBooking,
  changeFriendBooking,
  createFriendBooking,
  loadAvailabilityContext,
  loadSelectable,
} from '../services/reserve-bookings.js';
import type { FriendRow } from '../services/reserve-bookings.js';
import { addDays, dateOf, nowJst } from '../services/reserve-time.js';
import type { Env } from '../index.js';

/**
 * カレンダー予約の、友だち側(LIFF)のAPI。LINEのIDトークンで友だち本人を確かめる。
 * 友だちは、そのアカウントの友だちだけ。別のアカウントのカレンダーは使えない。
 */
const reservePublic = new Hono<Env>();
type Ctx = Context<Env>;

const fail = (c: Ctx, err: unknown): Response => {
  if (err instanceof ReserveBookingError) return c.json({ success: false, error: err.message, code: err.code }, err.status);
  if (err instanceof ReserveError) return c.json({ success: false, error: err.message }, 400);
  console.error('reserve-public error:', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
};

interface Caller {
  friend: FriendRow;
  calendar: ReserveCalendar;
}

async function authenticate(c: Ctx, calendarId: string | undefined): Promise<Caller | Response> {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ success: false, error: 'unknown_liff' }, 404);
  const lineUserId = await verifyCallerLineUserId(c);
  if (!lineUserId) return c.json({ success: false, error: 'unauthorized' }, 401);
  const calendar = calendarId ? await getReserveCalendar(c.env.DB, calendarId) : null;
  if (!calendar || calendar.lineAccountId !== accountId) return c.json({ success: false, error: 'カレンダーが見つかりません', code: 'not_found' }, 404);
  const friend = await c.env.DB
    .prepare('SELECT id, line_account_id, line_user_id, is_following FROM friends WHERE line_user_id = ? AND line_account_id = ?')
    .bind(lineUserId, accountId)
    .first<FriendRow>();
  if (!friend) return c.json({ success: false, error: '友だち追加をしてから、予約してください', code: 'friend_not_found' }, 404);
  return { friend, calendar };
}

const isResponse = (v: Caller | Response): v is Response => v instanceof Response;

/** 管理者が書いた説明文(HTMLモード)を、安全なタグだけにする */
export function sanitizeHtml(html: string): string {
  const allowed = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'small']);
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!allowed.has(t)) return '';
      if (m.startsWith('</')) return `</${t}>`;
      const keep: string[] = [];
      const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = re.exec(attrs))) {
        const name = a[1].toLowerCase();
        const value = (a[3] ?? a[4] ?? '').trim();
        if ((name === 'href' || name === 'src') && /^https?:\/\//i.test(value)) keep.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
        else if (name === 'alt' || name === 'width' || name === 'height') keep.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
      }
      if (t === 'a') keep.push('target="_blank"', 'rel="noopener noreferrer"');
      return `<${t}${keep.length ? ' ' + keep.join(' ') : ''}>`;
    });
}

function publicSlot(s: ReserveSlot) {
  return { id: s.id, name: s.name, iconUrl: s.iconUrl, price: s.price, description: s.descriptionHtml ? sanitizeHtml(s.description) : s.description, descriptionHtml: s.descriptionHtml };
}
function publicCourse(x: ReserveCourse) {
  return { id: x.id, name: x.name, price: x.price, color: x.color, minutes: x.displayMinutes ?? x.durationMinutes, description: x.descriptionHtml ? sanitizeHtml(x.description) : x.description, descriptionHtml: x.descriptionHtml };
}

async function publicBooking(db: D1Database, calendar: ReserveCalendar, b: ReserveBooking, now: string) {
  const names = await bookingNames(db, b);
  const unapproved = b.status === 'pending';
  const active = b.status === 'confirmed' || b.status === 'pending';
  const ap = calendar.reception.approval;
  const hasPending = !!b.pendingKind && b.status !== 'pending';
  const changeOk = active && !hasPending && (unapproved || (ap.change !== 'deny' && now <= changeLimit(b.startsAt, calendar.reception.changeDeadline)));
  const cancelOk = active && !hasPending && (unapproved || (ap.cancel !== 'deny' && now <= changeLimit(b.startsAt, calendar.reception.cancelDeadline)));
  return {
    id: b.id,
    startsAt: b.startsAt,
    endsAt: b.displayEndsAt ?? b.endsAt,
    status: b.status,
    pendingKind: b.status === 'pending' ? 'new' : b.pendingKind,
    slotId: b.slotId,
    courseId: b.courseId,
    slotName: names.slotName,
    courseName: names.courseName,
    price: b.price,
    answers: calendar.screen.fields.filter((f) => b.answers[f.id]).map((f) => ({ label: f.label, value: b.answers[f.id] })),
    answerValues: b.answers,
    canChange: changeOk,
    canCancel: cancelOk,
    changeMode: !unapproved && ap.change === 'request' ? 'request' : 'direct',
    cancelMode: !unapproved && ap.cancel === 'request' ? 'request' : 'direct',
  };
}

/** 前回の予約の回答(名前など)・友だち情報から、入力欄の初期値を作る */
async function prefill(db: D1Database, calendar: ReserveCalendar, friendId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const last = await listReserveBookings(db, calendar.id, { friendId, limit: 1, order: 'desc' });
  const prev = last.items[0]?.answers ?? {};
  const f = await db.prepare('SELECT metadata, real_name FROM friends WHERE id = ?').bind(friendId).first<{ metadata: string | null; real_name: string | null }>();
  const meta = f?.metadata ? (JSON.parse(f.metadata) as Record<string, unknown>) : {};
  for (const field of calendar.screen.fields) {
    if (prev[field.id]) out[field.id] = prev[field.id];
    else if (field.friendFieldKey && typeof meta[field.friendFieldKey] === 'string') out[field.id] = meta[field.friendFieldKey] as string;
    else if (field.linkRealName && f?.real_name) out[field.id] = f.real_name;
  }
  return out;
}

reservePublic.get('/api/liff/reserve/config', async (c) => {
  const a = await authenticate(c, c.req.query('calendar'));
  if (isResponse(a)) return a;
  const { calendar, friend } = a;
  try {
    if (calendar.status !== 'active') return c.json({ success: true, data: { stopped: true, name: calendar.name } });
    const sel = await loadSelectable(c.env.DB, calendar, friend.id, false);
    const linkId = c.req.query('link');
    const link = linkId ? await getReserveSiteLink(c.env.DB, linkId) : null;
    const preset = link && link.calendarId === calendar.id ? { slotId: sel.slots.some((s) => s.id === link.slotId) ? link.slotId : null, courseId: sel.courses.some((x) => x.id === link.courseId) ? link.courseId : null } : { slotId: null, courseId: null };
    const screen = calendar.screen;
    return c.json({
      success: true,
      data: {
        stopped: false,
        calendarId: calendar.id,
        name: calendar.name,
        slotSettings: { title: calendar.slotSettings.title, required: calendar.slotSettings.required, priceEnabled: calendar.slotSettings.priceEnabled },
        courseSettings: { title: calendar.courseSettings.title, required: calendar.courseSettings.required, priceEnabled: calendar.courseSettings.priceEnabled, showDuration: calendar.courseSettings.showDuration },
        screen: {
          view: screen.view,
          unitMinutes: screen.unitMinutes,
          adminInfo: screen.adminInfo.show ? screen.adminInfo : null,
          consent: screen.consent.show ? { title: screen.consent.title || '注意事項・利用規約', body: screen.consent.body } : null,
          thanksUrls: screen.thanksUrls,
          fields: screen.fields.map((f) => ({ id: f.id, label: f.label, description: f.description, type: f.type, textKind: f.textKind, options: f.options, required: f.required })),
        },
        slots: sel.slots.map(publicSlot),
        courses: sel.courses.map(publicCourse),
        links: sel.links,
        preset,
        prefill: await prefill(c.env.DB, calendar, friend.id),
        approval: { newBooking: calendar.reception.approval.newBooking },
      },
    });
  } catch (err) {
    return fail(c, err);
  }
});

reservePublic.get('/api/liff/reserve/availability', async (c) => {
  const a = await authenticate(c, c.req.query('calendar'));
  if (isResponse(a)) return a;
  const { calendar, friend } = a;
  try {
    if (calendar.status !== 'active') return c.json({ success: false, error: '現在、予約受付を停止しています。', code: 'stopped' }, 403);
    const now = nowJst();
    const from = c.req.query('from') ?? dateOf(now);
    const to = c.req.query('to') ?? addDays(from, 6);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return c.json({ success: false, error: '日付が正しくありません' }, 400);
    const sel = await loadSelectable(c.env.DB, calendar, friend.id, false);
    const slotId = c.req.query('slot_id') || null;
    const courseId = c.req.query('course_id') || null;
    const slot = slotId ? sel.slots.find((s) => s.id === slotId) ?? null : null;
    const course = courseId ? sel.courses.find((x) => x.id === courseId) ?? null : null;
    if ((slotId && !slot) || (courseId && !course)) return c.json({ success: true, data: { days: {}, noOptions: true } });
    if (sel.slots.length === 0 && calendar.slotSettings.required) return c.json({ success: true, data: { days: {}, noOptions: true } });
    const end = to > addDays(from, 41) ? addDays(from, 41) : to;
    const ctx = await loadAvailabilityContext(c.env.DB, calendar, sel, { from, to: end }, now);
    return c.json({ success: true, data: { days: computeAvailability(ctx, from, end, slot?.id ?? null, course), noOptions: false } });
  } catch (err) {
    return fail(c, err);
  }
});

reservePublic.post('/api/liff/reserve/bookings', async (c) => {
  const body = await c.req.json<{ calendarId?: string; slotId?: string | null; courseId?: string | null; startsAt?: string; answers?: Record<string, unknown>; consent?: boolean }>().catch(() => ({}) as Record<string, never>);
  const a = await authenticate(c, (body as { calendarId?: string }).calendarId ?? c.req.query('calendar'));
  if (isResponse(a)) return a;
  const { calendar, friend } = a;
  try {
    const b = body as { slotId?: string | null; courseId?: string | null; startsAt?: string; answers?: Record<string, unknown>; consent?: boolean };
    if (!b.startsAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.startsAt)) return c.json({ success: false, error: '予約日時が正しくありません' }, 400);
    const booking = await createFriendBooking(c.env.DB, c.env, { calendar, friend, slotId: b.slotId || null, courseId: b.courseId || null, startsAt: b.startsAt, answers: b.answers ?? {}, consent: b.consent === true });
    return c.json({ success: true, data: { booking: await publicBooking(c.env.DB, calendar, booking, nowJst()), thanksUrl: calendar.screen.thanksUrls.complete || null } }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

reservePublic.get('/api/liff/reserve/me', async (c) => {
  const a = await authenticate(c, c.req.query('calendar'));
  if (isResponse(a)) return a;
  const { calendar, friend } = a;
  try {
    const { items } = await listReserveBookings(c.env.DB, calendar.id, { friendId: friend.id, limit: 100, order: 'desc' });
    const now = nowJst();
    const data = [];
    for (const b of items) data.push(await publicBooking(c.env.DB, calendar, b, now));
    return c.json({ success: true, data: { name: calendar.name, stopped: calendar.status !== 'active', bookings: data } });
  } catch (err) {
    return fail(c, err);
  }
});

reservePublic.get('/api/liff/reserve/bookings/:id', async (c) => {
  const b = await getReserveBooking(c.env.DB, c.req.param('id'));
  const a = await authenticate(c, b?.calendarId);
  if (isResponse(a)) return a;
  const { calendar, friend } = a;
  if (!b || b.friendId !== friend.id || b.isBlock) return c.json({ success: false, error: '予約が見つかりません', code: 'not_found' }, 404);
  return c.json({ success: true, data: await publicBooking(c.env.DB, calendar, b, nowJst()) });
});

reservePublic.post('/api/liff/reserve/bookings/:id/change', async (c) => {
  const b = await getReserveBooking(c.env.DB, c.req.param('id'));
  const a = await authenticate(c, b?.calendarId);
  if (isResponse(a)) return a;
  const { calendar, friend } = a;
  try {
    const body = await c.req.json<{ slotId?: string | null; courseId?: string | null; startsAt?: string; answers?: Record<string, unknown> }>();
    if (!body.startsAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.startsAt)) return c.json({ success: false, error: '予約日時が正しくありません' }, 400);
    const updated = await changeFriendBooking(c.env.DB, c.env, { calendar, friend, bookingId: c.req.param('id'), slotId: body.slotId || null, courseId: body.courseId || null, startsAt: body.startsAt, answers: body.answers });
    return c.json({ success: true, data: { booking: await publicBooking(c.env.DB, calendar, updated, nowJst()), thanksUrl: calendar.screen.thanksUrls.change || null } });
  } catch (err) {
    return fail(c, err);
  }
});

reservePublic.post('/api/liff/reserve/bookings/:id/cancel', async (c) => {
  const b = await getReserveBooking(c.env.DB, c.req.param('id'));
  const a = await authenticate(c, b?.calendarId);
  if (isResponse(a)) return a;
  const { calendar, friend } = a;
  try {
    const updated = await cancelFriendBooking(c.env.DB, c.env, { calendar, friend, bookingId: c.req.param('id') });
    return c.json({ success: true, data: { booking: await publicBooking(c.env.DB, calendar, updated, nowJst()), thanksUrl: calendar.screen.thanksUrls.cancel || null } });
  } catch (err) {
    return fail(c, err);
  }
});

export { reservePublic };
