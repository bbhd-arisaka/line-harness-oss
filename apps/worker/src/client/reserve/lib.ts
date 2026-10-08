// カレンダー予約(友だち側)の、APIの呼び出しと型。LINEのIDトークンで、友だち本人であることを確かめる。

export interface ReserveContext {
  liffId: string;
  lineUserId: string;
  idToken: string;
  calendarId: string;
  view: string;
  bookingId: string;
  linkId: string;
}

export interface ConfigField {
  id: string;
  label: string;
  description: string;
  type: 'text' | 'textarea' | 'select';
  textKind: string;
  options: string[];
  required: boolean;
}

export interface Option {
  id: string;
  name: string;
  price: number;
  description: string;
  descriptionHtml: boolean;
  /** コースだけ: 友だちに見せる時間(分)・色 */
  minutes?: number;
  color?: string;
}

export interface ReserveConfig {
  stopped: boolean;
  name: string;
  calendarId?: string;
  slotSettings?: { title: string; required: boolean; priceEnabled: boolean };
  courseSettings?: { title: string; required: boolean; priceEnabled: boolean; showDuration: boolean };
  screen?: {
    view: 'week' | 'month';
    unitMinutes: number;
    adminInfo: { imageUrl: string; name: string; address: string; phone: string; description: string } | null;
    consent: { title: string; body: string } | null;
    thanksUrls: { complete: string; change: string; cancel: string };
    fields: ConfigField[];
  };
  slots?: Option[];
  courses?: Option[];
  links?: Array<{ slotId: string; courseId: string }>;
  preset?: { slotId: string | null; courseId: string | null };
  prefill?: Record<string, string>;
  approval?: { newBooking: 'auto' | 'request' };
}

export interface PublicBooking {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'pending' | 'cancelled' | 'rejected';
  pendingKind: 'new' | 'change' | 'cancel' | null;
  slotId: string | null;
  courseId: string | null;
  slotName: string;
  courseName: string;
  price: number;
  answers: Array<{ label: string; value: string }>;
  answerValues: Record<string, string>;
  canChange: boolean;
  canCancel: boolean;
  changeMode: 'direct' | 'request';
  cancelMode: 'direct' | 'request';
}

export class ReserveApiError extends Error {
  constructor(
    message: string,
    public code: string | null,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(ctx: ReserveContext, path: string, init?: { method?: string; body?: unknown; query?: Record<string, string | undefined> }): Promise<T> {
  const u = new URL(path, window.location.origin);
  u.searchParams.set('liffId', ctx.liffId);
  u.searchParams.set('calendar', ctx.calendarId);
  for (const [k, v] of Object.entries(init?.query ?? {})) if (v) u.searchParams.set(k, v);
  const res = await fetch(u.pathname + u.search, {
    method: init?.method ?? 'GET',
    headers: { Authorization: `Bearer ${ctx.idToken}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string; code?: string } | null;
  if (!res.ok || !json || json.success === false) throw new ReserveApiError(json?.error ?? '通信に失敗しました。時間をおいて、もう一度お試しください', json?.code ?? null, res.status);
  return json.data as T;
}

export const reserveClient = {
  config: (ctx: ReserveContext) => call<ReserveConfig>(ctx, '/api/liff/reserve/config', { query: { link: ctx.linkId } }),
  availability: (ctx: ReserveContext, slotId: string | null, courseId: string | null, from: string, to: string) =>
    call<{ days: Record<string, Array<{ time: string; available: boolean }>>; noOptions: boolean }>(ctx, '/api/liff/reserve/availability', { query: { slot_id: slotId ?? undefined, course_id: courseId ?? undefined, from, to } }),
  book: (ctx: ReserveContext, body: { slotId: string | null; courseId: string | null; startsAt: string; answers: Record<string, string>; consent: boolean }) =>
    call<{ booking: PublicBooking; thanksUrl: string | null }>(ctx, '/api/liff/reserve/bookings', { method: 'POST', body: { calendarId: ctx.calendarId, ...body } }),
  me: (ctx: ReserveContext) => call<{ name: string; stopped: boolean; bookings: PublicBooking[] }>(ctx, '/api/liff/reserve/me'),
  detail: (ctx: ReserveContext, id: string) => call<PublicBooking>(ctx, `/api/liff/reserve/bookings/${id}`),
  change: (ctx: ReserveContext, id: string, body: { slotId: string | null; courseId: string | null; startsAt: string; answers: Record<string, string> }) =>
    call<{ booking: PublicBooking; thanksUrl: string | null }>(ctx, `/api/liff/reserve/bookings/${id}/change`, { method: 'POST', body }),
  cancel: (ctx: ReserveContext, id: string) => call<{ booking: PublicBooking; thanksUrl: string | null }>(ctx, `/api/liff/reserve/bookings/${id}/cancel`, { method: 'POST', body: {} }),
};

// ── 日時の道具(日本時間の文字) ──────────────────────────────────────────────

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
export const weekdayJa = (date: string): string => WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()];
export const todayJst = (): string => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
export const formatDateTime = (dt: string): string => {
  const [d, t] = dt.split('T');
  const [y, m, day] = d.split('-').map(Number);
  return `${y}年${m}月${day}日(${weekdayJa(d)}) ${t}`;
};
export const formatPrice = (n: number): string => `${n.toLocaleString('ja-JP')}円`;

/** Googleカレンダーに予定を追加するURL */
export function googleCalendarUrl(title: string, startsAt: string, endsAt: string, details: string): string {
  const f = (dt: string) => dt.replace(/[-:]/g, '').replace('T', 'T') + '00';
  const u = new URL('https://calendar.google.com/calendar/render');
  u.searchParams.set('action', 'TEMPLATE');
  u.searchParams.set('text', title);
  u.searchParams.set('dates', `${f(startsAt)}/${f(endsAt)}`);
  u.searchParams.set('ctz', 'Asia/Tokyo');
  u.searchParams.set('details', details);
  return u.toString();
}
