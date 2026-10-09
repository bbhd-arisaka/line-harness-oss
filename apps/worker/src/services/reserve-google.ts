// カレンダー予約 × Googleカレンダー連携。
// ・予約(確定したもの)を、Googleカレンダーの予定として作る/更新する/消す
// ・Googleカレンダー側の予定の時間帯を、予約を受け付けない時間(ブロック)として扱う
// 接続(Googleアカウントの認可)は、既存の google_calendar_connections を使う。
import { getCalendarConnectionById, updateReserveBooking } from '@line-crm/db';
import type { ReserveBooking, ReserveCalendar, ReserveSlot } from '@line-crm/db';
import { GoogleCalendarClient } from './google-calendar.js';
import { clientForConnection } from './booking-calendar-sync.js';
import { fetchIcalBusy } from './ical-busy.js';
import type { BusyInterval } from './ical-busy.js';
import type { GoogleCalendarCredentials } from './google-oauth.js';

export interface ReserveGoogleEnv {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
}

/** この予約システムが作った予定のID(Googleの予定IDは 0-9 と a-v だけ)。ほかの予定と区別するための印にもなる */
export const RESERVE_EVENT_PREFIX = 'rsv';
export const reserveEventId = (bookingId: string): string => RESERVE_EVENT_PREFIX + bookingId.replace(/-/g, '').toLowerCase();

function credentials(env: ReserveGoogleEnv): GoogleCalendarCredentials {
  return {
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  };
}

async function clientFor(db: D1Database, env: ReserveGoogleEnv, connectionId: string): Promise<GoogleCalendarClient | null> {
  const conn = await getCalendarConnectionById(db, connectionId);
  if (!conn || !conn.is_active) return null;
  return clientForConnection(
    { id: conn.id, calendar_id: conn.calendar_id, auth_type: conn.auth_type, access_token: conn.access_token, refresh_token: conn.refresh_token },
    credentials(env),
  );
}

const withSeconds = (dt: string): string => (dt.length === 16 ? `${dt}:00` : dt);

export interface GoogleEventText {
  summary: string;
  description: string;
}

/** 予約の現在の状態に、Googleの予定を合わせる(確定している予約=予定あり、それ以外=予定なし)。失敗しても予約は止めない */
export async function reconcileBookingToGoogle(
  db: D1Database,
  env: ReserveGoogleEnv,
  calendar: Pick<ReserveCalendar, 'external'>,
  booking: ReserveBooking | null,
  text: GoogleEventText,
): Promise<void> {
  const g = calendar.external.google;
  if (!booking || !g.enabled || !g.connectionId || g.target === 'shift') return;
  try {
    const client = await clientFor(db, env, g.connectionId);
    if (!client) return;
    const wanted = booking.status === 'confirmed' && !booking.isBlock;
    if (wanted) {
      const input = { summary: text.summary, description: text.description, start: withSeconds(booking.startsAt), end: withSeconds(booking.endsAt) };
      if (booking.googleEventId) {
        await client.updateEvent(booking.googleEventId, input);
      } else {
        const created = await client.createEvent({ ...input, externalId: reserveEventId(booking.id) });
        await updateReserveBooking(db, booking.id, { googleEventId: created.eventId });
      }
    } else if (booking.googleEventId) {
      await client.deleteEvent(booking.googleEventId);
      await updateReserveBooking(db, booking.id, { googleEventId: null });
    }
  } catch (err) {
    console.error('[reserve] google sync failed', booking.id, err instanceof Error ? err.message : err);
  }
}

/** 予約を消す前に、Googleの予定も消す */
export async function removeBookingFromGoogle(db: D1Database, env: ReserveGoogleEnv, calendar: Pick<ReserveCalendar, 'external'>, booking: ReserveBooking | null): Promise<void> {
  const g = calendar.external.google;
  if (!booking?.googleEventId || !g.enabled || !g.connectionId) return;
  try {
    const client = await clientFor(db, env, g.connectionId);
    if (client) await client.deleteEvent(booking.googleEventId);
  } catch (err) {
    console.error('[reserve] google remove failed', booking.id, err instanceof Error ? err.message : err);
  }
}

const toJstWall = (iso: string): string => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16);

/**
 * Googleカレンダーの予定(この予約システムが作ったもの以外)を、予約を受け付けない時間として返す。
 * すべての予約枠(と「予約枠なし」)に、同じ時間帯のブロックを置く。取得に失敗したら、何もブロックしない。
 */
export async function googleBusyBlocks(
  db: D1Database,
  env: ReserveGoogleEnv,
  calendar: Pick<ReserveCalendar, 'id' | 'lineAccountId' | 'external'>,
  slots: Array<Pick<ReserveSlot, 'id'>>,
  range: { from: string; to: string },
): Promise<ReserveBooking[]> {
  const g = calendar.external.google;
  if (!g.enabled || g.target === 'bookings' || (!g.connectionId && !g.icalUrl)) return [];
  try {
    const timeMin = new Date(`${range.from}T00:00:00+09:00`).toISOString();
    const timeMax = new Date(new Date(`${range.to}T00:00:00+09:00`).getTime() + 24 * 3600 * 1000).toISOString();
    const busy: BusyInterval[] = [];
    if (g.connectionId) {
      try {
        const client = await clientFor(db, env, g.connectionId);
        if (client) busy.push(...(await client.listBusyIntervals(timeMin, timeMax, RESERVE_EVENT_PREFIX)));
      } catch (err) {
        console.error('[reserve] google busy (api) failed', err instanceof Error ? err.message : err);
      }
    }
    if (g.icalUrl) {
      try {
        busy.push(...(await fetchIcalBusy(g.icalUrl, new Date(timeMin).getTime(), new Date(timeMax).getTime())));
      } catch (err) {
        console.error('[reserve] google busy (ical) failed', err instanceof Error ? err.message : err);
      }
    }
    const targets: Array<string | null> = [null, ...slots.map((s) => s.id)];
    const blocks: ReserveBooking[] = [];
    let n = 0;
    for (const b of busy) {
      for (const slotId of targets) {
        blocks.push({
          id: `google-${n++}`,
          calendarId: calendar.id,
          lineAccountId: calendar.lineAccountId,
          friendId: null,
          slotId,
          courseId: null,
          isBlock: true,
          startsAt: toJstWall(b.start),
          endsAt: toJstWall(b.end),
          displayEndsAt: null,
          status: 'confirmed',
          pendingKind: null,
          pendingPayload: null,
          followupStatus: null,
          visited: false,
          visitedAt: null,
          followState: 'none',
          createdBy: 'admin',
          answers: {},
          guestName: null,
          price: 0,
          slotPriceApplied: false,
          memo: 'Googleカレンダーの予定',
          requestedAt: '',
          createdAt: '',
          updatedAt: '',
          googleEventId: null,
        });
      }
    }
    return blocks;
  } catch (err) {
    console.error('[reserve] google busy failed', err instanceof Error ? err.message : err);
    return [];
  }
}
