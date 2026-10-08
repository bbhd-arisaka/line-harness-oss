import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  createReserveCalendar,
  createReserveCourse,
  createReserveSlot,
  createReserveShifts,
  getReserveBooking,
  getReserveCalendar,
  listReserveBookings,
  saveReserveCalendarSection,
  setReserveCalendarStatus,
} from '@line-crm/db';
import type { ReserveCalendar } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import {
  ReserveBookingError,
  adminCancelBooking,
  adminCreateBooking,
  cancelFriendBooking,
  changeFriendBooking,
  createFriendBooking,
  decideRequest,
  markVisited,
  processReserveDeliveries,
} from './reserve-bookings.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const ENV = {};
// 2026-10-13(火)・14(水)は平日。いまは 2026-10-01 09:00
const NOW = '2026-10-01T09:00';

async function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','A店','s','t')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,is_following) VALUES('f1','U1','a','たろう',1),('f2','U2','a','はなこ',1),('fb','U3','a','ブロック中',0)`);
  sqlite.exec(`INSERT INTO tags(id,name) VALUES('t-booked','予約済み'),('t-remind','リマインド'),('t-follow','フォロー')`);
  let cal = await createReserveCalendar(db, 'a', '面談予約');
  await setReserveCalendarStatus(db, cal.id, 'active');
  const slot = await createReserveSlot(db, cal.id, { name: 'WEB面談予約', capacity: 1 });
  const course = await createReserveCourse(db, cal.id, { name: '30分', durationMinutes: 30 });
  // 名前は任意にして、テストを簡単にする
  const screen = { ...cal.screen, fields: cal.screen.fields.map((f) => ({ ...f, required: false })), unitMinutes: 30 };
  cal = (await getReserveCalendar(db, cal.id))!;
  await saveReserveCalendarSection(db, cal, 'screen', screen);
  cal = (await getReserveCalendar(db, cal.id))!;
  return { db, sqlite, cal, slot, course };
}

const friend = (id: string, line = 'U1') => ({ id, line_account_id: 'a', line_user_id: line, is_following: 1 });

async function reload(db: D1Database, id: string): Promise<ReserveCalendar> {
  return (await getReserveCalendar(db, id))!;
}

describe('友だちの予約', () => {
  test('予約できる。同じ枠の2人目は断られる。キャンセルすると、また取れる', async () => {
    const { db, cal, slot, course } = await setup();
    const b = await createFriendBooking(db, ENV, { calendar: cal, friend: friend('f1'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: { name: '山田太郎' }, consent: false, now: NOW });
    expect(b).toMatchObject({ status: 'confirmed', startsAt: '2026-10-13T10:00', endsAt: '2026-10-13T10:30', guestName: '山田太郎', slotId: slot.id });
    await expect(createFriendBooking(db, ENV, { calendar: cal, friend: friend('f2', 'U2'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: {}, consent: false, now: NOW })).rejects.toMatchObject({ code: 'unavailable' });
    await adminCancelBooking(db, ENV, { calendar: cal, actor: 'テスト', bookingId: b.id, runActions: false });
    const again = await createFriendBooking(db, ENV, { calendar: cal, friend: friend('f2', 'U2'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: {}, consent: false, now: NOW });
    expect(again.status).toBe('confirmed');
  });

  test('停止中・ブロック中の友だち・必須の選択・受付時間外は、予約できない', async () => {
    const { db, cal, slot, course } = await setup();
    const base = { calendar: cal, friend: friend('f1'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: {}, consent: false, now: NOW };
    await expect(createFriendBooking(db, ENV, { ...base, friend: { ...friend('fb', 'U3'), is_following: 0 } })).rejects.toMatchObject({ code: 'cannot_book' });
    await expect(createFriendBooking(db, ENV, { ...base, slotId: null })).rejects.toMatchObject({ code: 'slot_required' }); // 予約枠は必須(既定)
    await expect(createFriendBooking(db, ENV, { ...base, startsAt: '2026-10-13T20:00' })).rejects.toMatchObject({ code: 'unavailable' });
    await setReserveCalendarStatus(db, cal.id, 'stopped');
    await expect(createFriendBooking(db, ENV, { ...base, calendar: await reload(db, cal.id) })).rejects.toMatchObject({ code: 'stopped' });
  });

  test('予約情報取得項目: 必須・形式を確かめ、同意事項が必要なときは同意が要る。回答を友だち情報・本名に反映', async () => {
    const { db, sqlite, cal, slot, course } = await setup();
    const screen = {
      ...cal.screen,
      consent: { show: true, title: '利用規約', body: '規約です' },
      fields: [
        { id: 'name', label: 'お名前', description: '', type: 'text', textKind: 'name', options: [], required: true, friendFieldKey: null, linkGoogle: true, linkRealName: true },
        { id: 'kana', label: 'カナ', description: '', type: 'text', textKind: 'kana', options: [], required: true, friendFieldKey: 'kana_name', linkGoogle: true, linkRealName: false },
      ],
    };
    await saveReserveCalendarSection(db, cal, 'screen', screen);
    const c2 = await reload(db, cal.id);
    const base = { calendar: c2, friend: friend('f1'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T11:00', consent: true, now: NOW };
    await expect(createFriendBooking(db, ENV, { ...base, answers: { name: '山田', kana: 'ヤマダ' }, consent: false })).rejects.toMatchObject({ code: 'consent_required' });
    await expect(createFriendBooking(db, ENV, { ...base, answers: { name: '山田' } })).rejects.toMatchObject({ code: 'invalid_answer' });
    await expect(createFriendBooking(db, ENV, { ...base, answers: { name: '山田', kana: 'やまだ' } })).rejects.toThrow(/カタカナ/);
    await createFriendBooking(db, ENV, { ...base, answers: { name: '山田太郎', kana: 'ヤマダタロウ' } });
    const f = sqlite.prepare("SELECT real_name, metadata FROM friends WHERE id='f1'").get() as { real_name: string; metadata: string };
    expect(f.real_name).toBe('山田太郎');
    expect(JSON.parse(f.metadata)).toEqual({ kana_name: 'ヤマダタロウ' });
  });
});

describe('承認(リクエスト制)', () => {
  test('新規予約をリクエスト制にすると、承認待ち(枠はふさぐ)。承認で確定、否認で解放', async () => {
    const { db, cal, slot, course } = await setup();
    await saveReserveCalendarSection(db, cal, 'reception', { ...cal.reception, approval: { newBooking: 'request', change: 'allow', cancel: 'allow' } });
    const c2 = await reload(db, cal.id);
    const mk = (fid: string, line: string) => createFriendBooking(db, ENV, { calendar: c2, friend: friend(fid, line), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: {}, consent: false, now: NOW });
    const req = await mk('f1', 'U1');
    expect(req).toMatchObject({ status: 'pending', pendingKind: 'new' });
    await expect(mk('f2', 'U2')).rejects.toMatchObject({ code: 'unavailable' });
    const rejected = await decideRequest(db, ENV, { calendar: c2, actor: '管理者', bookingId: req.id, decision: 'reject', runActions: false, now: NOW });
    expect(rejected.status).toBe('rejected');
    const second = await mk('f2', 'U2');
    const approved = await decideRequest(db, ENV, { calendar: c2, actor: '管理者', bookingId: second.id, decision: 'approve', runActions: false, now: NOW });
    expect(approved).toMatchObject({ status: 'confirmed', pendingKind: null });
  });

  test('変更・キャンセルをリクエスト制にすると、承認されるまで予約は変わらない。期限を過ぎたらできない', async () => {
    const { db, cal, slot, course } = await setup();
    await saveReserveCalendarSection(db, cal, 'reception', { ...cal.reception, approval: { newBooking: 'auto', change: 'request', cancel: 'request' }, changeDeadline: '1d', cancelDeadline: '1d' });
    const c2 = await reload(db, cal.id);
    const b = await createFriendBooking(db, ENV, { calendar: c2, friend: friend('f1'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: {}, consent: false, now: NOW });
    const ch = await changeFriendBooking(db, ENV, { calendar: c2, friend: friend('f1'), bookingId: b.id, slotId: slot.id, courseId: course.id, startsAt: '2026-10-14T11:00', now: NOW });
    expect(ch).toMatchObject({ status: 'confirmed', startsAt: '2026-10-13T10:00', pendingKind: 'change' });
    await expect(cancelFriendBooking(db, ENV, { calendar: c2, friend: friend('f1'), bookingId: b.id, now: NOW })).rejects.toMatchObject({ code: 'pending_exists' });
    const approved = await decideRequest(db, ENV, { calendar: c2, actor: '管理者', bookingId: b.id, decision: 'approve', runActions: false, now: NOW });
    expect(approved).toMatchObject({ startsAt: '2026-10-14T11:00', endsAt: '2026-10-14T11:30', pendingKind: null });
    const cr = await cancelFriendBooking(db, ENV, { calendar: c2, friend: friend('f1'), bookingId: b.id, now: NOW });
    expect(cr).toMatchObject({ status: 'confirmed', pendingKind: 'cancel' });
    const done = await decideRequest(db, ENV, { calendar: c2, actor: '管理者', bookingId: b.id, decision: 'approve', runActions: false, now: NOW });
    expect(done.status).toBe('cancelled');
    // 前日(予約日の0時)を過ぎたら、変更できない
    const b2 = await createFriendBooking(db, ENV, { calendar: c2, friend: friend('f2', 'U2'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: {}, consent: false, now: NOW });
    await expect(changeFriendBooking(db, ENV, { calendar: c2, friend: friend('f2', 'U2'), bookingId: b2.id, slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T11:00', now: '2026-10-13T08:00' })).rejects.toMatchObject({ code: 'deadline_passed' });
  });

  test('直接変更・キャンセル(許可): すぐ反映され、他人の予約は触れない', async () => {
    const { db, cal, slot, course } = await setup();
    const b = await createFriendBooking(db, ENV, { calendar: cal, friend: friend('f1'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: {}, consent: false, now: NOW });
    const ch = await changeFriendBooking(db, ENV, { calendar: cal, friend: friend('f1'), bookingId: b.id, slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T12:00', now: NOW });
    expect(ch.startsAt).toBe('2026-10-13T12:00');
    await expect(cancelFriendBooking(db, ENV, { calendar: cal, friend: friend('f2', 'U2'), bookingId: b.id, now: NOW })).rejects.toBeInstanceOf(ReserveBookingError);
    const c = await cancelFriendBooking(db, ENV, { calendar: cal, friend: friend('f1'), bookingId: b.id, now: NOW });
    expect(c.status).toBe('cancelled');
  });
});

describe('管理者の予約・ブロック枠', () => {
  test('管理者は、シフト外・受付時間外にも入れられる。ブロック枠は、その時間の予約を止める', async () => {
    const { db, cal, slot, course } = await setup();
    const admin = await adminCreateBooking(db, ENV, { calendar: cal, actor: '管理者', friendId: 'f1', slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T20:00', isBlock: false, answers: {}, runActions: false, slotPriceApplied: true, overwriteFriend: false });
    expect(admin).toMatchObject({ createdBy: 'admin', status: 'confirmed', endsAt: '2026-10-13T20:30' });
    await adminCreateBooking(db, ENV, { calendar: cal, actor: '管理者', friendId: null, slotId: slot.id, courseId: null, startsAt: '2026-10-14T10:00', endsAt: '2026-10-14T12:00', isBlock: true, answers: {}, runActions: false, slotPriceApplied: true, overwriteFriend: false });
    await expect(createFriendBooking(db, ENV, { calendar: cal, friend: friend('f2', 'U2'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-14T11:00', answers: {}, consent: false, now: NOW })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(adminCreateBooking(db, ENV, { calendar: cal, actor: '管理者', friendId: 'fb', slotId: slot.id, courseId: course.id, startsAt: '2026-10-15T10:00', isBlock: false, answers: {}, runActions: false, slotPriceApplied: true, overwriteFriend: false })).rejects.toMatchObject({ code: 'friend_blocked' });
  });
});

describe('アクション・リマインダ・フォロー', () => {
  test('予約完了時のアクション(タグ追加)。変更・キャンセル時も', async () => {
    const { db, sqlite, cal, slot, course } = await setup();
    await saveReserveCalendarSection(db, cal, 'actions', {
      onBooked: [{ type: 'tag', params: { op: 'add', tagIds: ['t-booked'] }, condition: null }],
      onCancelled: [{ type: 'tag', params: { op: 'remove', tagIds: ['t-booked'] }, condition: null }],
    });
    const c2 = await reload(db, cal.id);
    const b = await createFriendBooking(db, ENV, { calendar: c2, friend: friend('f1'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: {}, consent: false, now: NOW });
    expect(sqlite.prepare("SELECT tag_id FROM friend_tags WHERE friend_id='f1'").all()).toEqual([{ tag_id: 't-booked' }]);
    await cancelFriendBooking(db, ENV, { calendar: c2, friend: friend('f1'), bookingId: b.id, now: NOW });
    expect(sqlite.prepare("SELECT COUNT(*) c FROM friend_tags WHERE friend_id='f1'").get()).toEqual({ c: 0 });
  });

  test('リマインダ: オンにしたあとに入った予約にだけ。時刻が来たら実行。キャンセルされた予約には送らない', async () => {
    const { db, sqlite, cal, slot, course } = await setup();
    // オンにする前の予約
    const before = await createFriendBooking(db, ENV, { calendar: cal, friend: friend('f2', 'U2'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: {}, consent: false, now: NOW });
    await saveReserveCalendarSection(db, cal, 'reminders', {
      enabled: true,
      items: [{ id: 'r1', kind: 'time', daysBefore: 1, time: '19:00', actions: [{ type: 'tag', params: { op: 'add', tagIds: ['t-remind'] }, condition: null }] }],
    });
    // オンにした時刻を、過去にずらして(テスト用)、このあとの予約は対象にする
    sqlite.exec("UPDATE reserve_calendars SET reminders = json_set(reminders, '$.enabledAt', '2026-10-01T00:00')");
    const c2 = await reload(db, cal.id);
    const a = await createFriendBooking(db, ENV, { calendar: c2, friend: friend('f1'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-14T10:00', answers: {}, consent: false, now: NOW });
    expect(sqlite.prepare("SELECT run_at FROM reserve_deliveries WHERE booking_id=? AND kind='reminder'").all(a.id)).toEqual([{ run_at: '2026-10-13T19:00' }]);
    expect(sqlite.prepare('SELECT COUNT(*) c FROM reserve_deliveries WHERE booking_id=?').get(before.id)).toEqual({ c: 0 }); // オンにする前に入っていた予約には、リマインダの予定は入らない
    // 実行(時刻を過去にして、cron を回す)
    sqlite.exec("UPDATE reserve_deliveries SET run_at='2000-01-01T00:00'");
    const n = await processReserveDeliveries(db, ENV);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(sqlite.prepare("SELECT tag_id FROM friend_tags WHERE friend_id='f1'").all()).toEqual([{ tag_id: 't-remind' }]);
    // キャンセルした予約への予定は、実行されない
    const c = await createFriendBooking(db, ENV, { calendar: c2, friend: friend('f1'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-15T10:00', answers: {}, consent: false, now: NOW });
    await cancelFriendBooking(db, ENV, { calendar: c2, friend: friend('f1'), bookingId: c.id, now: NOW });
    expect(sqlite.prepare("SELECT COUNT(*) c FROM reserve_deliveries WHERE booking_id=? AND status='pending'").get(c.id)).toEqual({ c: 0 });
  });

  test('フォロー: 来店済みにしたときだけ予定が入り、実行されると「フォロー終了」になる', async () => {
    const { db, sqlite, cal, slot, course } = await setup();
    await saveReserveCalendarSection(db, cal, 'follow', {
      enabled: true,
      items: [{ id: 'fo1', kind: 'elapsed', amount: 1, unit: 'hours', actions: [{ type: 'tag', params: { op: 'add', tagIds: ['t-follow'] }, condition: null }] }],
    });
    const c2 = await reload(db, cal.id);
    const b = await createFriendBooking(db, ENV, { calendar: c2, friend: friend('f1'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-13T10:00', answers: {}, consent: false, now: NOW });
    expect(sqlite.prepare("SELECT COUNT(*) c FROM reserve_deliveries WHERE booking_id=? AND kind='follow'").get(b.id)).toEqual({ c: 0 });
    const v = await markVisited(db, c2, '管理者', b.id, true, true);
    expect(v).toMatchObject({ visited: true, followState: 'running' });
    sqlite.exec("UPDATE reserve_deliveries SET run_at='2000-01-01T00:00'");
    await processReserveDeliveries(db, ENV);
    expect((await getReserveBooking(db, b.id))!.followState).toBe('done');
    expect(sqlite.prepare("SELECT tag_id FROM friend_tags WHERE friend_id='f1'").all()).toEqual([{ tag_id: 't-follow' }]);
    // フォローを実行しない選択
    const b2 = await createFriendBooking(db, ENV, { calendar: c2, friend: friend('f2', 'U2'), slotId: slot.id, courseId: course.id, startsAt: '2026-10-14T10:00', answers: {}, consent: false, now: NOW });
    expect((await markVisited(db, c2, '管理者', b2.id, true, false)).followState).toBe('none');
  });
});

describe('シフト連動と一覧', () => {
  test('シフト連動の予約枠は、シフトのある時間だけ。一覧は、条件で絞れる', async () => {
    const { db, cal, slot, course } = await setup();
    await saveReserveCalendarSection(db, cal, 'slotSettings', { ...cal.slotSettings, shiftLinked: true });
    await createReserveShifts(db, cal.id, { slotId: slot.id, date: '2026-10-13', startTime: '13:00', endTime: '15:00' });
    const c2 = await reload(db, cal.id);
    const base = { calendar: c2, friend: friend('f1'), slotId: slot.id, courseId: course.id, answers: {}, consent: false, now: NOW };
    await expect(createFriendBooking(db, ENV, { ...base, startsAt: '2026-10-13T10:00' })).rejects.toMatchObject({ code: 'unavailable' });
    const ok = await createFriendBooking(db, ENV, { ...base, startsAt: '2026-10-13T13:30' });
    expect(ok.startsAt).toBe('2026-10-13T13:30');
    const list = await listReserveBookings(db, cal.id, { from: '2026-10-13', to: '2026-10-13' });
    expect(list.total).toBe(1);
    expect(list.items[0].friend?.displayName).toBe('たろう');
    expect((await listReserveBookings(db, cal.id, { from: '2026-10-14', to: '2026-10-14' })).total).toBe(0);
  });
});
