import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { createReserveCalendar, createReserveCourse, createReserveSlot, getReserveCalendar, saveReserveCalendarSection, setReserveCalendarStatus } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { createFriendBooking } from '../services/reserve-bookings.js';
import { reserve } from './reserve.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

// 友だちが本当に予約した後の状態で、管理画面が使うAPIがすべて動くことを確かめる
async function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','採用','s','t')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,memo,is_following) VALUES('f1','U1','a','たろう','メモです',1)`);
  let cal = await createReserveCalendar(db, 'a', '面談');
  await setReserveCalendarStatus(db, cal.id, 'active');
  const slot = await createReserveSlot(db, cal.id, { name: 'WEB面談予約', capacity: 1 });
  const course = await createReserveCourse(db, cal.id, { name: '30分', durationMinutes: 30 });
  cal = (await getReserveCalendar(db, cal.id))!;
  await saveReserveCalendarSection(db, cal, 'screen', { ...cal.screen, fields: cal.screen.fields.map((f) => ({ ...f, required: false })), unitMinutes: 30 });
  cal = (await getReserveCalendar(db, cal.id))!;
  const booking = await createFriendBooking(db, {}, { calendar: cal, friend: { id: 'f1', line_account_id: 'a', line_user_id: 'U1', is_following: 1 }, slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: { name: '山田' }, consent: false, now: '2026-10-01T09:00' });
  const app = new Hono();
  app.route('/', reserve);
  const get = async (path: string) => app.request(path, {}, { DB: db });
  return { get, cal, booking };
}

describe('管理画面のAPI(友だちが予約した後)', () => {
  test('カレンダー・予約一覧・予約の詳細・CSV・友だちの予約・シフト・お知らせが、すべて読める', async () => {
    const { get, cal, booking } = await setup();
    const paths = [
      `/api/reserve/calendars?lineAccountId=a`,
      `/api/reserve/calendars/${cal.id}`,
      `/api/reserve/calendars/${cal.id}/bookings?from=2026-10-01&to=2026-10-31&includeBlocks=1&friendQ=たろう&guestQ=山田&timeFrom=09:00&timeTo=12:00`,
      `/api/reserve/calendars/${cal.id}/bookings.csv?from=2026-10-01&to=2026-10-31`,
      `/api/reserve/bookings/${booking.id}`,
      `/api/reserve/friends/f1/bookings`,
      `/api/reserve/calendars/${cal.id}/shifts?from=2026-10-01&to=2026-10-31`,
      `/api/reserve/calendars/${cal.id}/notices`,
      `/api/reserve/calendars/${cal.id}/google-connections`,
    ];
    for (const p of paths) {
      const res = await get(p);
      expect(res.status, p).toBe(200);
    }
    const detail = (await (await get(`/api/reserve/bookings/${booking.id}`)).json()) as { data: { friend: { notes: string }; logs: unknown[] } };
    expect(detail.data.friend.notes).toBe('メモです');
    expect(detail.data.logs.length).toBeGreaterThan(0);
    const list = (await (await get(`/api/reserve/calendars/${cal.id}/bookings?friendQ=たろう&guestQ=山田`)).json()) as { data: { total: number } };
    expect(list.data.total).toBe(1);
    const none = (await (await get(`/api/reserve/calendars/${cal.id}/bookings?guestQ=存在しない`)).json()) as { data: { total: number } };
    expect(none.data.total).toBe(0);
  });
});
