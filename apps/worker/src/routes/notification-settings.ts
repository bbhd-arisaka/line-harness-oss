import { Hono } from 'hono';
import {
  NOTIFICATION_CATALOG,
  NotificationSettingError,
  createNotificationSetting,
  deleteNotificationSetting,
  ensureDefaultNotificationSettings,
  getNotificationSetting,
  listNotificationSettings,
  listRecentNotificationDeliveries,
  updateNotificationSetting,
} from '@line-crm/db';
import type { NotificationDestination, NotificationSetting } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import { adminLinked, listAdminDestinations, requestMailDestination, resolveTenantId, sendToDestination } from '../services/notifications.js';
import type { Env } from '../index.js';

/**
 * 通知設定(Lステップの「通知」と同じ使い方)。公式アカウントごと。
 *  GET    /api/notification-settings?lineAccountId=…   一覧(まだ1つも無ければ、標準の設定を、オフで作る)
 *  POST   /api/notification-settings                    作成
 *  PUT    /api/notification-settings/:id                更新(オン/オフの切り替えも)
 *  DELETE /api/notification-settings/:id                削除
 *  GET    /api/notification-settings/catalog            選べるタイミングの一覧
 *  GET    /api/notification-destinations                通知先の候補(beyond admin に登録・検証済みの宛先)
 *  POST   /api/notification-settings/:id/test           テスト送信(その設定の通知先すべてへ)
 *  GET    /api/notification-settings/:id/deliveries     直近の送信記録
 * 通知先は、beyond admin に登録・検証済みの宛先だけ。管理者(admin 以上)だけが操作できる。
 */
const notificationSettings = new Hono<Env>();

function accountAllowed(c: { get: (k: 'allowedAccountIds') => string[] | null | undefined }, accountId: string): boolean {
  const allowed = c.get('allowedAccountIds');
  return allowed == null || allowed.includes(accountId);
}

const fail = (c: { json: (b: unknown, s: 400 | 403 | 404 | 500) => Response }, err: unknown): Response => {
  if (err instanceof NotificationSettingError) return c.json({ success: false, error: err.message }, 400);
  console.error('notification-settings error:', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
};

notificationSettings.get('/api/notification-settings/catalog', requireRole('owner', 'admin'), (c) =>
  c.json({ success: true, data: NOTIFICATION_CATALOG }),
);

notificationSettings.get('/api/notification-destinations', requireRole('owner', 'admin'), async (c) => {
  const tenantId = await resolveTenantId(c.env.DB, c.env, c.get('staff')?.id);
  return c.json({ success: true, data: await listAdminDestinations(c.env, tenantId) });
});

// メールの通知先を、beyond admin に登録する(確認メールが届き、リンクを開くと通知先として選べるようになる)
notificationSettings.post('/api/notification-destinations/mail', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ email?: unknown; displayName?: unknown }>().catch(() => ({}) as { email?: unknown; displayName?: unknown });
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ success: false, error: 'メールアドレスの形式が正しくありません' }, 400);
  const tenantId = await resolveTenantId(c.env.DB, c.env, c.get('staff')?.id);
  if (!tenantId) return c.json({ success: false, error: '契約(会社)が特定できません。beyond admin のログインで入ってください' }, 400);
  const displayName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim().slice(0, 100) : undefined;
  const r = await requestMailDestination(c.env, tenantId, email, displayName);
  return r.ok ? c.json({ success: true, data: null }) : c.json({ success: false, error: r.error ?? '登録できませんでした' }, 400);
});

notificationSettings.get('/api/notification-settings', requireRole('owner', 'admin'), async (c) => {
  const accountId = c.req.query('lineAccountId');
  if (!accountId) return c.json({ success: false, error: 'lineAccountId は必須です' }, 400);
  if (!accountAllowed(c, accountId)) return c.json({ success: false, error: 'このアカウントは見られません' }, 403);
  try {
    let list = await listNotificationSettings(c.env.DB, accountId);
    if (list.length === 0) {
      // 古いアカウント(標準の設定が無いもの)は、開いたときに標準の設定を、オフで作る。通知先は、あとで選んでオンにする
      await ensureDefaultNotificationSettings(c.env.DB, accountId, []);
      list = await listNotificationSettings(c.env.DB, accountId);
    }
    return c.json({ success: true, data: list, adminLinked: adminLinked(c.env) });
  } catch (err) {
    return fail(c, err);
  }
});

notificationSettings.post('/api/notification-settings', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const accountId = typeof body.lineAccountId === 'string' ? body.lineAccountId : '';
    if (!accountId) return c.json({ success: false, error: 'lineAccountId は必須です' }, 400);
    if (!accountAllowed(c, accountId)) return c.json({ success: false, error: 'このアカウントは操作できません' }, 403);
    await assertKnownDestinations(c, body.destinations);
    const setting = await createNotificationSetting(c.env.DB, accountId, body, { createdBy: c.get('staff')?.name ?? null });
    return c.json({ success: true, data: setting }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

async function loadAllowed(c: Parameters<typeof accountAllowed>[0] & { env: Env['Bindings']; req: { param: (k: string) => string | undefined } }): Promise<NotificationSetting | null> {
  const setting = await getNotificationSetting(c.env.DB, c.req.param('id')!);
  if (!setting || !accountAllowed(c, setting.lineAccountId)) return null;
  return setting;
}

notificationSettings.put('/api/notification-settings/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const cur = await loadAllowed(c);
    if (!cur) return c.json({ success: false, error: '通知設定が見つかりません' }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (body.destinations !== undefined) await assertKnownDestinations(c, body.destinations);
    return c.json({ success: true, data: await updateNotificationSetting(c.env.DB, cur.id, body) });
  } catch (err) {
    return fail(c, err);
  }
});

notificationSettings.delete('/api/notification-settings/:id', requireRole('owner', 'admin'), async (c) => {
  const cur = await loadAllowed(c);
  if (!cur) return c.json({ success: false, error: '通知設定が見つかりません' }, 404);
  await deleteNotificationSetting(c.env.DB, cur.id);
  return c.json({ success: true, data: null });
});

notificationSettings.post('/api/notification-settings/:id/test', requireRole('owner', 'admin'), async (c) => {
  const cur = await loadAllowed(c);
  if (!cur) return c.json({ success: false, error: '通知設定が見つかりません' }, 404);
  if (!adminLinked(c.env)) return c.json({ success: false, error: 'beyond admin と連携していません' }, 400);
  const account = await c.env.DB.prepare('SELECT name FROM line_accounts WHERE id = ?').bind(cur.lineAccountId).first<{ name: string }>();
  const head = `【${account?.name ?? 'beyond line'}】テスト通知`;
  const content = { subject: head, text: `${head}\n「${cur.title}」の通知先に、テスト通知を送っています。このメッセージが届いていれば、設定は正しく動いています。` };
  const results = await Promise.all(cur.destinations.map(async (d) => ({ kind: d.kind, name: d.name, ...(await sendToDestination(c.env, d, content)) })));
  return c.json({ success: true, data: results });
});

notificationSettings.get('/api/notification-settings/:id/deliveries', requireRole('owner', 'admin'), async (c) => {
  const cur = await loadAllowed(c);
  if (!cur) return c.json({ success: false, error: '通知設定が見つかりません' }, 404);
  return c.json({ success: true, data: await listRecentNotificationDeliveries(c.env.DB, cur.id) });
});

/**
 * 通知先は、beyond admin に登録・検証済みの宛先だけ。画面から来た宛先IDが、いま beyond admin にある宛先か確かめる。
 * beyond admin と連携していない、または一覧を取れないときは、新しい宛先は受け付けない(すでに設定にあるものは、そのまま残せる)。
 */
async function assertKnownDestinations(
  c: { env: Env['Bindings']; get: (k: 'staff') => { id: string } | undefined },
  raw: unknown,
): Promise<void> {
  if (!Array.isArray(raw)) return; // 形の検証は、保存の関数がする
  const tenantId = await resolveTenantId(c.env.DB, c.env, c.get('staff')?.id);
  const listed = await listAdminDestinations(c.env, tenantId);
  if (!listed.available) throw new NotificationSettingError(`通知先を確認できませんでした(${listed.reason ?? 'beyond admin につながりません'})`);
  const known = new Set<string>([...listed.line, ...listed.mail].map((d: NotificationDestination) => `${d.kind}:${d.id}`));
  for (const d of raw as { kind?: unknown; id?: unknown }[]) {
    if (!known.has(`${String(d?.kind)}:${String(d?.id)}`)) {
      throw new NotificationSettingError('beyond admin に登録されていない通知先が含まれています。通知先は、beyond admin で登録してください');
    }
  }
}

export { notificationSettings };
