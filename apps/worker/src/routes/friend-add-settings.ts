import { Hono } from 'hono';
import { FriendAddSettingError, getFriendAddSettings, saveFriendAddSetting } from '@line-crm/db';
import { FilterError, parseFriendFilter } from '../services/friend-filter.js';
import type { FriendAddKind } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

/**
 * 友だち追加時設定(Lステップと同じ)。公式アカウントごとに、新規友だち / 再フォロー・導入前からの友だち の2区分。
 *  GET /api/friend-add-settings?lineAccountId=…           2区分とも
 *  PUT /api/friend-add-settings/:kind?lineAccountId=…     保存(kind = new | returning)。{ scenarioId, actions }
 */
const friendAddSettings = new Hono<Env>();

function accountAllowed(c: { get: (k: 'allowedAccountIds') => string[] | null | undefined }, accountId: string): boolean {
  const allowed = c.get('allowedAccountIds');
  return allowed == null || allowed.includes(accountId);
}

friendAddSettings.get('/api/friend-add-settings', requireRole('owner', 'admin'), async (c) => {
  const accountId = c.req.query('lineAccountId');
  if (!accountId) return c.json({ success: false, error: 'lineAccountId は必須です' }, 400);
  if (!accountAllowed(c, accountId)) return c.json({ success: false, error: 'このアカウントは見られません' }, 403);
  return c.json({ success: true, data: await getFriendAddSettings(c.env.DB, accountId) });
});

friendAddSettings.put('/api/friend-add-settings/:kind', requireRole('owner', 'admin'), async (c) => {
  const kind = c.req.param('kind');
  if (kind !== 'new' && kind !== 'returning') return c.json({ success: false, error: '区分が正しくありません' }, 400);
  const accountId = c.req.query('lineAccountId');
  if (!accountId) return c.json({ success: false, error: 'lineAccountId は必須です' }, 400);
  if (!accountAllowed(c, accountId)) return c.json({ success: false, error: 'このアカウントは操作できません' }, 403);
  try {
    const body = await c.req.json<{ scenarioId?: unknown; actions?: unknown }>().catch(() => ({}) as { scenarioId?: unknown; actions?: unknown });
    // 条件(友だち絞り込み)は、形を検証してから保存する
    if (Array.isArray(body.actions)) {
      body.actions = (body.actions as Array<{ condition?: unknown }>).map((a) => (a && a.condition ? { ...a, condition: parseFriendFilter(a.condition) } : a));
    }
    return c.json({ success: true, data: await saveFriendAddSetting(c.env.DB, accountId, kind as FriendAddKind, body) });
  } catch (err) {
    if (err instanceof FilterError) return c.json({ success: false, error: '条件の設定が正しくありません: ' + err.message }, 400);
    if (err instanceof FriendAddSettingError) return c.json({ success: false, error: err.message }, 400);
    console.error('friend-add-settings error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friendAddSettings };
