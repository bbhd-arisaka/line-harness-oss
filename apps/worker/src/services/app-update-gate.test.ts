import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  APP_FORCE_UPDATE_RULE,
  compareVersions,
  evaluateUpdateGate,
  getStoreVersion,
  isBehind,
  parseVersion,
  readClientInfo,
  resetStoreVersionCache,
} from './app-update-gate.js';

vi.mock('@line-crm/db', () => ({
  // アプリ用トークンは、どれも「見つからない」(止まらなかったときに 401 になる)
  getStaffByAppToken: vi.fn(async () => null),
  getStaffByApiKey: vi.fn(async () => null),
}));
import { authMiddleware } from '../middleware/auth.js';
import { appAuth } from '../routes/app-auth.js';

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
const storeJson = (version: string | null) =>
  ({ ok: true, json: async () => ({ results: version ? [{ version }] : [] }) }) as unknown as Response;

beforeEach(() => resetStoreVersionCache());
afterEach(() => vi.restoreAllMocks());

// 強制アップデート(2026-10-15): 古いアプリは使えなくして、App Store の最新版への更新を案内する。
// ただし、App Store に必要な版がまだ並んでいないときは止めない(更新先が無いのに止めると、誰も使えなくなる)
describe('版の比較', () => {
  it('1.1.2 と 1.1.10 を、数字として比べる', () => {
    expect(parseVersion('1.1.2')).toEqual([1, 1, 2]);
    expect(parseVersion('1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('abc')).toBeNull();
    expect(compareVersions('1.1.2', '1.1.10')).toBeLessThan(0);
    expect(compareVersions('1.1.10', '1.1.2')).toBeGreaterThan(0);
    expect(compareVersions('1.1.2', '1.1.2')).toBe(0);
    expect(compareVersions('x', '1.1.2')).toBeNull();
  });
});

describe('アプリの版の読み取り', () => {
  it('X-App-Version があれば、それを使う。無ければ User-Agent のビルド番号', () => {
    expect(readClientInfo(h({ 'x-app-version': '1.1.2' }))).toEqual({ version: '1.1.2', build: null });
    expect(readClientInfo(h({ 'user-agent': 'beyondline/12 CFNetwork/1494.0.7 Darwin/23.4.0' }))).toEqual({ version: null, build: 12 });
    expect(readClientInfo(h({ 'x-app-version': '1.1.3', 'x-app-build': '14' }))).toEqual({ version: '1.1.3', build: 14 });
    expect(readClientInfo(h({ 'user-agent': 'Mozilla/5.0' }))).toEqual({ version: null, build: null });
    expect(readClientInfo(h({ 'x-app-version': 'おかしい' })).version).toBeNull();
  });
  it('古いか: 版が分かれば版で、無ければビルド番号で。どちらも分からなければ止めない', () => {
    expect(isBehind({ version: '1.1.1', build: null })).toBe(true);
    expect(isBehind({ version: '1.1.2', build: null })).toBe(false);
    expect(isBehind({ version: null, build: APP_FORCE_UPDATE_RULE.minBuild - 1 })).toBe(true);
    expect(isBehind({ version: null, build: APP_FORCE_UPDATE_RULE.minBuild })).toBe(false);
    expect(isBehind({ version: null, build: null })).toBeNull();
  });
});

describe('App Store の最新版の確認', () => {
  it('Apple の公開API から版を読み、少しの間は覚えておく(毎回聞かない)', async () => {
    const f = vi.fn(async () => storeJson('1.1.2'));
    expect(await getStoreVersion(f as never, 1_000)).toBe('1.1.2');
    expect(await getStoreVersion(f as never, 2_000)).toBe('1.1.2');
    expect(f).toHaveBeenCalledTimes(3); // 1回の確認=3通り。2回目は覚えている結果を使う
  });
  it('Apple の配信網の古い答えに当たらないよう、鍵の違う3通りで聞き、いちばん新しい版を採る', async () => {
    const f = vi.fn(async (url: string) => storeJson(url.includes('&t=') ? '1.1.2' : '1.1.0'));
    expect(await getStoreVersion(f as never, 5_000_000)).toBe('1.1.2');
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls.map((c) => c[0]).some((u) => u.includes('country=jp&t=8'))).toBe(true);
  });
  it('1つが失敗しても、取れた分から版を決める', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes('&t=')) throw new Error('timeout');
      return storeJson('1.1.2');
    });
    expect(await getStoreVersion(f as never, 5_000_000)).toBe('1.1.2');
  });
  it('通信に失敗・結果が空のときは null(止めない側に倒す)。失敗は短い時間で取り直す', async () => {
    const bad = vi.fn(async () => { throw new Error('down'); });
    expect(await getStoreVersion(bad as never, 1_000)).toBeNull();
    resetStoreVersionCache();
    expect(await getStoreVersion((async () => storeJson(null)) as never, 1_000)).toBeNull();
  });
});

describe('止めるかどうか', () => {
  const old = h({ 'user-agent': 'beyondline/12 CFNetwork/1494.0.7' });
  it('古いアプリでも、App Store に必要な版(1.1.2)がまだ無ければ止めない', async () => {
    expect((await evaluateUpdateGate(old, { fetchImpl: (async () => storeJson('1.1.0')) as never })).required).toBe(false);
  });
  it('古いアプリは、App Store に 1.1.2 以上が並んだら止める', async () => {
    expect((await evaluateUpdateGate(old, { fetchImpl: (async () => storeJson('1.1.2')) as never })).required).toBe(true);
    resetStoreVersionCache();
    expect((await evaluateUpdateGate(old, { fetchImpl: (async () => storeJson('1.2.0')) as never })).required).toBe(true);
  });
  it('新しいアプリ・分からないクライアントは、止めない(Apple にも聞かない)', async () => {
    const f = vi.fn(async () => storeJson('9.9.9'));
    expect((await evaluateUpdateGate(h({ 'x-app-version': '1.1.2' }), { fetchImpl: f as never })).required).toBe(false);
    expect((await evaluateUpdateGate(h({ 'user-agent': 'Expo/1' }), { fetchImpl: f as never })).required).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('App Store を確認できないときは止めない', async () => {
    expect((await evaluateUpdateGate(old, { fetchImpl: (async () => { throw new Error('x'); }) as never })).required).toBe(false);
  });
});

describe('入口(認証の前)での強制', () => {
  function app() {
    const a = new Hono();
    a.use('/api/*', authMiddleware as never);
    a.route('/', appAuth as never);
    a.get('/api/chats', (c) => c.json({ ok: true }));
    return a;
  }
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }) }) } };
  const store = (v: string) => vi.spyOn(globalThis, 'fetch').mockImplementation((async () => storeJson(v)) as never);

  it('古いアプリのトークン付きの通信は、426 と日本語の案内(古いアプリは、これをそのまま画面に出す)', async () => {
    store('1.1.2');
    const res = await app().request('/api/chats', { headers: { Authorization: 'Bearer lhapp_abc', 'User-Agent': 'beyondline/9 CFNetwork/1' } }, env as never);
    expect(res.status).toBe(426);
    const body = (await res.json()) as { error: string; code: string; storeUrl: string };
    expect(body.error).toContain('App Store');
    expect(body.code).toBe('app_update_required');
    expect(body.storeUrl).toContain('apps.apple.com');
  });
  it('古いアプリのログインも止める', async () => {
    store('1.1.2');
    const res = await app().request('/api/app/login', { method: 'POST', headers: { 'User-Agent': 'beyondline/9 CFNetwork/1', 'Content-Type': 'application/json' }, body: '{}' }, env as never);
    expect(res.status).toBe(426);
  });
  it('新しいアプリ(版の印あり)は止まらない(その先の認証で、普通に 401)', async () => {
    store('1.1.2');
    const res = await app().request('/api/chats', { headers: { Authorization: 'Bearer lhapp_abc', 'X-App-Version': '1.1.2' } }, env as never);
    expect(res.status).toBe(401);
  });
  it('App Store に新しい版が無いあいだは、古いアプリも止めない', async () => {
    store('1.1.0');
    const res = await app().request('/api/chats', { headers: { Authorization: 'Bearer lhapp_abc', 'User-Agent': 'beyondline/9 CFNetwork/1' } }, env as never);
    expect(res.status).toBe(401);
  });
  it('起動時の確認(/api/app/config)は、ログイン前でも答える。古いなら updateRequired=true', async () => {
    store('1.1.2');
    const res = await app().request('/api/app/config', { headers: { 'User-Agent': 'beyondline/9 CFNetwork/1' } }, env as never);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { updateRequired: boolean } }).data.updateRequired).toBe(true);
    const ok = await app().request('/api/app/config', { headers: { 'X-App-Version': '1.1.2' } }, env as never);
    expect(((await ok.json()) as { data: { updateRequired: boolean } }).data.updateRequired).toBe(false);
  });
  it('ブラウザ(Web 管理画面)など、アプリ以外は対象外', async () => {
    store('1.1.2');
    const res = await app().request('/api/chats', { headers: { Authorization: 'Bearer some-api-key', 'User-Agent': 'Mozilla/5.0' } }, env as never);
    expect(res.status).toBe(401);
  });
});
