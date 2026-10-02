import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { authMiddleware } from '../middleware/auth.js';
import { accountAccessGuard } from '../middleware/account-access.js';
import { adminAuth } from '../routes/admin-auth.js';
import { staff as staffRoutes } from '../routes/staff.js';
import { clearExternalAuthCache, syncExternalUsers, verifyAdminSession } from './external-auth.js';
import type { Env } from '../index.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

const ENV = { BEYOND_ADMIN_URL: 'https://admin.example.test/', BEYOND_ADMIN_INTERNAL_TOKEN: 'internal-secret' };
const PROFILE = { valid: true, tenantId: 't-1', tenantName: 'エクラブロウ', userId: 'u-1', name: '山田 花子', email: 'hanako@example.test', role: 'manager' };

function okResponse(body: unknown = PROFILE, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => clearExternalAuthCache());

describe('verifyAdminSession(beyond admin への確認)', () => {
  test('設定が無ければ何もしない(従来どおり)', async () => {
    const f = vi.fn();
    expect(await verifyAdminSession({}, 'sid', f as unknown as typeof fetch)).toBeNull();
    expect(await verifyAdminSession({ BEYOND_ADMIN_URL: 'https://x' }, 'sid', f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  test('有効なセッションは、決まった形で確認し、結果を1分だけ覚える', async () => {
    const f = vi.fn(async () => okResponse());
    const a = await verifyAdminSession(ENV, 'sid-1', f as unknown as typeof fetch, 1_000);
    expect(a).toMatchObject({ userId: 'u-1', tenantId: 't-1', role: 'manager', name: '山田 花子' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://admin.example.test/api/internal/session');
    expect((init.headers as Record<string, string>)['x-internal-token']).toBe('internal-secret');
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: 'sid-1', toolKey: 'line' });
    await verifyAdminSession(ENV, 'sid-1', f as unknown as typeof fetch, 30_000);
    expect(f).toHaveBeenCalledTimes(1);
    await verifyAdminSession(ENV, 'sid-1', f as unknown as typeof fetch, 62_000);
    expect(f).toHaveBeenCalledTimes(2);
  });

  test('無効・契約なし・合言葉違い・通信失敗・形が崩れた応答は、すべてログインさせない', async () => {
    expect(await verifyAdminSession(ENV, 'a', (async () => okResponse({ valid: false, reason: 'no_contract' })) as unknown as typeof fetch)).toBeNull();
    expect(await verifyAdminSession(ENV, 'b', (async () => okResponse({ error: 'unauthorized' }, 401)) as unknown as typeof fetch)).toBeNull();
    expect(await verifyAdminSession(ENV, 'c', (async () => { throw new Error('network'); }) as unknown as typeof fetch)).toBeNull();
    expect(await verifyAdminSession(ENV, 'd', (async () => okResponse({ ...PROFILE, role: 'root' })) as unknown as typeof fetch)).toBeNull();
    expect(await verifyAdminSession(ENV, 'e', (async () => okResponse({ ...PROFILE, userId: '' })) as unknown as typeof fetch)).toBeNull();
  });

  test('入れてよい会社を指定したときは、それ以外の会社は入れない', async () => {
    const f = (async () => okResponse()) as unknown as typeof fetch;
    expect(await verifyAdminSession({ ...ENV, BEYOND_ADMIN_ALLOWED_TENANT_IDS: 't-9, t-1' }, 'x1', f)).not.toBeNull();
    expect(await verifyAdminSession({ ...ENV, BEYOND_ADMIN_ALLOWED_TENANT_IDS: 't-9' }, 'x2', f)).toBeNull();
  });
});

describe('beyond admin のログインで入る(認証〜アカウント権限まで)', () => {
  function setup(envOverride: Record<string, string | undefined> = ENV) {
    const { db, sqlite } = sqliteD1();
    sqlite.exec(schema);
    sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('acc-a','ch-a','A店','s','t'),('acc-b','ch-b','B店','s','t')`);
    const app = new Hono<Env>();
    app.use('*', authMiddleware);
    app.use('*', accountAccessGuard);
    app.route('/', adminAuth);
    app.route('/', staffRoutes);
    app.get('/api/friends', (c) => c.json({ success: true, who: c.get('staff') }));
    app.post('/api/tags', (c) => c.json({ success: true }));
    const bindings = { DB: db, API_KEY: 'env-key', WORKER_URL: 'https://w.example.test', ...envOverride } as unknown as Env['Bindings'];
    const call = (path: string, init: RequestInit = {}) => app.request(path, init, bindings);
    return { sqlite, call };
  }
  const cookie = (sid = 'sid-ok') => ({ Cookie: `bap_session=${sid}` });
  const mockAdmin = (body: unknown = PROFILE, status = 200) => vi.spyOn(globalThis, 'fetch').mockImplementation((async () => okResponse(body, status)) as unknown as typeof fetch);

  test('ログインできると、スタッフとして作られ、見られるアカウントは空から始まる(全アカウントが見えてしまわない)', async () => {
    mockAdmin();
    const { call, sqlite } = setup();
    const res = await call('/api/auth/session', { headers: cookie() });
    expect(res.status).toBe(200);
    const row = sqlite.prepare('SELECT * FROM staff_members WHERE external_id = ?').get('u-1') as Record<string, unknown>;
    expect(row).toMatchObject({ name: '山田 花子', role: 'admin', external_tenant_id: 't-1', access_restricted: 1, is_active: 1 });
    // 友だち一覧は、アカウントを指定しても許可前は 403
    expect((await call('/api/friends?lineAccountId=acc-a', { headers: cookie() })).status).toBe(403);
    // 許可すると、そのアカウントだけ通る
    sqlite.prepare("INSERT INTO staff_account_access(staff_id, line_account_id) VALUES(?, 'acc-a')").run(row.id);
    expect((await call('/api/friends?lineAccountId=acc-a', { headers: cookie() })).status).toBe(200);
    expect((await call('/api/friends?lineAccountId=acc-b', { headers: cookie() })).status).toBe(403);
  });

  test('beyond admin のオーナーは、オーナーとして全アカウントを扱える。役割は次のログインで追従する', async () => {
    const spy = mockAdmin({ ...PROFILE, role: 'owner' });
    const { call, sqlite } = setup();
    expect((await call('/api/friends?lineAccountId=acc-b', { headers: cookie('s1') })).status).toBe(200);
    expect(sqlite.prepare('SELECT role FROM staff_members WHERE external_id = ?').get('u-1')).toEqual({ role: 'owner' });
    spy.mockImplementation((async () => okResponse({ ...PROFILE, role: 'staff' })) as unknown as typeof fetch);
    clearExternalAuthCache();
    await call('/api/friends?lineAccountId=acc-b', { headers: cookie('s2') });
    expect(sqlite.prepare('SELECT role FROM staff_members WHERE external_id = ?').get('u-1')).toEqual({ role: 'staff' });
  });

  test('確認できない・設定が無い・API キーが誤りのときは入れない', async () => {
    mockAdmin({ valid: false });
    const { call } = setup();
    expect((await call('/api/auth/session', { headers: cookie() })).status).toBe(401);
    expect((await call('/api/auth/session')).status).toBe(401);
    mockAdmin();
    expect((await setup({}).call('/api/auth/session', { headers: cookie() })).status).toBe(401);
    // API キーを付けたのに誤っているときは、Cookie があっても通さない
    expect((await call('/api/auth/session', { headers: { ...cookie('sid-2'), Authorization: 'Bearer wrong' } })).status).toBe(401);
  });

  test('beyond admin で無効にされた人は(一覧の同期で)無効になり、確認の結果が古くて「有効」と返っても入れない', async () => {
    mockAdmin();
    const { call, sqlite } = setup();
    await call('/api/auth/session', { headers: cookie() });
    sqlite.prepare('UPDATE staff_members SET is_active = 0 WHERE external_id = ?').run('u-1');
    clearExternalAuthCache();
    expect((await call('/api/auth/session', { headers: cookie() })).status).toBe(401);
  });

  test('Cookie での書き込みは、CSRF の確認が要る(従来の Cookie ログインと同じ)', async () => {
    mockAdmin({ ...PROFILE, role: 'owner' });
    const { call } = setup();
    expect((await call('/api/tags', { method: 'POST', headers: cookie() })).status).toBe(403);
    expect((await call('/api/tags', { method: 'POST', headers: { ...cookie(), Cookie: 'bap_session=sid-ok; lh_csrf=tok', 'X-CSRF-Token': 'tok' } })).status).toBe(200);
  });

  test('ログイン画面用の設定: 有効なときだけ beyond admin の URL を返す(秘密は返さない)', async () => {
    const on = await (await setup().call('/api/auth/config')).json() as { data: { beyondAdmin: { loginUrl: string; logoutUrl: string } | null } };
    expect(on.data.beyondAdmin).toEqual({ loginUrl: 'https://admin.example.test/login', logoutUrl: 'https://admin.example.test/logout' });
    expect(JSON.stringify(on)).not.toContain('internal-secret');
    const off = await (await setup({}).call('/api/auth/config')).json() as { data: { beyondAdmin: unknown } };
    expect(off.data.beyondAdmin).toBeNull();
  });

  test('beyond admin のユーザーは、名前・役割の変更、削除、API キーの再発行ができない(オーナーが操作しても)', async () => {
    mockAdmin();
    const { call, sqlite } = setup();
    await call('/api/auth/session', { headers: cookie() });
    const id = (sqlite.prepare('SELECT id FROM staff_members WHERE external_id = ?').get('u-1') as { id: string }).id;
    sqlite.prepare("INSERT INTO staff_members(id,name,role,api_key) VALUES('own','Owner','owner','owner-key')").run();
    const h = { Authorization: 'Bearer owner-key', 'Content-Type': 'application/json' };
    expect((await call(`/api/staff/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ role: 'owner' }) })).status).toBe(400);
    expect((await call(`/api/staff/${id}`, { method: 'DELETE', headers: h })).status).toBe(400);
    expect((await call(`/api/staff/${id}/regenerate-key`, { method: 'POST', headers: h })).status).toBe(400);
    expect((await call(`/api/staff/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ isActive: false }) })).status).toBe(400);
    const list = await (await call('/api/staff', { headers: h })).json() as { data: Array<{ id: string; external: boolean; apiKey: string | null; accountIds: string[] | null }> };
    expect(list.data.find((s) => s.id === id)).toMatchObject({ external: true, apiKey: null, accountIds: [] });
  });
});

describe('beyond admin のユーザー一覧の同期(スタッフ管理に、まだ一度もログインしていない人も出す)', () => {
  const USERS = {
    ok: true,
    users: [
      { userId: 'u-1', tenantId: 't-1', tenantName: 'エクラブロウ', name: '有坂 将希', email: 'a@example.test', role: 'owner', isActive: true },
      { userId: 'u-2', tenantId: 't-1', tenantName: 'エクラブロウ', name: '山田 花子', email: 'h@example.test', role: 'manager', isActive: true },
      { userId: 'u-3', tenantId: 't-1', tenantName: 'エクラブロウ', name: '退職 太郎', email: 't@example.test', role: 'staff', isActive: false },
      { userId: 'u-9', tenantId: 't-2', tenantName: '別会社', name: '別会社の人', email: 'x@example.test', role: 'staff', isActive: true },
    ],
  };
  function db() {
    const { db: d, sqlite } = sqliteD1();
    sqlite.exec(schema);
    return { d, sqlite };
  }
  const f = (body: unknown, status = 200) => vi.fn(async () => okResponse(body, status)) as unknown as typeof fetch;

  test('一覧にいる全員がスタッフに入る(ログイン前でも)。見られるアカウントは空から。無効の人は無効', async () => {
    const { d, sqlite } = db();
    const fetchSpy = f(USERS);
    expect(await syncExternalUsers(d, ENV, fetchSpy)).toEqual({ synced: 4, deactivated: 0 });
    const [url, init] = (fetchSpy as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0];
    expect(url).toBe('https://admin.example.test/api/internal/line/users');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer internal-secret');
    const rows = sqlite.prepare('SELECT external_id, role, is_active, access_restricted FROM staff_members ORDER BY external_id').all();
    expect(rows).toEqual([
      { external_id: 'u-1', role: 'owner', is_active: 1, access_restricted: 1 },
      { external_id: 'u-2', role: 'admin', is_active: 1, access_restricted: 1 },
      { external_id: 'u-3', role: 'staff', is_active: 0, access_restricted: 1 },
      { external_id: 'u-9', role: 'staff', is_active: 1, access_restricted: 1 },
    ]);
  });

  test('beyond admin から居なくなった人は無効になる。見られるアカウントの設定は同期で消えない', async () => {
    const { d, sqlite } = db();
    sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('acc-a','ch-a','A店','s','t')");
    await syncExternalUsers(d, ENV, f(USERS));
    const id = (sqlite.prepare("SELECT id FROM staff_members WHERE external_id='u-2'").get() as { id: string }).id;
    sqlite.prepare("INSERT INTO staff_account_access(staff_id, line_account_id) VALUES(?, 'acc-a')").run(id);
    const r = await syncExternalUsers(d, ENV, f({ ok: true, users: USERS.users.filter((u) => u.userId !== 'u-2' && u.userId !== 'u-3') }));
    expect(r).toEqual({ synced: 2, deactivated: 1 });
    expect(sqlite.prepare("SELECT is_active FROM staff_members WHERE external_id='u-2'").get()).toEqual({ is_active: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) c FROM staff_account_access').get()).toEqual({ c: 1 });
  });

  test('入れてよい会社を指定したときは、それ以外の会社の人は入れない', async () => {
    const { d, sqlite } = db();
    await syncExternalUsers(d, { ...ENV, BEYOND_ADMIN_ALLOWED_TENANT_IDS: 't-1' }, f(USERS));
    expect(sqlite.prepare("SELECT COUNT(*) c FROM staff_members WHERE external_id = 'u-9'").get()).toEqual({ c: 0 });
  });

  test('取れなかったとき(通信失敗・拒否・形が崩れた応答・設定なし)は、何も変えない', async () => {
    const { d, sqlite } = db();
    await syncExternalUsers(d, ENV, f(USERS));
    const before = sqlite.prepare('SELECT COUNT(*) c FROM staff_members WHERE is_active = 1').get();
    expect(await syncExternalUsers(d, ENV, f({ error: 'unauthorized' }, 401))).toBeNull();
    expect(await syncExternalUsers(d, ENV, f({ ok: true }))).toBeNull();
    expect(await syncExternalUsers(d, ENV, (async () => { throw new Error('net'); }) as unknown as typeof fetch)).toBeNull();
    expect(await syncExternalUsers(d, {}, f(USERS))).toBeNull();
    expect(sqlite.prepare('SELECT COUNT(*) c FROM staff_members WHERE is_active = 1').get()).toEqual(before);
  });

  test('スタッフ管理の一覧を開くと、同期されて、全員が出る(API キーの人も残る)', async () => {
    const { d, sqlite } = db();
    sqlite.prepare("INSERT INTO staff_members(id,name,role,api_key) VALUES('own','Owner','owner','owner-key')").run();
    const app = new Hono<Env>();
    app.use('*', authMiddleware);
    app.route('/', staffRoutes);
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () => okResponse(USERS)) as unknown as typeof fetch);
    const res = await app.request('/api/staff', { headers: { Authorization: 'Bearer owner-key' } }, { DB: d, API_KEY: 'env-key', ...ENV } as unknown as Env['Bindings']);
    const list = (await res.json() as { data: Array<{ name: string; external: boolean; isActive: boolean }> }).data;
    expect(list.filter((s) => s.external).map((s) => s.name).sort()).toEqual(['別会社の人', '山田 花子', '有坂 将希', '退職 太郎'].sort());
    expect(list.find((s) => s.name === 'Owner')).toMatchObject({ external: false });
    expect(list.find((s) => s.name === '退職 太郎')).toMatchObject({ isActive: false });
  });
});
