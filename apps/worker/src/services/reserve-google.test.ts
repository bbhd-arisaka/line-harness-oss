import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createReserveCalendar,
  createReserveCourse,
  createReserveSlot,
  getReserveBooking,
  getReserveCalendar,
  saveReserveCalendarSection,
  setReserveCalendarStatus,
} from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { adminCancelBooking, adminCreateBooking, adminDeleteBooking } from './reserve-bookings.js';
import { googleBusyBlocks } from './reserve-google.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

async function setup(target: 'all' | 'bookings' | 'shift' = 'all') {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','A店','s','t')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,is_following) VALUES('f1','U1','a','たろう',1)`);
  sqlite.exec(`INSERT INTO google_calendar_connections(id,calendar_id,line_account_id,access_token,auth_type,is_active) VALUES('gc1','primary','a','tok','access_token',1)`);
  let cal = await createReserveCalendar(db, 'a', '面談予約');
  await setReserveCalendarStatus(db, cal.id, 'active');
  const slot = await createReserveSlot(db, cal.id, { name: 'WEB面談予約', capacity: 1 });
  const course = await createReserveCourse(db, cal.id, { name: '30分', durationMinutes: 30 });
  cal = (await getReserveCalendar(db, cal.id))!;
  await saveReserveCalendarSection(db, cal, 'external', { google: { enabled: true, connectionId: 'gc1', target } });
  cal = (await getReserveCalendar(db, cal.id))!;
  return { db, cal, slot, course };
}

afterEach(() => vi.unstubAllGlobals());

describe('カレンダー予約 × Googleカレンダー', () => {
  test('予約を作るとGoogleの予定ができ、キャンセルすると消える', async () => {
    const { db, cal, slot, course } = await setup();
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ id: 'evt1' }), { status: 200 });
    });
    const b = await adminCreateBooking(db, {}, { calendar: cal, actor: 't', friendId: 'f1', slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', endsAt: '2026-10-13T10:30', isBlock: false, answers: { name: '山田太郎' }, runActions: false, slotPriceApplied: true, overwriteFriend: false, memo: '' } as never);
    expect(calls[0]).toMatchObject({ method: 'POST' });
    expect((calls[0].body as { id: string; summary: string }).id).toBe(`rsv${b.id.replace(/-/g, '')}`);
    expect((calls[0].body as { summary: string }).summary).toContain('山田太郎');
    expect((await getReserveBooking(db, b.id))?.googleEventId).toBe('evt1');

    await adminCancelBooking(db, {}, { calendar: cal, actor: 't', bookingId: b.id, runActions: false });
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE' });
    expect((await getReserveBooking(db, b.id))?.googleEventId).toBeNull();
  });

  test('連携がオフ・Googleの予定だけを取り込む設定のときは、予定を作らない', async () => {
    const { db, cal, slot, course } = await setup('shift');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await adminCreateBooking(db, {}, { calendar: cal, actor: 't', friendId: 'f1', slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', endsAt: '2026-10-13T10:30', isBlock: false, answers: {}, runActions: false, slotPriceApplied: true, overwriteFriend: false, memo: '' } as never);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('削除すると、Googleの予定も消える。通信に失敗しても予約の処理は止まらない', async () => {
    const { db, cal, slot, course } = await setup();
    let fail = false;
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      calls.push(init?.method ?? 'GET');
      if (fail) return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ id: 'evt9' }), { status: 200 });
    });
    const b = await adminCreateBooking(db, {}, { calendar: cal, actor: 't', friendId: 'f1', slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T11:00', endsAt: '2026-10-13T11:30', isBlock: false, answers: {}, runActions: false, slotPriceApplied: true, overwriteFriend: false, memo: '' } as never);
    await adminDeleteBooking(db, { calendar: cal, bookingId: b.id, env: {} });
    expect(calls).toEqual(['POST', 'DELETE']);
    fail = true;
    const b2 = await adminCreateBooking(db, {}, { calendar: cal, actor: 't', friendId: 'f1', slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T12:00', endsAt: '2026-10-13T12:30', isBlock: false, answers: {}, runActions: false, slotPriceApplied: true, overwriteFriend: false, memo: '' } as never);
    expect(b2.status).toBe('confirmed');
    expect((await getReserveBooking(db, b2.id))?.googleEventId).toBeNull();
  });

  test('Googleの予定の時間は、予約を受け付けない時間になる(この予約システムが作った予定は除く)', async () => {
    const { db, cal, slot } = await setup();
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          items: [
            { id: 'abc', start: { dateTime: '2026-10-13T10:00:00+09:00' }, end: { dateTime: '2026-10-13T11:00:00+09:00' } },
            { id: 'rsvabc', start: { dateTime: '2026-10-13T13:00:00+09:00' }, end: { dateTime: '2026-10-13T14:00:00+09:00' } },
            { id: 'free', transparency: 'transparent', start: { dateTime: '2026-10-13T15:00:00+09:00' }, end: { dateTime: '2026-10-13T16:00:00+09:00' } },
          ],
        }),
        { status: 200 },
      ),
    );
    const blocks = await googleBusyBlocks(db, {}, cal, [slot], { from: '2026-10-13', to: '2026-10-13' });
    // 予約枠なし + 1つの予約枠 の2本ぶん
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ isBlock: true, startsAt: '2026-10-13T10:00', endsAt: '2026-10-13T11:00' });
    expect(blocks.map((b) => b.slotId).sort()).toEqual([null, slot.id].sort());
    // 「予約をGoogleに反映するだけ」の設定なら、取り込まない
    const only = await setup('bookings');
    expect(await googleBusyBlocks(only.db, {}, only.cal, [], { from: '2026-10-13', to: '2026-10-13' })).toEqual([]);
  });
  test('iCalのURLだけでも、Googleの予定の時間を受け付けない時間にできる(接続の設定はいらない)', async () => {
    const { db, cal, slot } = await setup();
    await saveReserveCalendarSection(db, cal, 'external', { google: { enabled: true, connectionId: null, target: 'shift', icalUrl: 'https://calendar.google.com/calendar/ical/x/private-abc/basic.ics' } });
    const c2 = (await getReserveCalendar(db, cal.id))!;
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;TZID=Asia/Tokyo:20261013T100000', 'DTEND;TZID=Asia/Tokyo:20261013T110000', 'END:VEVENT', 'END:VCALENDAR', ''].join('\n'), { status: 200 });
    });
    const blocks = await googleBusyBlocks(db, {}, c2, [slot], { from: '2026-10-13', to: '2026-10-13' });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ startsAt: '2026-10-13T10:00', endsAt: '2026-10-13T11:00' });
    expect(urls[0]).toContain('private-abc');
  });
});
