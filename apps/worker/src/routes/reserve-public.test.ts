import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createReserveCalendar, createReserveCourse, createReserveSlot, getReserveCalendar, saveReserveCalendarSection, setReserveCalendarStatus } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

// LINEのIDトークン確認だけ差し替える(友だちは U1 の人)。ほかは、本物のAPIとDBで動かす。
vi.mock('./booking.js', () => ({
  resolveAccountIdFromLiff: async () => 'a',
  verifyCallerLineUserId: async () => 'U1',
}));
const { reservePublic } = await import('./reserve-public.js');

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

async function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','採用','s','t')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,is_following) VALUES('f1','U1','a','たろう',1)`);
  let cal = await createReserveCalendar(db, 'a', '採用_面接予約フォーム');
  await setReserveCalendarStatus(db, cal.id, 'active');
  const slot = await createReserveSlot(db, cal.id, { name: 'WEB面談予約', capacity: 1, iconUrl: 'https://example.com/icon.png' });
  const c1 = await createReserveCourse(db, cal.id, { name: 'イオンモール土岐店', durationMinutes: 30 });
  await createReserveCourse(db, cal.id, { name: '大門浜松町店', durationMinutes: 30 });
  cal = (await getReserveCalendar(db, cal.id))!;
  await saveReserveCalendarSection(db, cal, 'screen', { ...cal.screen, fields: cal.screen.fields.map((f) => ({ ...f, required: false })), unitMinutes: 30 });
  const app = new Hono();
  app.route('/', reservePublic);
  const env = { DB: db, WORKER_URL: 'https://w.example.com' };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`${path}${path.includes('?') ? '&' : '?'}liffId=L&calendar=${cal.id}`, { method, headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, env);
    return { status: res.status, json: (await res.json()) as { success: boolean; data?: any; error?: string; code?: string } };
  };
  return { call, cal, slot, c1 };
}

// 日付は、いまから十分先の平日(月曜)にする
const monday = (() => {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + 14);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

describe('友だち側の予約API(LIFF)', () => {
  test('設定の取得 → 空き → 予約 → 一覧 → 変更 → キャンセル', async () => {
    const { call, slot, c1 } = await setup();

    const cfg = await call('GET', '/api/liff/reserve/config');
    expect(cfg.status).toBe(200);
    expect(cfg.json.data.slots[0]).toMatchObject({ id: slot.id, name: 'WEB面談予約', iconUrl: 'https://example.com/icon.png' });
    expect(cfg.json.data.courses.map((c: { name: string }) => c.name)).toEqual(['イオンモール土岐店', '大門浜松町店']);

    const av = await call('GET', `/api/liff/reserve/availability?slot_id=${slot.id}&course_id=${c1.id}&from=${monday}&to=${monday}`);
    expect(av.status).toBe(200);
    const times = av.json.data.days[monday] as Array<{ time: string; available: boolean }>;
    expect(times.find((t) => t.time === '10:00')?.available).toBe(true);
    expect(times.some((t) => t.time === '19:30')).toBe(false);

    const booked = await call('POST', '/api/liff/reserve/bookings', { calendarId: undefined, slotId: slot.id, courseId: c1.id, startsAt: `${monday}T10:00`, answers: {}, consent: false });
    expect(booked.status).toBe(201);
    const id = booked.json.data.booking.id as string;
    expect(booked.json.data.booking).toMatchObject({ status: 'confirmed', startsAt: `${monday}T10:00`, endsAt: `${monday}T10:30` });

    // 同じ時間は、もう取れない
    const again = await call('POST', '/api/liff/reserve/bookings', { slotId: slot.id, courseId: c1.id, startsAt: `${monday}T10:00`, answers: {}, consent: false });
    expect(again.status).toBe(409);

    const me = await call('GET', '/api/liff/reserve/me');
    expect(me.json.data.bookings).toHaveLength(1);

    const moved = await call('POST', `/api/liff/reserve/bookings/${id}/change`, { slotId: slot.id, courseId: c1.id, startsAt: `${monday}T11:00`, answers: {} });
    expect(moved.status).toBe(200);
    expect(moved.json.data.booking.startsAt).toBe(`${monday}T11:00`);

    const cancelled = await call('POST', `/api/liff/reserve/bookings/${id}/cancel`, {});
    expect(cancelled.status).toBe(200);
    expect(cancelled.json.data.booking.status).toBe('cancelled');

    // キャンセルしたら、10:00 も 11:00 も、また取れる
    const av2 = await call('GET', `/api/liff/reserve/availability?slot_id=${slot.id}&course_id=${c1.id}&from=${monday}&to=${monday}`);
    expect((av2.json.data.days[monday] as Array<{ time: string; available: boolean }>).find((t) => t.time === '11:00')?.available).toBe(true);
  });
});
