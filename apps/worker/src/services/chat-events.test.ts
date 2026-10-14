import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db');
  return {
    ...actual,
    getStaffByApiKey: vi.fn(async (_db: unknown, token: string) => (token === 'staff-key' ? { id: 's1', name: '店長', role: 'staff' } : null)),
    getStaffAllowedAccountIds: vi.fn(async () => ['A']),
  };
});

import { ALLOWED_ACCOUNTS_HEADER, decodeAllowed, encodeAllowed, shouldDeliver } from '../durable-objects/chat-events.js';
import { publishChatEvent, publishChatEventInBackground } from './chat-events.js';
import { handleChatEventsUpgrade, isChatEventsUpgrade } from './chat-events-socket.js';

const req = (headers: Record<string, string> = {}, path = '/api/chat-events') =>
  new Request(`https://api.example.com${path}`, { headers: { Upgrade: 'websocket', ...headers } });

describe('合図を送る相手(shouldDeliver)', () => {
  it('制限なし(null)は全部。制限のあるスタッフには、見てよい公式アカウントの分だけ。分からない合図は送らない', () => {
    expect(shouldDeliver(null, 'A')).toBe(true);
    expect(shouldDeliver(null, null)).toBe(true);
    expect(shouldDeliver(['A'], 'A')).toBe(true);
    expect(shouldDeliver(['A'], 'B')).toBe(false);
    expect(shouldDeliver(['A'], null)).toBe(false);
    expect(shouldDeliver([], 'A')).toBe(false);
  });
  it('ヘッダーの受け渡し: all=制限なし。読めない値は何も見せない側に倒す', () => {
    expect(decodeAllowed(encodeAllowed(null))).toBeNull();
    expect(decodeAllowed(encodeAllowed(['A', 'B']))).toEqual(['A', 'B']);
    expect(decodeAllowed(null)).toBeNull();
    expect(decodeAllowed('{broken')).toEqual([]);
  });
});

describe('publishChatEvent', () => {
  it('バインディングが無い環境では何もしない(例外も出さない)', async () => {
    await expect(publishChatEvent({}, { kind: 'message', friendId: 'f', accountId: 'A' })).resolves.toBeUndefined();
  });
  it('DO に、種類・友だちID・公式アカウントID・時刻だけを渡す(本文・名前は含めない)', async () => {
    const publish = vi.fn(async () => 1);
    const env = { CHAT_EVENTS: { idFromName: vi.fn(() => 'id'), get: vi.fn(() => ({ publish })) } } as never;
    await publishChatEvent(env, { kind: 'message', friendId: 'f1', accountId: 'A' }, () => new Date('2026-10-14T10:00:00Z'));
    expect(publish).toHaveBeenCalledWith({ kind: 'message', friendId: 'f1', accountId: 'A', at: '2026-10-14T10:00:00.000Z' });
  });
  it('DO が失敗しても、呼び出し元には例外を返さない', async () => {
    const env = { CHAT_EVENTS: { idFromName: () => 'id', get: () => ({ publish: async () => { throw new Error('x'); } }) } } as never;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(publishChatEvent(env, { kind: 'sent', friendId: 'f', accountId: null })).resolves.toBeUndefined();
    err.mockRestore();
  });
  it('waitUntil があれば渡す', async () => {
    const waitUntil = vi.fn();
    await publishChatEventInBackground({}, { waitUntil }, { kind: 'message', friendId: 'f', accountId: 'A' });
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});

describe('WebSocket の接続口(handleChatEventsUpgrade)', () => {
  const stubFetch = vi.fn(async (r: Request) => new Response(r.headers.get(ALLOWED_ACCOUNTS_HEADER), { status: 200 }));
  const base = () => ({
    DB: {} as D1Database,
    API_KEY: 'owner-key',
    ADMIN_ORIGIN: 'https://admin.example.com',
    CHAT_EVENTS: { idFromName: () => 'id', get: () => ({ fetch: stubFetch }) },
  });
  beforeEach(() => { stubFetch.mockClear(); });

  it('対象のパスと Upgrade だけを扱う', () => {
    expect(isChatEventsUpgrade(req())).toBe(true);
    expect(isChatEventsUpgrade(new Request('https://api.example.com/api/chat-events'))).toBe(false);
    expect(isChatEventsUpgrade(req({}, '/api/chats'))).toBe(false);
  });
  it('ログインしていなければ 401', async () => {
    const res = await handleChatEventsUpgrade(req({ Origin: 'https://admin.example.com' }), base() as never);
    expect(res.status).toBe(401);
    expect(stubFetch).not.toHaveBeenCalled();
  });
  it('許可していない Origin(他のサイト)からは 403。Cookie があっても通さない', async () => {
    const res = await handleChatEventsUpgrade(req({ Origin: 'https://evil.example.com', Cookie: 'lh_admin_session=owner-key' }), base() as never);
    expect(res.status).toBe(403);
    expect(stubFetch).not.toHaveBeenCalled();
  });
  it('オーナー(環境変数のキー)は、制限なしで DO に渡す。画面から送られた制限のヘッダーは上書きする', async () => {
    const res = await handleChatEventsUpgrade(
      req({ Origin: 'https://admin.example.com', Cookie: 'lh_admin_session=owner-key', [ALLOWED_ACCOUNTS_HEADER]: '["spoof"]' }),
      base() as never,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('all');
  });
  it('制限のあるスタッフは、見てよい公式アカウントだけを DO に渡す', async () => {
    const res = await handleChatEventsUpgrade(req({ Origin: 'https://admin.example.com', Cookie: 'lh_admin_session=staff-key' }), base() as never);
    expect(await res.text()).toBe('["A"]');
  });
  it('バインディングが無ければ 503', async () => {
    const env = { ...base(), CHAT_EVENTS: undefined };
    const res = await handleChatEventsUpgrade(req({ Cookie: 'lh_admin_session=owner-key' }), env as never);
    expect(res.status).toBe(503);
  });
});
