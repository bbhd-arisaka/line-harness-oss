import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({ getStaffAllowedAccountIds: vi.fn() }));
vi.mock('@line-crm/db', () => ({ getStaffAllowedAccountIds: mocks.getStaffAllowedAccountIds }));

import { accountAccessGuard } from './account-access.js';

/** friends / chats を引くだけの D1 疑似。 */
const FRIENDS: Record<string, string> = { 'friend-a': 'acc-a', 'friend-b': 'acc-b' };
const CHATS: Record<string, string> = { 'chat-a': 'friend-a', 'chat-b': 'friend-b' };
const db = {
  prepare: (sql: string) => ({
    bind: (id: string) => ({
      first: async () => {
        if (sql.includes('FROM chats')) {
          const friendId = CHATS[id];
          return friendId ? { line_account_id: FRIENDS[friendId] } : null;
        }
        return FRIENDS[id] ? { line_account_id: FRIENDS[id] } : null;
      },
    }),
  }),
} as unknown as D1Database;

function call(staff: Env['Variables']['staff'] | null, method: string, path: string) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (staff) c.set('staff', staff);
    await next();
  });
  app.use('*', accountAccessGuard);
  app.all('*', (c) => c.json({ ok: true, allowed: c.get('allowedAccountIds') ?? null }));
  return app.request(path, { method }, { DB: db } as Env['Bindings']);
}

const restricted = { id: 's1', name: '店舗A担当', role: 'staff' as const };
const asRestricted = (method: string, path: string) => {
  mocks.getStaffAllowedAccountIds.mockResolvedValue(['acc-a']);
  return call(restricted, method, path);
};

describe('スタッフのアカウント権限(accountAccessGuard)', () => {
  test('オーナーは制限されない(権限テーブルも見ない)', async () => {
    mocks.getStaffAllowedAccountIds.mockClear();
    const res = await call({ id: 'o1', name: 'owner', role: 'owner' }, 'GET', '/api/webhooks');
    expect(res.status).toBe(200);
    expect(mocks.getStaffAllowedAccountIds).not.toHaveBeenCalled();
  });

  test('制限が設定されていないスタッフは従来どおり全部使える', async () => {
    mocks.getStaffAllowedAccountIds.mockResolvedValue(null);
    expect((await call(restricted, 'GET', '/api/friends?lineAccountId=acc-b')).status).toBe(200);
    expect((await call(restricted, 'GET', '/api/webhooks')).status).toBe(200);
  });

  test('未認証の公開エンドポイントは対象外', async () => {
    expect((await call(null, 'POST', '/api/forms/x/submit')).status).toBe(200);
  });

  test('許可アカウントの一覧は通り、他アカウントや指定なしは拒否', async () => {
    expect((await asRestricted('GET', '/api/friends?lineAccountId=acc-a')).status).toBe(200);
    expect((await asRestricted('GET', '/api/friends?lineAccountId=acc-b')).status).toBe(403);
    expect((await asRestricted('GET', '/api/friends')).status).toBe(403);
    expect((await asRestricted('GET', '/api/chats?lineAccountId=acc-b')).status).toBe(403);
    expect((await asRestricted('GET', '/api/conversations')).status).toBe(403);
    expect((await asRestricted('GET', '/api/inbox/unanswered?account=acc-b')).status).toBe(403);
    expect((await asRestricted('GET', '/api/inbox/unanswered/count?account=acc-a')).status).toBe(200);
  });

  test('友だち単位のAPIは、その友だちのアカウントで判定する(書き込み・送信も)', async () => {
    expect((await asRestricted('GET', '/api/friends/friend-a')).status).toBe(200);
    expect((await asRestricted('PUT', '/api/friends/friend-a/metadata')).status).toBe(200);
    expect((await asRestricted('GET', '/api/friends/friend-b')).status).toBe(403);
    expect((await asRestricted('POST', '/api/friends/friend-b/messages')).status).toBe(403);
    expect((await asRestricted('DELETE', '/api/friends/friend-b/tags/t1')).status).toBe(403);
    expect((await asRestricted('GET', '/api/friends/unknown')).status).toBe(403);
    expect((await asRestricted('GET', '/api/conversations/friend-b')).status).toBe(403);
  });

  test('チャット単位のAPIも、友だちのアカウントで判定する', async () => {
    expect((await asRestricted('GET', '/api/chats/chat-a')).status).toBe(200);
    expect((await asRestricted('POST', '/api/chats/chat-b/send')).status).toBe(403);
    expect((await asRestricted('PUT', '/api/chats/chat-b')).status).toBe(403);
  });

  test('チャットは、友だちIDで開いても(一覧・アプリ・通知はこちら)、友だちのアカウントで判定する', async () => {
    expect((await asRestricted('GET', '/api/chats/friend-a')).status).toBe(200);
    expect((await asRestricted('POST', '/api/chats/friend-a/send')).status).toBe(200);
    expect((await asRestricted('GET', '/api/chats/friend-b')).status).toBe(403);
    expect((await asRestricted('PUT', '/api/chats/friend-b')).status).toBe(403);
    expect((await asRestricted('GET', '/api/chats/no-such')).status).toBe(403);
  });

  test('公式アカウントは許可分だけ参照でき、作成・変更・削除は拒否', async () => {
    expect((await asRestricted('GET', '/api/line-accounts')).status).toBe(200);
    expect((await asRestricted('GET', '/api/line-accounts/acc-a')).status).toBe(200);
    expect((await asRestricted('GET', '/api/line-accounts/acc-b')).status).toBe(403);
    expect((await asRestricted('POST', '/api/line-accounts')).status).toBe(403);
    expect((await asRestricted('PUT', '/api/line-accounts/acc-a')).status).toBe(403);
  });

  test('共通のタグ・友だち情報欄は読み取りだけ許可', async () => {
    expect((await asRestricted('GET', '/api/tags')).status).toBe(200);
    expect((await asRestricted('POST', '/api/tags')).status).toBe(403);
    expect((await asRestricted('GET', '/api/friend-fields/definitions')).status).toBe(200);
    expect((await asRestricted('POST', '/api/friend-fields/definitions')).status).toBe(403);
  });

  test('拒否が既定: 安全確認済みでないAPI(フォーム回答・設定・スタッフ管理など)はすべて拒否', async () => {
    for (const [method, path] of [
      ['GET', '/api/forms'],
      ['GET', '/api/forms/f1/submissions'],
      ['GET', '/api/form-submissions'],
      ['GET', '/api/staff'],
      ['POST', '/api/staff'],
      ['GET', '/api/broadcasts'],
      ['GET', '/api/scenarios'],
      ['GET', '/api/webhooks'],
      ['GET', '/api/inbox/activity-digest'],
      ['POST', '/api/chats'],
    ] as const) {
      expect((await asRestricted(method, path)).status, `${method} ${path}`).toBe(403);
    }
  });

  test('自分の情報は取得できる', async () => {
    expect((await asRestricted('GET', '/api/staff/me')).status).toBe(200);
  });
});
