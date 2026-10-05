import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  NotificationSettingError,
  createNotificationSetting,
  ensureDefaultNotificationSettings,
  listNotificationSettings,
  parseSchedule,
  parseTimings,
  updateNotificationSetting,
} from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { isWithinSchedule, listAdminDestinations, notifyEvent } from './notifications.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const ENV = { BEYOND_ADMIN_URL: 'https://admin.example.test', BEYOND_ADMIN_INTERNAL_TOKEN: 'secret' };
const LINE_DEST = { kind: 'line' as const, id: 'dl-1', name: 'サロンのタブレット' };
const MAIL_DEST = { kind: 'mail' as const, id: 'dm-1', name: 'shop@example.com' };

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','A店','s','t'),('b','ch-b','B店','s','t')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,real_name) VALUES('f1','U1','a','たろう','山田太郎'),('f2','U2','b','はなこ',NULL)`);
  sqlite.exec(`INSERT INTO tags(id,name) VALUES('t1','VIP')`);
  return { db, sqlite };
}

describe('通知設定の入力', () => {
  test('スケジュール: 常に / 曜日と時間帯。形が違うものは断る', () => {
    expect(parseSchedule(undefined)).toEqual({ mode: 'always' });
    expect(parseSchedule({ mode: 'weekly', days: [3, 1, 1], from: '09:00', to: '21:00' })).toEqual({ mode: 'weekly', days: [1, 3], from: '09:00', to: '21:00' });
    expect(() => parseSchedule({ mode: 'weekly', days: [], from: '09:00', to: '21:00' })).toThrow(NotificationSettingError);
    expect(() => parseSchedule({ mode: 'weekly', days: [1], from: '9:00', to: '21:00' })).toThrow(/09:00/);
    expect(() => parseSchedule({ mode: 'weekly', days: [1], from: '09:00', to: '09:00' })).toThrow(/終日/);
  });

  test('タイミング: 準備中のものは選べない。同じものは1つにまとめる。フォームは絞れる', () => {
    expect(parseTimings(['friend_add', { key: 'friend_add' }, { key: 'form_answered', formIds: ['f', 'f', ''] }])).toEqual([{ key: 'friend_add' }, { key: 'form_answered', formIds: ['f'] }]);
    expect(() => parseTimings([])).toThrow(/1つ以上/);
    expect(() => parseTimings(['nope'])).toThrow(/未対応/);
    expect(() => parseTimings(['send_count_warning'])).toThrow(/準備中/);
  });

  test('作成・更新: 通知先は1つ以上。オンにするには通知先が要る。標準の設定は通知先なしでも作れる', async () => {
    const { db } = setup();
    await expect(createNotificationSetting(db, 'a', { title: 'x', timings: ['message'], destinations: [] })).rejects.toThrow(/通知先/);
    const s = await createNotificationSetting(db, 'a', { title: 'チャット通知', timings: ['message', { key: 'form_answered' }], destinations: [LINE_DEST, LINE_DEST, MAIL_DEST] });
    expect(s).toMatchObject({ status: 'on', schedule: { mode: 'always' }, isDefault: false });
    expect(s.destinations).toHaveLength(2);
    const off = await updateNotificationSetting(db, s.id, { status: 'off' });
    expect(off.status).toBe('off');
    await expect(updateNotificationSetting(db, s.id, { destinations: [] })).rejects.toThrow(/通知先/);
    const defaults = await ensureDefaultNotificationSettings(db, 'b', []);
    expect(defaults.map((d) => [d.title, d.status, d.isDefault])).toEqual([['チャット通知', 'off', true], ['友だち追加通知', 'off', true]]);
    // すでに設定があるアカウントには、作らない(何度呼んでも増えない)
    expect(await ensureDefaultNotificationSettings(db, 'b', [LINE_DEST])).toEqual([]);
    expect((await listNotificationSettings(db, 'b'))).toHaveLength(2);
    // 通知先があれば、オンで作る
    const withDest = await ensureDefaultNotificationSettings(db, 'a-none', [LINE_DEST]).catch((e) => e);
    expect(withDest).toBeInstanceOf(NotificationSettingError);
  });
});

describe('通知スケジュール(日本時間)', () => {
  const at = (iso: string) => new Date(iso); // UTC。日本時間は +9 時間
  test('常には、いつでも', () => {
    expect(isWithinSchedule({ mode: 'always' }, at('2026-10-05T03:00:00Z'))).toBe(true);
  });
  test('曜日と時間帯(同じ日の中)。月曜(1)の 09:00〜21:00', () => {
    const s = { mode: 'weekly' as const, days: [1], from: '09:00', to: '21:00' };
    expect(isWithinSchedule(s, at('2026-10-05T03:00:00Z'))).toBe(true); // 月曜 12:00 JST
    expect(isWithinSchedule(s, at('2026-10-05T12:30:00Z'))).toBe(false); // 月曜 21:30 JST
    expect(isWithinSchedule(s, at('2026-10-06T03:00:00Z'))).toBe(false); // 火曜 12:00 JST
  });
  test('日をまたぐ時間帯(月曜の 22:00〜翌朝 06:00)', () => {
    const s = { mode: 'weekly' as const, days: [1], from: '22:00', to: '06:00' };
    expect(isWithinSchedule(s, at('2026-10-05T14:00:00Z'))).toBe(true); // 月曜 23:00 JST
    expect(isWithinSchedule(s, at('2026-10-05T20:00:00Z'))).toBe(true); // 火曜 05:00 JST(月曜の続き)
    expect(isWithinSchedule(s, at('2026-10-05T22:00:00Z'))).toBe(false); // 火曜 07:00 JST
  });
});

describe('通知を送る(beyond admin の宛先へ)', () => {
  let calls: { url: string; body: Record<string, unknown> | null; auth: string | null }[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
      if (String(url).includes('/api/internal/mail')) return new Response(JSON.stringify({ ok: false, reason: '宛先が見つかりません' }), { status: 404 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  test('条件に合うオンの設定の通知先すべてへ、本文つきで送る。同じ通知先に二重に送らない。結果を記録する', async () => {
    const { db, sqlite } = setup();
    await createNotificationSetting(db, 'a', { title: '1', timings: ['message'], destinations: [LINE_DEST, MAIL_DEST] });
    await createNotificationSetting(db, 'a', { title: '2', timings: ['message', 'friend_add'], destinations: [LINE_DEST] });
    await createNotificationSetting(db, 'a', { title: 'オフ', timings: ['message'], status: 'off', destinations: [{ kind: 'line', id: 'dl-off', name: '' }] });
    await createNotificationSetting(db, 'b', { title: '別の店', timings: ['message'], destinations: [{ kind: 'line', id: 'dl-b', name: '' }] });
    await notifyEvent(db, { accountId: 'a', timing: 'message', friendId: 'f1', detail: 'こんにちは' }, ENV);
    const push = calls.filter((c) => c.url.endsWith('/api/internal/line/push'));
    expect(push).toHaveLength(1);
    expect(push[0].auth).toBe('Bearer secret');
    expect(push[0].body).toMatchObject({ destinationId: 'dl-1' });
    expect(String(push[0].body?.text)).toBe('【A店】通常メッセージ\nお客様: 山田太郎\nこんにちは');
    expect(calls.filter((c) => c.url.endsWith('/api/internal/mail'))).toHaveLength(1);
    expect(calls.some((c) => JSON.stringify(c.body).includes('dl-off') || JSON.stringify(c.body).includes('dl-b'))).toBe(false);
    const log = sqlite.prepare('SELECT destination_kind AS k, status, error FROM notification_deliveries ORDER BY destination_kind').all();
    expect(log).toEqual([{ k: 'line', status: 'sent', error: null }, { k: 'mail', status: 'failed', error: '宛先が見つかりません' }]);
  });

  test('友だちの公式アカウントは、友だちIDから決める。アカウントが違えば送らない', async () => {
    const { db } = setup();
    await createNotificationSetting(db, 'a', { title: 'A', timings: ['friend_block'], destinations: [LINE_DEST] });
    await notifyEvent(db, { accountId: null, timing: 'friend_block', friendId: 'f2' }, ENV);
    expect(calls).toHaveLength(0);
    await notifyEvent(db, { accountId: null, timing: 'friend_block', friendId: 'f1' }, ENV);
    expect(calls).toHaveLength(1);
  });

  test('絞り込み(タグ)・フォームの指定・スケジュールに合わないものは送らない。友だち追加時は絞り込みの対象外', async () => {
    const { db, sqlite } = setup();
    await createNotificationSetting(db, 'a', { title: 'VIPだけ', timings: ['message', 'friend_add'], filterTagIds: ['t1'], destinations: [LINE_DEST] });
    await notifyEvent(db, { accountId: 'a', timing: 'message', friendId: 'f1' }, ENV);
    expect(calls).toHaveLength(0);
    sqlite.exec("INSERT INTO friend_tags(friend_id,tag_id) VALUES('f1','t1')");
    await notifyEvent(db, { accountId: 'a', timing: 'message', friendId: 'f1' }, ENV);
    expect(calls).toHaveLength(1);
    sqlite.exec("INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f3','U3','a','新規さん')");
    await notifyEvent(db, { accountId: 'a', timing: 'friend_add', friendId: 'f3' }, ENV);
    expect(calls).toHaveLength(2);

    calls.length = 0;
    await createNotificationSetting(db, 'b', { title: 'フォーム', timings: [{ key: 'form_answered', formIds: ['form-1'] }], destinations: [LINE_DEST] });
    await notifyEvent(db, { accountId: 'b', timing: 'form_answered', friendId: 'f2', formId: 'form-2' }, ENV);
    expect(calls).toHaveLength(0);
    await notifyEvent(db, { accountId: 'b', timing: 'form_answered', friendId: 'f2', formId: 'form-1' }, ENV);
    expect(calls).toHaveLength(1);

    calls.length = 0;
    await createNotificationSetting(db, 'b', { title: '夜だけ', timings: ['url_click'], schedule: { mode: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], from: '03:00', to: '04:00' }, destinations: [LINE_DEST] });
    vi.setSystemTime(new Date('2026-10-05T03:00:00Z')); // 日本時間 12:00(03:00〜04:00 の外)
    await notifyEvent(db, { accountId: 'b', timing: 'url_click', friendId: 'f2' }, ENV);
    vi.useRealTimers();
    expect(calls).toHaveLength(0);
  });

  test('beyond admin と連携していない・準備中のタイミングは、何もしない。通知の失敗で例外を上げない', async () => {
    const { db } = setup();
    await createNotificationSetting(db, 'a', { title: 'x', timings: ['message'], destinations: [LINE_DEST] });
    await notifyEvent(db, { accountId: 'a', timing: 'message', friendId: 'f1' }, {});
    await notifyEvent(db, { accountId: 'a', timing: 'send_count_warning' }, ENV);
    expect(calls).toHaveLength(0);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(notifyEvent(db, { accountId: 'a', timing: 'message', friendId: 'f1' }, ENV)).resolves.toBeUndefined();
  });

  test('通知先の候補: LINEとメールの宛先をまとめて取る。連携なし・契約不明は理由つきで返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ ok: true, destinations: String(url).includes('/line/') ? [{ id: 'dl-1', displayName: 'タブレット' }] : [{ id: 'dm-1', displayName: 'a@example.com' }] }), { status: 200 })));
    expect(await listAdminDestinations(ENV, 'tenant-1')).toEqual({ available: true, adminUrl: 'https://admin.example.test', line: [{ kind: 'line', id: 'dl-1', name: 'タブレット' }], mail: [{ kind: 'mail', id: 'dm-1', name: 'a@example.com' }] });
    expect(await listAdminDestinations({}, 'tenant-1')).toMatchObject({ available: false, line: [], mail: [] });
    expect(await listAdminDestinations(ENV, null)).toMatchObject({ available: false });
  });
});

describe('契約(会社)の特定', () => {
  test('スタッフ名簿の契約が1つだけなら、環境変数のオーナーでもそれを使う。複数なら特定しない', async () => {
    const { resolveTenantId } = await import('./notifications.js');
    const { db, sqlite } = setup();
    expect(await resolveTenantId(db, ENV, 'env-owner')).toBeNull();
    sqlite.exec(`INSERT INTO staff_members(id,name,role,api_key,external_tenant_id) VALUES('s1','A','admin','k1','tenant-1'),('s2','B','staff','k2','tenant-1')`);
    expect(await resolveTenantId(db, ENV, 'env-owner')).toBe('tenant-1');
    sqlite.exec(`INSERT INTO staff_members(id,name,role,api_key,external_tenant_id) VALUES('s3','C','staff','k3','tenant-2')`);
    expect(await resolveTenantId(db, ENV, 'env-owner')).toBeNull();
    // 本人の契約があれば、それが優先
    expect(await resolveTenantId(db, ENV, 's3')).toBe('tenant-2');
  });
});
