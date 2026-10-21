import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({ getStaffAllowedAccountIds: vi.fn() }));
vi.mock('@line-crm/db', () => ({ getStaffAllowedAccountIds: mocks.getStaffAllowedAccountIds }));

import { accountAccessGuard } from './account-access.js';

/** friends / chats を引くだけの D1 疑似。 */
const FRIENDS: Record<string, string> = { 'friend-a': 'acc-a', 'friend-b': 'acc-b' };
const CHATS: Record<string, string> = { 'chat-a': 'friend-a', 'chat-b': 'friend-b' };
/** 一斉配信 → 公式アカウント(null=アカウント未指定) */
const BROADCASTS: Record<string, string | null> = { 'bc-a': 'acc-a', 'bc-b': 'acc-b', 'bc-none': null };
const db = {
  prepare: (sql: string) => ({
    bind: (id: string) => ({
      first: async () => {
        if (sql.includes('FROM broadcasts')) {
          const acc = BROADCASTS[id];
          return acc === undefined ? null : { line_account_id: acc };
        }
        if (sql.includes('FROM chats')) {
          const friendId = CHATS[id];
          return friendId ? { line_account_id: FRIENDS[friendId] } : null;
        }
        return FRIENDS[id] ? { line_account_id: FRIENDS[id] } : null;
      },
    }),
  }),
} as unknown as D1Database;

function call(staff: Env['Variables']['staff'] | null, method: string, path: string, body?: unknown) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (staff) c.set('staff', staff);
    await next();
  });
  app.use('*', accountAccessGuard);
  app.all('*', (c) => c.json({ ok: true, allowed: c.get('allowedAccountIds') ?? null }));
  return app.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) }, { DB: db } as Env['Bindings']);
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

describe('一斉配信(アカウントを限定した「管理者」は、許可されたアカウントの分だけ)', () => {
  const admin = { id: 's2', name: '店舗A管理用', role: 'admin' as const };
  const asAdmin = (method: string, path: string, body?: unknown) => {
    mocks.getStaffAllowedAccountIds.mockResolvedValue(['acc-a']);
    return call(admin, method, path, body);
  };
  test('配信の一覧は、許可されたアカウントを指定したときだけ', async () => {
    expect((await asAdmin('GET', '/api/broadcasts?lineAccountId=acc-a')).status).toBe(200);
    expect((await asAdmin('GET', '/api/broadcasts?lineAccountId=acc-b')).status).toBe(403);
    expect((await asAdmin('GET', '/api/broadcasts')).status).toBe(403);
  });
  test('配信の作成は、本文の公式アカウントが許可されているときだけ', async () => {
    expect((await asAdmin('POST', '/api/broadcasts', { lineAccountId: 'acc-a', title: 't' })).status).toBe(200);
    expect((await asAdmin('POST', '/api/broadcasts', { lineAccountId: 'acc-b', title: 't' })).status).toBe(403);
    expect((await asAdmin('POST', '/api/broadcasts', { title: 't' })).status).toBe(403);
  });
  test('個別の配信は、その配信の公式アカウントで判定する(見る・送る・消す・テスト送信・進捗)', async () => {
    for (const [m, path] of [['GET', '/api/broadcasts/bc-a'], ['PUT', '/api/broadcasts/bc-a'], ['DELETE', '/api/broadcasts/bc-a'], ['POST', '/api/broadcasts/bc-a/send'], ['POST', '/api/broadcasts/bc-a/test-send'], ['GET', '/api/broadcasts/bc-a/progress']] as const) {
      expect((await asAdmin(m, path)).status, `${m} ${path}`).toBe(200);
    }
    for (const [m, path] of [['GET', '/api/broadcasts/bc-b'], ['POST', '/api/broadcasts/bc-b/send'], ['DELETE', '/api/broadcasts/bc-b'], ['GET', '/api/broadcasts/bc-none'], ['GET', '/api/broadcasts/unknown']] as const) {
      expect((await asAdmin(m, path)).status, `${m} ${path}`).toBe(403);
    }
  });
  test('配信の作成に使う補助(人数・テスト送信先・画像・フォーム一覧)も、許可アカウントの分だけ', async () => {
    expect((await asAdmin('POST', '/api/segments/count', { accountId: 'acc-a', conditions: {} })).status).toBe(200);
    expect((await asAdmin('POST', '/api/segments/count', { accountId: 'acc-b', conditions: {} })).status).toBe(403);
    expect((await asAdmin('POST', '/api/segments/count', { conditions: {} })).status).toBe(403);
    expect((await asAdmin('GET', '/api/account-settings/test-recipients?accountId=acc-a')).status).toBe(200);
    expect((await asAdmin('GET', '/api/account-settings/test-recipients?accountId=acc-b')).status).toBe(403);
    expect((await asAdmin('PUT', '/api/account-settings/test-recipients', { accountId: 'acc-b', friendIds: [] })).status).toBe(403);
    expect((await asAdmin('POST', '/api/images')).status).toBe(200);
    expect((await asAdmin('GET', '/api/forms')).status).toBe(200);
  });
  test('「管理者」でも、フォームの回答・他の設定は、これまでどおり拒否', async () => {
    for (const [m, path] of [['GET', '/api/forms/f1/submissions'], ['GET', '/api/staff'], ['GET', '/api/webhooks'], ['PUT', '/api/account-settings/link-base-url']] as const) {
      expect((await asAdmin(m, path)).status, `${m} ${path}`).toBe(403);
    }
  });
  test('「スタッフ」の役割は、一斉配信できない', async () => {
    mocks.getStaffAllowedAccountIds.mockResolvedValue(['acc-a']);
    expect((await call(restricted, 'GET', '/api/broadcasts?lineAccountId=acc-a')).status).toBe(403);
    expect((await call(restricted, 'POST', '/api/broadcasts', { lineAccountId: 'acc-a' })).status).toBe(403);
  });
});
