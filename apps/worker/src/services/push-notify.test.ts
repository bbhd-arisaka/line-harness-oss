import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { describeMessageForPush, notifyIncomingMessage, resolvePushRecipients } from './push-notify.js';
import { resetApnsJwtCache } from './apns.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

async function env() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = Buffer.from((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer).toString('base64');
  return { APNS_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`, APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T' };
}

const FUTURE = '2099-01-01T00:00:00.000+09:00';
const PAST = '2000-01-01T00:00:00.000+09:00';
type Init = RequestInit & { headers: Record<string, string> };

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('A','ca','A','t','s'),('B','cb','B','t','s')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,real_name,system_display_name) VALUES('fr1','u1','A','taro','山田太郎','タロ')`);
  sqlite.exec(`INSERT INTO chats(id,friend_id) VALUES('chat1','fr1')`);
  const staff = (id: string, role: string, active = 1, restricted = 0) =>
    sqlite.prepare('INSERT INTO staff_members(id,name,role,api_key,is_active,access_restricted) VALUES(?,?,?,?,?,?)').run(id, id, role, `key-${id}`, active, restricted);
  let n = 0;
  const session = (staffId: string, token: string | null, opts: { expires?: string; revoked?: string | null } = {}) => {
    sqlite
      .prepare('INSERT INTO app_sessions(id,staff_id,token_hash,apns_token,expires_at,revoked_at) VALUES(?,?,?,?,?,?)')
      .run(`s${String(n).padStart(3, '0')}`, staffId, `h${n}`, token, opts.expires ?? FUTURE, opts.revoked ?? null);
    n++;
  };
  const allow = (staffId: string, accountId: string) => sqlite.prepare('INSERT INTO staff_account_access(staff_id,line_account_id) VALUES(?,?)').run(staffId, accountId);
  return { db, sqlite, staff, session, allow };
}

beforeEach(() => { resetApnsJwtCache(); vi.restoreAllMocks(); });

describe('describeMessageForPush', () => {
  it('テキストは80文字まで、他は種類の表示', () => {
    expect(describeMessageForPush('text', 'あ'.repeat(100))).toBe(`${'あ'.repeat(80)}…`);
    expect(describeMessageForPush('text', ' a\n b ')).toBe('a b');
    expect(describeMessageForPush('image', '{}')).toBe('[画像]');
    expect(describeMessageForPush('sticker', '{}')).toBe('[スタンプ]');
    expect(describeMessageForPush('video', '')).toBe('[動画]');
    expect(describeMessageForPush('audio', '')).toBe('[音声]');
  });
});

describe('resolvePushRecipients(宛先の絞り込み)', () => {
  it('オーナー・制限なし・許可アカウントだけが対象。[]・停止中・取り消し済み・期限切れ・トークン無しは除く', async () => {
    const { db, staff, session, allow } = setup();
    staff('owner', 'owner'); session('owner', 'T-owner');
    staff('free', 'staff'); session('free', 'T-free');
    staff('allowedA', 'staff'); allow('allowedA', 'A'); session('allowedA', 'T-allowedA');
    staff('onlyB', 'staff'); allow('onlyB', 'B'); session('onlyB', 'T-onlyB');
    staff('empty', 'staff', 1, 1); session('empty', 'T-empty');
    staff('inactive', 'owner', 0); session('inactive', 'T-inactive');
    staff('revoked', 'owner'); session('revoked', 'T-revoked', { revoked: '2024-01-01T00:00:00.000+09:00' });
    staff('expired', 'owner'); session('expired', 'T-expired', { expires: PAST });
    staff('notoken', 'owner'); session('notoken', null);
    const tokens = await resolvePushRecipients(db, 'A');
    expect([...tokens].sort()).toEqual(['T-allowedA', 'T-free', 'T-owner']);
  });
  it('端末ごとに、止めている公式アカウントの通知は送らない', async () => {
    const { db, sqlite, staff, session } = setup();
    staff('o', 'owner');
    session('o', 'DEV-all');
    session('o', 'DEV-mutedA');
    session('o', 'DEV-mutedB');
    sqlite.prepare("UPDATE app_sessions SET muted_account_ids = '[\"A\"]' WHERE apns_token = 'DEV-mutedA'").run();
    sqlite.prepare("UPDATE app_sessions SET muted_account_ids = '[\"B\"]' WHERE apns_token = 'DEV-mutedB'").run();
    expect([...(await resolvePushRecipients(db, 'A'))].sort()).toEqual(['DEV-all', 'DEV-mutedB']);
    expect([...(await resolvePushRecipients(db, 'B'))].sort()).toEqual(['DEV-all', 'DEV-mutedA']);
  });
  it('同じ端末は1回だけ(複数セッション・複数スタッフでも)', async () => {
    const { db, staff, session } = setup();
    staff('o1', 'owner'); staff('o2', 'owner');
    session('o1', 'SAME'); session('o1', 'SAME'); session('o2', 'SAME'); session('o2', 'OTHER');
    expect([...(await resolvePushRecipients(db, 'A'))].sort()).toEqual(['OTHER', 'SAME']);
  });
  it('1回の通知で送る端末は50まで', async () => {
    const { db, staff, session } = setup();
    staff('o', 'owner');
    for (let i = 0; i < 60; i++) session('o', `T${i}`);
    expect(await resolvePushRecipients(db, 'A')).toHaveLength(50);
  });
});

describe('notifyIncomingMessage', () => {
  it('APNs の設定が無ければ、fetch も DB も触らない', async () => {
    const { db } = setup();
    const prepare = vi.spyOn(db, 'prepare');
    const fetchImpl = vi.fn();
    await notifyIncomingMessage({}, db, { friendId: 'fr1', accountId: 'A', messageType: 'text', content: 'hi' }, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
  it('友だちの表示名(本名優先)・本文・chatId を付けて、宛先の端末に送る', async () => {
    const { db, staff, session } = setup();
    staff('o', 'owner'); session('o', 'DEV1');
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await notifyIncomingMessage(await env(), db, { friendId: 'fr1', accountId: 'A', messageType: 'image', content: '{}' }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, Init];
    expect(url).toBe('https://api.push.apple.com/3/device/DEV1');
    expect(init.headers['apns-collapse-id']).toBe('chat1');
    expect(JSON.parse(init.body as string)).toMatchObject({
      aps: { alert: { title: '山田太郎', subtitle: 'A', body: '[画像]' }, 'thread-id': 'fr1' },
      chatId: 'chat1',
      accountId: 'A',
    });
  });
  it('410 が返った端末のトークンは DB から消える。他の端末は残る', async () => {
    const { db, sqlite, staff, session } = setup();
    staff('o', 'owner'); session('o', 'BAD'); session('o', 'GOOD');
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => new Response(null, { status: url.endsWith('/BAD') ? 410 : 200 }));
    await notifyIncomingMessage(await env(), db, { friendId: 'fr1', accountId: 'A', messageType: 'text', content: 'x' }, { fetchImpl });
    expect(sqlite.prepare('SELECT apns_token FROM app_sessions ORDER BY id').all()).toEqual([{ apns_token: null }, { apns_token: 'GOOD' }]);
  });
  it('宛先が居なければ送らない。送信が失敗しても例外を投げない', async () => {
    const { db, staff, session } = setup();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await notifyIncomingMessage(await env(), db, { friendId: 'fr1', accountId: 'A', messageType: 'text', content: 'x' }, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    staff('o', 'owner'); session('o', 'D');
    await expect(notifyIncomingMessage(await env(), db, { friendId: 'fr1', accountId: 'A', messageType: 'text', content: 'x' }, { fetchImpl })).resolves.toBeUndefined();
    err.mockRestore();
  });
});
