import { Hono } from 'hono';
import {
  createSavedFriendSearch,
  deleteSavedFriendSearch,
  getSavedFriendSearch,
  listSavedFriendSearches,
} from '@line-crm/db';
import type { SavedFriendSearch } from '@line-crm/db';
import { FilterError, parseFriendFilter } from '../services/friend-filter.js';
import type { Env } from '../index.js';

/**
 * 友だちリストの「保存した検索」(アカウントごと)。
 *  GET    /api/friend-searches?lineAccountId=…
 *  POST   /api/friend-searches   { lineAccountId, name, filter }
 *  DELETE /api/friend-searches/:id
 * 見られるアカウントが制限されているスタッフは、許可されたアカウントの分だけ。
 */
const friendSearches = new Hono<Env>();

function serialize(row: SavedFriendSearch) {
  let filter: unknown = {};
  try { filter = JSON.parse(row.filter); } catch { /* 壊れた行は空の条件として返す */ }
  return { id: row.id, lineAccountId: row.line_account_id, name: row.name, filter, createdBy: row.created_by, createdAt: row.created_at };
}

function accountAllowed(c: { get: (k: 'allowedAccountIds') => string[] | null | undefined }, accountId: string): boolean {
  const allowed = c.get('allowedAccountIds');
  return allowed == null || allowed.includes(accountId);
}

friendSearches.get('/api/friend-searches', async (c) => {
  const accountId = c.req.query('lineAccountId');
  if (!accountId) return c.json({ success: false, error: 'lineAccountId は必須です' }, 400);
  if (!accountAllowed(c, accountId)) return c.json({ success: false, error: 'このアカウントは見られません' }, 403);
  return c.json({ success: true, data: (await listSavedFriendSearches(c.env.DB, accountId)).map(serialize) });
});

friendSearches.post('/api/friend-searches', async (c) => {
  const body = await c.req.json<{ lineAccountId?: unknown; name?: unknown; filter?: unknown }>().catch(() => ({}) as Record<string, unknown>);
  const accountId = typeof body.lineAccountId === 'string' ? body.lineAccountId : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!accountId) return c.json({ success: false, error: 'lineAccountId は必須です' }, 400);
  if (!name || name.length > 60) return c.json({ success: false, error: '検索の名前は1〜60文字で入力してください' }, 400);
  if (!accountAllowed(c, accountId)) return c.json({ success: false, error: 'このアカウントは操作できません' }, 403);
  const account = await c.env.DB.prepare('SELECT id FROM line_accounts WHERE id = ?').bind(accountId).first();
  if (!account) return c.json({ success: false, error: 'アカウントが見つかりません' }, 404);
  try {
    // 検証してから、正規化した形で保存する
    const parsed = parseFriendFilter(body.filter);
    const row = await createSavedFriendSearch(c.env.DB, { lineAccountId: accountId, name, filter: JSON.stringify(parsed), createdBy: c.get('staff')?.name ?? null });
    return c.json({ success: true, data: serialize(row) }, 201);
  } catch (err) {
    if (err instanceof FilterError) return c.json({ success: false, error: err.message }, 400);
    throw err;
  }
});

friendSearches.delete('/api/friend-searches/:id', async (c) => {
  const row = await getSavedFriendSearch(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
  if (!accountAllowed(c, row.line_account_id)) return c.json({ success: false, error: 'このアカウントは操作できません' }, 403);
  await deleteSavedFriendSearch(c.env.DB, row.id);
  return c.json({ success: true, data: null });
});

export { friendSearches };
