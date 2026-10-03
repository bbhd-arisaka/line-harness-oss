import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { authMiddleware } from '../middleware/auth.js';
import { accountAccessGuard } from '../middleware/account-access.js';
import { staff as staffRoutes } from './staff.js';
import { appAuth } from './app-auth.js';
import { clearExternalAuthCache } from '../services/external-auth.js';
import type { Env } from '../index.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const ENV = { BEYOND_ADMIN_URL: 'https://admin.example.test', BEYOND_ADMIN_INTERNAL_TOKEN: 'internal-secret' };
const VERIFIED = { ok: true, userId: 'u-1', tenantId: 't-1', name: '山田 花子', email: 'hanako@example.test', role: 'manager' };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const mockVerify = (res: () => Response | Promise<Response>) => vi.spyOn(globalThis, 'fetch').mockImplementation((async () => res()) as unknown as typeof fetch);

function setup(envOverride: Record<string, string | undefined> = ENV) {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('acc-a','ch-a','A店','s','t')`);
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.use('*', accountAccessGuard);
  app.route('/', appAuth);
  app.route('/', staffRoutes);
  app.get('/api/friends', (c) => c.json({ success: true }));
  const bindings = { DB: db, API_KEY: 'env-key', WORKER_URL: 'https://w.example.test', ...envOverride } as unknown as Env['Bindings'];
  const call = (path: string, init: RequestInit = {}) => app.request(path, init, bindings);
  const login = (body: Record<string, unknown> = { email: 'Hanako@Example.test', password: 'pw', deviceName: 'iPhone' }) =>
    call('/api/app/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { sqlite, call, login };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const tokenOf = async (res: Response) => ((await res.json()) as { data: { token: string } }).data.token;

beforeEach(() => { clearExternalAuthCache(); vi.restoreAllMocks(); });

describe('POST /api/app/login(iOSアプリのログイン)', () => {
  test('beyond admin のメール・パスワードで入れて、トークンで API を使える(見られるアカウントは許可するまで空)', async () => {
    const spy = mockVerify(() => json(VERIFIED));
    const { call, login, sqlite } = setup();
    const res = await login();
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: { token: string; expiresAt: string; staff: { name: string; role: string } } }).data;
    expect(data.token).toMatch(/^lhapp_[0-9a-f]{64}$/);
    expect(data.staff).toMatchObject({ name: '山田 花子', role: 'admin' });
    // メールは小文字にして、beyond admin に渡す。パスワードはこちらに保存しない
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://admin.example.test/api/internal/auth/verify');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'hanako@example.test', password: 'pw' });
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM app_sessions').all())).not.toContain(data.token);
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM staff_members').all())).not.toContain('"pw"');
    // トークンで入れる。許可前は友だち一覧が 403、許可すると通る
    expect((await call('/api/staff/me', { headers: auth(data.token) })).status).toBe(200);
    expect((await call('/api/friends?lineAccountId=acc-a', { headers: auth(data.token) })).status).toBe(403);
    const id = (sqlite.prepare("SELECT id FROM staff_members WHERE external_id='u-1'").get() as { id: string }).id;
    sqlite.prepare("INSERT INTO staff_account_access(staff_id, line_account_id) VALUES(?, 'acc-a')").run(id);
    expect((await call('/api/friends?lineAccountId=acc-a', { headers: auth(data.token) })).status).toBe(200);
  });

  test('パスワード違いは 401(失敗を数え、続くと 429 で止める)。成功すると数え直す', async () => {
    mockVerify(() => json({ ok: false, reason: 'メールアドレスまたはパスワードが違います' }, 401));
    const { login } = setup();
    for (let i = 0; i < 8; i++) expect((await login()).status).toBe(401);
    expect((await login()).status).toBe(429);
    // 別のメールアドレスは巻き込まない
    expect((await login({ email: 'other@example.test', password: 'x' })).status).toBe(401);
  });

  test('契約が無い・支払い停止(403)は理由を見せる。合言葉の誤り・接続失敗は、利用者に詳細を見せない(401 にしない)', async () => {
    const { login } = setup();
    mockVerify(() => json({ ok: false, reason: 'お支払いが確認できないため、利用が停止されています' }, 403));
    const a = await login();
    expect(a.status).toBe(403);
    expect(((await a.json()) as { error: string }).error).toContain('お支払い');
    mockVerify(() => json({ ok: false, reason: 'unauthorized' }, 401));
    const b = await login();
    expect(b.status).toBe(502);
    expect(JSON.stringify(await b.json())).not.toContain('unauthorized');
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () => { throw new Error('network'); }) as unknown as typeof fetch);
    expect((await login()).status).toBe(502);
  });

  test('連携が無効、入力が不正、こちらで停止中のスタッフは入れない', async () => {
    mockVerify(() => json(VERIFIED));
    expect((await setup({}).login()).status).toBe(503);
    const { login, sqlite } = setup();
    expect((await login({ email: '', password: 'x' })).status).toBe(400);
    expect((await login({ email: 'a@b.test' })).status).toBe(400);
    await login();
    sqlite.prepare("UPDATE staff_members SET is_active = 0 WHERE external_id = 'u-1'").run();
    expect((await login()).status).toBe(403);
  });
});

describe('アプリのトークンの扱い', () => {
  test('ログアウトすると、その端末のトークンは使えなくなる(他の端末は影響なし)', async () => {
    mockVerify(() => json(VERIFIED));
    const { call, login } = setup();
    const t1 = await tokenOf(await login());
    const t2 = await tokenOf(await login());
    expect((await call('/api/app/logout', { method: 'POST', headers: auth(t1) })).status).toBe(200);
    expect((await call('/api/staff/me', { headers: auth(t1) })).status).toBe(401);
    expect((await call('/api/staff/me', { headers: auth(t2) })).status).toBe(200);
  });

  test('スタッフが無効になる・期限切れ・でたらめなトークンは使えない。Cookie では受け付けない', async () => {
    mockVerify(() => json(VERIFIED));
    const { call, login, sqlite } = setup();
    const t = await tokenOf(await login());
    expect((await call('/api/staff/me', { headers: auth('lhapp_' + '0'.repeat(64)) })).status).toBe(401);
    expect((await call('/api/staff/me', { headers: { Cookie: `lh_admin_session=${t}` } })).status).toBe(401);
    sqlite.prepare("UPDATE app_sessions SET expires_at = '2000-01-01T00:00:00.000+09:00'").run();
    expect((await call('/api/staff/me', { headers: auth(t) })).status).toBe(401);
    sqlite.prepare("UPDATE app_sessions SET expires_at = '2999-01-01T00:00:00.000+09:00'").run();
    expect((await call('/api/staff/me', { headers: auth(t) })).status).toBe(200);
    sqlite.prepare("UPDATE staff_members SET is_active = 0 WHERE external_id = 'u-1'").run();
    expect((await call('/api/staff/me', { headers: auth(t) })).status).toBe(401);
  });

  test('プッシュ通知の送り先(APNs トークン)を登録できる。形が違うものは拒否', async () => {
    mockVerify(() => json(VERIFIED));
    const { call, login, sqlite } = setup();
    const t = await tokenOf(await login());
    const put = (body: unknown) => call('/api/app/device', { method: 'PUT', headers: { ...auth(t), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await put({ apnsToken: 'abc' })).status).toBe(400);
    expect((await put({ apnsToken: 'a'.repeat(64) })).status).toBe(200);
    expect(sqlite.prepare('SELECT apns_token FROM app_sessions').get()).toEqual({ apns_token: 'a'.repeat(64) });
    expect((await put({ apnsToken: null })).status).toBe(200);
    expect(sqlite.prepare('SELECT apns_token FROM app_sessions').get()).toEqual({ apns_token: null });
    // アプリのログインでない呼び出し(API キー)は、端末登録できない
    expect((await call('/api/app/device', { method: 'PUT', headers: { Authorization: 'Bearer env-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ apnsToken: 'a'.repeat(64) }) })).status).toBe(400);
  });
});
