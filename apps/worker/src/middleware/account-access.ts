import type { Context, Next } from 'hono';
import { getStaffAllowedAccountIds } from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * スタッフごとのアカウント権限を API で強制する。
 *
 * - オーナー、および制限が設定されていないスタッフ: 全アカウント(従来どおり)。
 * - 制限のあるスタッフ(staff_account_access に行がある): 許可したアカウントの友だち・トークだけ。
 *   「拒否が既定」: アカウント別に安全と確認できた下のAPIだけを通し、それ以外は 403。
 *   (別会社のアカウントを同居させても、他社の友だち・回答・設定が見えないようにするため)
 */
const FORBIDDEN = {
  success: false,
  error: 'このアカウントを操作する権限がありません。管理者に依頼してください。',
} as const;

function forbidden(c: Context<Env>): Response {
  return c.json(FORBIDDEN, 403);
}

async function friendAccountId(db: D1Database, friendId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT line_account_id FROM friends WHERE id = ?')
    .bind(friendId)
    .first<{ line_account_id: string | null }>();
  return row?.line_account_id ?? null;
}

async function chatAccountId(db: D1Database, chatId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT f.line_account_id FROM chats c INNER JOIN friends f ON f.id = c.friend_id WHERE c.id = ?')
    .bind(chatId)
    .first<{ line_account_id: string | null }>();
  return row?.line_account_id ?? null;
}

/** 友だち一覧などのクエリ: アカウントの指定が必須で、許可したアカウントだけ通す。 */
function queryAccountAllowed(c: Context<Env>, allowed: string[], param: string): boolean {
  const value = c.req.query(param);
  return !!value && allowed.includes(value);
}

export async function accountAccessGuard(c: Context<Env>, next: Next): Promise<Response | void> {
  const staff = c.get('staff');
  const path = new URL(c.req.url).pathname;
  // 未認証の公開エンドポイント(LIFF・Webhook など)や API 以外は対象外
  if (!staff || !path.startsWith('/api/')) return next();

  // オーナー(環境変数キー含む)は常に全アカウント
  let allowed: string[] | null = null;
  if (staff.role !== 'owner' && staff.id !== 'env-owner') {
    allowed = await getStaffAllowedAccountIds(c.env.DB, staff.id);
  }
  c.set('allowedAccountIds', allowed);
  if (allowed === null) return next();

  const method = c.req.method.toUpperCase();
  const isGet = method === 'GET';
  const db = c.env.DB;

  // 自分の情報・認証まわり
  if (path === '/api/staff/me' || path.startsWith('/api/auth/') || path.startsWith('/api/app/')) return next();

  // 公式アカウント一覧(内容は各ハンドラーが許可分だけに絞る)/ 個別参照
  if (isGet && path === '/api/line-accounts') return next();
  const accountMatch = path.match(/^\/api\/line-accounts\/([^/]+)$/);
  if (isGet && accountMatch) return allowed.includes(accountMatch[1]) ? next() : forbidden(c);

  // 一覧系: アカウントの指定が必須
  if (isGet && ['/api/friends', '/api/friends/count', '/api/friends/ref-stats', '/api/chats', '/api/conversations'].includes(path)) {
    return queryAccountAllowed(c, allowed, 'lineAccountId') ? next() : forbidden(c);
  }
  if (isGet && (path === '/api/inbox/unanswered' || path === '/api/inbox/unanswered/count')) {
    return queryAccountAllowed(c, allowed, 'account') ? next() : forbidden(c);
  }

  // 友だち単位: その友だちのアカウントが許可されている場合だけ
  const friendMatch = path.match(/^\/api\/friends\/([^/]+)(?:\/.*)?$/);
  if (friendMatch && !['count', 'ref-stats'].includes(friendMatch[1])) {
    const accountId = await friendAccountId(db, friendMatch[1]);
    return accountId && allowed.includes(accountId) ? next() : forbidden(c);
  }
  const conversationMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
  if (isGet && conversationMatch) {
    const accountId = await friendAccountId(db, conversationMatch[1]);
    return accountId && allowed.includes(accountId) ? next() : forbidden(c);
  }
  const chatMatch = path.match(/^\/api\/chats\/([^/]+)(?:\/.*)?$/);
  if (chatMatch) {
    const accountId = await chatAccountId(db, chatMatch[1]);
    return accountId && allowed.includes(accountId) ? next() : forbidden(c);
  }

  // 友だちリストの「保存した検索」: アカウントの確認は、各ハンドラーが行う
  if (path === '/api/friend-searches' || path.startsWith('/api/friend-searches/')) return next();

  // 全アカウント共通の一覧(タグ・友だち情報欄・担当者)は読み取りだけ許可
  if (isGet && (path === '/api/tags' || path === '/api/operators' || /^\/api\/friend-fields\/(folders|definitions)$/.test(path))) {
    return next();
  }

  // それ以外は、アカウント別に安全と確認できるまで拒否
  return forbidden(c);
}
