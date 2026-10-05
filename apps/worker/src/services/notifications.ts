import {
  isAvailableTiming,
  listActiveNotificationSettings,
  recordNotificationDelivery,
  timingLabel,
  type NotificationDestination,
  type NotificationSchedule,
  type NotificationSetting,
} from '@line-crm/db';

/**
 * 通知(Lステップの「通知」と同じ使い方)。
 * 友だち追加・メッセージ・フォーム回答などが起きたとき、オンの通知設定を探して、通知先へ知らせる。
 *
 * 【通知先は beyond admin に登録・検証済みの宛先だけ】
 * 実際のLINEのIDやメールアドレスは beyond line は持たない。beyond admin の子ツール用の口
 * (/api/internal/line/push・/api/internal/mail)に、宛先IDと本文を渡して送ってもらう。
 * beyond admin の URL とトークン(ログイン連携と同じ)が揃っていないと、何も送らない。
 *
 * 【例外は上げない】通知の失敗で、友だち追加やメッセージの処理を止めない。失敗は記録(notification_deliveries)に残す。
 */

export interface NotifyEnv {
  BEYOND_ADMIN_URL?: string;
  BEYOND_ADMIN_INTERNAL_TOKEN?: string;
  BEYOND_ADMIN_ALLOWED_TENANT_IDS?: string;
  /** 通知の本文に付ける、beyond line 管理画面の URL(任意) */
  ADMIN_WEB_URL?: string;
}

// Worker はリクエストごとに env を受け取るが、友だち追加などの処理の深いところには env が渡らないため、
// リクエストの入口で控えておく(env の中身はデプロイ中は変わらないので、共有して問題ない)。
let boundEnv: NotifyEnv | null = null;
export function bindNotificationEnv(env: NotifyEnv): void {
  boundEnv = env;
}

const ADMIN_TIMEOUT_MS = 5_000;
const NOTIFY_BUDGET_MS = 9_000;

function adminConfig(env: NotifyEnv | null): { base: string; token: string } | null {
  const base = (env?.BEYOND_ADMIN_URL ?? '').trim().replace(/\/+$/, '');
  const token = (env?.BEYOND_ADMIN_INTERNAL_TOKEN ?? '').trim();
  return base && token ? { base, token } : null;
}

async function adminRequest(env: NotifyEnv, path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const cfg = adminConfig(env);
  if (!cfg) return { ok: false, status: 0, json: { reason: 'beyond admin と連携していません' } };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ADMIN_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.base}${path}`, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok && json.ok !== false, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: { reason: err instanceof Error ? err.message : String(err) } };
  } finally {
    clearTimeout(timer);
  }
}

// ── 通知先の一覧(beyond admin に登録・検証済みのもの) ─────────────────────────

export interface AdminDestinations {
  /** 連携していない・取得できないときは false(画面に理由を出す) */
  available: boolean;
  reason?: string;
  /** beyond admin の URL(「通知先の追加はこちら」のリンク用) */
  adminUrl?: string;
  line: NotificationDestination[];
  mail: NotificationDestination[];
}

export function adminLinked(env: NotifyEnv): boolean {
  return adminConfig(env) !== null;
}

export async function listAdminDestinations(env: NotifyEnv, tenantId: string | null): Promise<AdminDestinations> {
  if (!adminConfig(env)) return { available: false, reason: 'beyond admin と連携していません', line: [], mail: [] };
  if (!tenantId) return { available: false, reason: '契約(会社)が特定できません。beyond admin のログインで入ってください', line: [], mail: [] };
  const q = `?tenantId=${encodeURIComponent(tenantId)}`;
  const [line, mail] = await Promise.all([
    adminRequest(env, `/api/internal/line/destinations${q}`, { method: 'GET' }),
    adminRequest(env, `/api/internal/mail/destinations${q}`, { method: 'GET' }),
  ]);
  const toList = (kind: 'line' | 'mail', r: { ok: boolean; json: Record<string, unknown> }): NotificationDestination[] =>
    r.ok && Array.isArray(r.json.destinations)
      ? (r.json.destinations as { id?: unknown; displayName?: unknown }[])
          .filter((d) => typeof d.id === 'string')
          .map((d) => ({ kind, id: d.id as string, name: typeof d.displayName === 'string' ? d.displayName : '' }))
      : [];
  const adminUrl = adminConfig(env)!.base;
  if (!line.ok && !mail.ok) {
    return { available: false, adminUrl, reason: String(line.json.reason ?? mail.json.reason ?? 'beyond admin から取得できませんでした'), line: [], mail: [] };
  }
  return { available: true, adminUrl, line: toList('line', line), mail: toList('mail', mail) };
}

/** メール宛先の登録: beyond admin に宛先を登録し、確認メールを送ってもらう(確認のリンクを開くと、通知先の候補に出る) */
export async function requestMailDestination(env: NotifyEnv, tenantId: string, email: string, displayName?: string): Promise<{ ok: boolean; error?: string }> {
  const r = await adminRequest(env, '/api/internal/mail/destinations', { method: 'POST', body: { tenantId, email, displayName } });
  return r.ok ? { ok: true } : { ok: false, error: String(r.json.reason ?? `HTTP ${r.status}`) };
}

/** この人(スタッフ)の契約(会社)ID。beyond admin のログインで入った人は、その会社。そうでなければ、許可している会社が1つだけならそれ */
export async function resolveTenantId(db: D1Database, env: NotifyEnv, staffId: string | null | undefined): Promise<string | null> {
  if (staffId) {
    const row = await db.prepare('SELECT external_tenant_id FROM staff_members WHERE id = ?').bind(staffId).first<{ external_tenant_id: string | null }>();
    if (row?.external_tenant_id) return row.external_tenant_id;
  }
  const allowed = (env.BEYOND_ADMIN_ALLOWED_TENANT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.length === 1 ? allowed[0] : null;
}

// ── 通知スケジュール(日本時間) ──────────────────────────────────────────────

export function isWithinSchedule(schedule: NotificationSchedule, now: Date = new Date()): boolean {
  if (schedule.mode === 'always') return true;
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const day = jst.getUTCDay();
  const minutes = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const from = toMin(schedule.from);
  const to = toMin(schedule.to);
  if (from < to) return schedule.days.includes(day) && minutes >= from && minutes < to;
  // 日をまたぐ(例 22:00〜06:00): 開始の曜日の夜、または、その翌朝(前日が選ばれている)
  if (minutes >= from) return schedule.days.includes(day);
  if (minutes < to) return schedule.days.includes((day + 6) % 7);
  return false;
}

// ── 本文 ───────────────────────────────────────────────────────────────────

export interface NotifyEvent {
  accountId: string | null | undefined;
  /** 通知するタイミング(NOTIFICATION_CATALOG のキー) */
  timing: string;
  friendId?: string | null;
  /** 本文の2行目以降(メッセージの内容など) */
  detail?: string | null;
  /** 回答フォームの通知で、どのフォームか(フォームを絞った設定のときに使う) */
  formId?: string | null;
  /** 友だち追加時など、お客様の名前を DB から引かずに渡したいとき */
  friendName?: string | null;
}

const clip = (s: string, n: number): string => {
  const t = Array.from(s.replace(/\s+/g, ' ').trim());
  return t.length > n ? `${t.slice(0, n).join('')}…` : t.join('');
};

const TYPE_LABEL: Record<string, string> = {
  image: '[画像]', sticker: '[スタンプ]', video: '[動画]', audio: '[音声]', file: '[ファイル]', location: '[位置情報]', flex: '[カード]',
};

/** 受信メッセージの要約(テキストは本文、それ以外は種類の表示) */
export function describeIncomingMessage(messageType: string, content: string): string {
  if (messageType !== 'text') return TYPE_LABEL[messageType] ?? '[メッセージ]';
  return clip(content, 200) || '[メッセージ]';
}

export async function buildNotificationText(db: D1Database, env: NotifyEnv, ev: NotifyEvent): Promise<{ subject: string; text: string }> {
  const account = ev.accountId
    ? await db.prepare('SELECT name FROM line_accounts WHERE id = ?').bind(ev.accountId).first<{ name: string }>()
    : null;
  let name = ev.friendName ?? null;
  if (!name && ev.friendId) {
    const f = await db.prepare('SELECT display_name, real_name, system_display_name FROM friends WHERE id = ?').bind(ev.friendId).first<{ display_name: string | null; real_name: string | null; system_display_name: string | null }>();
    name = f?.real_name || f?.system_display_name || f?.display_name || null;
  }
  const label = timingLabel(ev.timing);
  const head = `【${account?.name ?? 'beyond line'}】${label}`;
  const lines = [head];
  if (name) lines.push(`お客様: ${name}`);
  if (ev.detail) lines.push(clip(ev.detail, 300));
  const web = (env.ADMIN_WEB_URL ?? '').trim().replace(/\/+$/, '');
  if (web && ev.friendId) lines.push(`${web}/chats?friend=${ev.friendId}`);
  return { subject: head, text: lines.join('\n') };
}

// ── 送る ───────────────────────────────────────────────────────────────────

function matches(setting: NotificationSetting, ev: NotifyEvent): boolean {
  const t = setting.timings.find((x) => x.key === ev.timing);
  if (!t) return false;
  if (ev.timing === 'form_answered' && t.formIds?.length) return !!ev.formId && t.formIds.includes(ev.formId);
  return true;
}

async function passesTagFilter(db: D1Database, setting: NotificationSetting, ev: NotifyEvent): Promise<boolean> {
  // 友だち追加時の通知は、絞り込みの対象にしない(Lステップと同じ)
  if (setting.filterTagIds.length === 0 || ev.timing === 'friend_add' || !ev.friendId) return true;
  const placeholders = setting.filterTagIds.map(() => '?').join(',');
  const row = await db
    .prepare(`SELECT 1 AS x FROM friend_tags WHERE friend_id = ? AND tag_id IN (${placeholders}) LIMIT 1`)
    .bind(ev.friendId, ...setting.filterTagIds)
    .first();
  return !!row;
}

export async function sendToDestination(env: NotifyEnv, dest: NotificationDestination, content: { subject: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const r = dest.kind === 'line'
    ? await adminRequest(env, '/api/internal/line/push', { method: 'POST', body: { destinationId: dest.id, text: content.text } })
    : await adminRequest(env, '/api/internal/mail', { method: 'POST', body: { destinationId: dest.id, subject: content.subject, text: content.text } });
  return r.ok ? { ok: true } : { ok: false, error: String(r.json.reason ?? `HTTP ${r.status}`) };
}

/**
 * 通知する。条件に合うオンの設定すべての、通知先へ送る。失敗しても例外は上げない。
 * 友だち追加・メッセージなどの処理の最後に、`await notifyEvent(db, {...})` の形で呼ぶ。
 */
export async function notifyEvent(db: D1Database, ev: NotifyEvent, env: NotifyEnv | null = boundEnv): Promise<void> {
  try {
    if (!env || !adminConfig(env) || !isAvailableTiming(ev.timing)) return;
    const run = async () => {
      // 公式アカウントが分からないときは、友だちのアカウントから決める
      if (!ev.accountId && ev.friendId) {
        const f = await db.prepare('SELECT line_account_id FROM friends WHERE id = ?').bind(ev.friendId).first<{ line_account_id: string | null }>();
        ev = { ...ev, accountId: f?.line_account_id ?? null };
      }
      if (!ev.accountId) return;
      const settings = (await listActiveNotificationSettings(db, ev.accountId)).filter((s) => matches(s, ev));
      if (settings.length === 0) return;
      const now = new Date();
      const targets: NotificationSetting[] = [];
      for (const s of settings) {
        if (!isWithinSchedule(s.schedule, now)) continue;
        if (!(await passesTagFilter(db, s, ev))) continue;
        targets.push(s);
      }
      if (targets.length === 0) return;
      const content = await buildNotificationText(db, env, ev);
      // 同じ通知先に、複数の設定から二重に送らない
      const sent = new Set<string>();
      const jobs: Promise<void>[] = [];
      for (const s of targets) {
        for (const d of s.destinations) {
          const key = `${d.kind}:${d.id}`;
          if (sent.has(key)) continue;
          sent.add(key);
          jobs.push(
            sendToDestination(env, d, content).then(async (r) => {
              await recordNotificationDelivery(db, { settingId: s.id, timing: ev.timing, friendId: ev.friendId ?? null, kind: d.kind, destinationId: d.id, status: r.ok ? 'sent' : 'failed', error: r.error });
            }),
          );
        }
      }
      await Promise.allSettled(jobs);
    };
    // 友だち追加などの処理を、通知で長く待たせない
    await Promise.race([run(), new Promise<void>((resolve) => setTimeout(resolve, NOTIFY_BUDGET_MS))]);
  } catch (err) {
    console.error('notifyEvent failed', err);
  }
}
