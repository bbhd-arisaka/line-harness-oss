import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { buildApnsPayload, clearInvalidApnsToken, createApnsJwt, getApnsConfig, resetApnsJwtCache, sendApnsAlert } from './apns.js';
import type { ApnsConfig } from './apns.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

async function makeKey() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}
const b64urlToBytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

let config: ApnsConfig;
let publicKey: CryptoKey;
beforeEach(async () => {
  resetApnsJwtCache();
  const k = await makeKey();
  publicKey = k.publicKey;
  config = { keyP8: k.pem, keyId: 'KEY1234567', teamId: 'TEAM123456', bundleId: 'jp.cms-manager.beyondline', environment: 'production' };
});

const alert = { title: '山田', body: 'こんにちは', threadId: 'friend-1', collapseId: 'chat-1', data: { chatId: 'chat-1', accountId: 'acc-1' } };
type Init = RequestInit & { headers: Record<string, string> };

describe('getApnsConfig', () => {
  it('鍵・キーID・チームIDがそろわなければ無効(null)', () => {
    expect(getApnsConfig({})).toBeNull();
    expect(getApnsConfig({ APNS_KEY_P8: 'x', APNS_KEY_ID: 'k' })).toBeNull();
  });
  it('そろえば有効。既定は本番・既定の Bundle ID', () => {
    expect(getApnsConfig({ APNS_KEY_P8: 'x', APNS_KEY_ID: 'k', APNS_TEAM_ID: 't' })).toMatchObject({ bundleId: 'jp.cms-manager.beyondline', environment: 'production' });
    expect(getApnsConfig({ APNS_KEY_P8: 'x', APNS_KEY_ID: 'k', APNS_TEAM_ID: 't', APNS_ENVIRONMENT: 'sandbox', APNS_BUNDLE_ID: 'b' })).toMatchObject({ bundleId: 'b', environment: 'sandbox' });
  });
});

describe('JWT', () => {
  it('ES256 のヘッダ・クレームで、公開鍵で署名を検証できる(P1363形式)', async () => {
    const jwt = await createApnsJwt(config, 1_700_000_000_000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1_700_000_000 });
    const sig = b64urlToBytes(s);
    expect(sig.length).toBe(64);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sig, new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });
  it('改行が文字の「\\n」になっている環境変数でも読める', async () => {
    const jwt = await createApnsJwt({ ...config, keyP8: config.keyP8.replace(/\n/g, '\\n') }, 0);
    expect(jwt.split('.')).toHaveLength(3);
  });
  it('50分は同じ JWT を使い回し、過ぎたら作り直す', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const jwts: string[] = [];
    for (const t of [0, 49 * 60_000, 51 * 60_000]) {
      await sendApnsAlert(config, 'tok', alert, { fetchImpl, now: () => t });
      jwts.push((fetchImpl.mock.calls.at(-1)![1] as Init).headers.authorization);
    }
    expect(jwts[0]).toBe(jwts[1]);
    expect(jwts[2]).not.toBe(jwts[0]);
  });
});

describe('sendApnsAlert', () => {
  it('URL・ヘッダ・本文が仕様どおり', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const r = await sendApnsAlert(config, 'abcd1234', alert, { fetchImpl, now: () => 1_700_000_000_000 });
    expect(r).toEqual({ ok: true, status: 200, invalidToken: false });
    const [url, init] = fetchImpl.mock.calls[0] as [string, Init];
    expect(url).toBe('https://api.push.apple.com/3/device/abcd1234');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'apns-topic': 'jp.cms-manager.beyondline',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(1_700_000_000 + 3600),
      'apns-collapse-id': 'chat-1',
    });
    expect(init.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(init.body as string)).toEqual({
      aps: { alert: { title: '山田', body: 'こんにちは' }, sound: 'default', 'thread-id': 'friend-1' },
      chatId: 'chat-1',
      accountId: 'acc-1',
      body: expect.anything(),
    });
  });
  it('sandbox は sandbox のホストへ送る', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await sendApnsAlert({ ...config, environment: 'sandbox' }, 't', alert, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.sandbox.push.apple.com/3/device/t');
  });
  it('410 / BadDeviceToken / Unregistered はトークン無効', async () => {
    for (const [status, reason] of [[410, 'Unregistered'], [400, 'BadDeviceToken'], [400, 'Unregistered']] as const) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ reason }), { status }));
      expect(await sendApnsAlert(config, 't', alert, { fetchImpl })).toMatchObject({ ok: false, invalidToken: true });
    }
    const gone = vi.fn().mockResolvedValue(new Response(null, { status: 410 }));
    expect((await sendApnsAlert(config, 't', alert, { fetchImpl: gone })).invalidToken).toBe(true);
  });
  it('429 / 5xx / 通信エラーは無効扱いにせず、再試行もせず、例外も投げない。秘密はログに出ない', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f429 = vi.fn().mockResolvedValue(new Response(JSON.stringify({ reason: 'TooManyRequests' }), { status: 429 }));
    expect(await sendApnsAlert(config, 't', alert, { fetchImpl: f429 })).toMatchObject({ ok: false, status: 429, invalidToken: false });
    expect(f429).toHaveBeenCalledTimes(1);
    const f500 = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    expect(await sendApnsAlert(config, 't', alert, { fetchImpl: f500 })).toMatchObject({ ok: false, status: 503, invalidToken: false });
    const boom = vi.fn().mockRejectedValue(new Error(`secret ${config.keyP8}`));
    expect(await sendApnsAlert(config, 't', alert, { fetchImpl: boom })).toMatchObject({ ok: false, status: 0, invalidToken: false });
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).not.toContain('PRIVATE KEY');
    expect(logged).not.toMatch(/bearer/i);
    err.mockRestore();
  });
  it('鍵が壊れていても例外を投げず、fetch もしない', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn();
    const r = await sendApnsAlert({ ...config, keyP8: 'not a key' }, 't', alert, { fetchImpl });
    expect(r).toMatchObject({ ok: false, reason: 'jwt_error' });
    expect(fetchImpl).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('buildApnsPayload', () => {
  it('4KB を超える本文は切って収める', () => {
    const json = buildApnsPayload({ ...alert, body: 'あ'.repeat(5000) });
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(4096);
    expect(JSON.parse(json).aps.alert.body.length).toBeGreaterThan(100);
  });
});

describe('clearInvalidApnsToken', () => {
  it('同じトークンのセッションの apns_token を NULL にする', async () => {
    const { db, sqlite } = sqliteD1();
    sqlite.exec(schema);
    sqlite.exec("INSERT INTO staff_members(id,name,role,api_key) VALUES('s1','a','staff','k1')");
    sqlite.exec("INSERT INTO app_sessions(id,staff_id,token_hash,apns_token,expires_at) VALUES('x1','s1','h1','T1','2099-01-01'),('x2','s1','h2','T2','2099-01-01')");
    await clearInvalidApnsToken(db, 'T1');
    expect(sqlite.prepare('SELECT id, apns_token FROM app_sessions ORDER BY id').all()).toEqual([{ id: 'x1', apns_token: null }, { id: 'x2', apns_token: 'T2' }]);
  });
});
