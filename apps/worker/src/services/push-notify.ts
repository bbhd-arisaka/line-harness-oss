import { getStaffAllowedAccountIds, parseMutedAccountIds, parseMutedPushKinds } from '@line-crm/db';
import type { AppPushKind } from '@line-crm/db';
import { clearInvalidApnsToken, getApnsConfig, sendApnsAlert } from './apns.js';
import type { ApnsEnv, ApnsSendOptions } from './apns.js';

/**
 * 友だちからの新着メッセージ・フォームの回答を、アプリ(iOS)を入れているスタッフの端末に通知する。
 * - 何を通知するかは、端末ごとにアプリの設定画面で選ぶ(止めている種類は送らない。Web 側の設定は要らない)。
 * - APNs の設定(環境変数)が無ければ、何もしない(DB も触らない)。
 * - 宛先は、その公式アカウントを見る権限があるスタッフの端末だけ(middleware/account-access.ts と同じ解釈)。
 * - 例外は投げない。
 */

export const MAX_DEVICES_PER_NOTIFICATION = 50;
const BODY_MAX_CHARS = 80;

export interface IncomingMessageNotice {
  friendId: string;
  accountId: string | null;
  /** 通知のタイトルに使う名前。省略すると DB の友だちから決める */
  friendName?: string | null;
  messageType: string;
  content: string;
}

const TYPE_LABEL: Record<string, string> = {
  image: '[画像]',
  sticker: '[スタンプ]',
  video: '[動画]',
  audio: '[音声]',
  file: '[ファイル]',
  location: '[位置情報]',
  flex: '[カード]',
};

/** 通知の本文: テキストは80文字まで、それ以外は種類の表示 */
export function describeMessageForPush(messageType: string, content: string): string {
  if (messageType !== 'text') return TYPE_LABEL[messageType] ?? '[メッセージ]';
  const text = content.replace(/\s+/g, ' ').trim();
  if (!text) return '[メッセージ]';
  const chars = Array.from(text);
  return chars.length > BODY_MAX_CHARS ? `${chars.slice(0, BODY_MAX_CHARS).join('')}…` : text;
}

interface SessionRow {
  apns_token: string;
  muted_account_ids: string | null;
  muted_push_kinds: string | null;
  expires_at: string;
  staff_id: string;
  role: string | null;
}

/** 通知を受け取る端末トークン(重複なし・最大50)を決める */
export async function resolvePushRecipients(
  db: D1Database,
  accountId: string | null,
  now = Date.now(),
  kind: AppPushKind = 'message',
): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT s.apns_token, s.muted_account_ids, s.muted_push_kinds, s.expires_at, s.staff_id, m.role
         FROM app_sessions s INNER JOIN staff_members m ON m.id = s.staff_id
        WHERE s.revoked_at IS NULL AND s.apns_token IS NOT NULL AND s.apns_token != ''
          AND m.is_active = 1
        ORDER BY s.last_used_at DESC, s.created_at DESC`,
    )
    .all<SessionRow>();

  const allowedCache = new Map<string, boolean>();
  const canSee = async (staffId: string, role: string | null): Promise<boolean> => {
    const cached = allowedCache.get(staffId);
    if (cached !== undefined) return cached;
    let ok: boolean;
    if (role === 'owner' || staffId === 'env-owner') {
      ok = true;
    } else {
      const allowed = await getStaffAllowedAccountIds(db, staffId);
      // null = 制限なし(全アカウント)/ 配列 = その中だけ([] は何も見られない)
      ok = allowed === null ? true : accountId !== null && allowed.includes(accountId);
    }
    allowedCache.set(staffId, ok);
    return ok;
  };

  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const row of rows.results ?? []) {
    if (tokens.length >= MAX_DEVICES_PER_NOTIFICATION) break;
    if (Date.parse(row.expires_at) <= now) continue;
    // この端末が、この公式アカウントの通知を止めている
    if (accountId !== null && parseMutedAccountIds(row.muted_account_ids).includes(accountId)) continue;
    // この端末が、この種類(メッセージ・フォームの回答など)の通知を止めている
    if (parseMutedPushKinds(row.muted_push_kinds).includes(kind)) continue;
    if (seen.has(row.apns_token)) continue;
    if (!(await canSee(row.staff_id, row.role))) continue;
    seen.add(row.apns_token);
    tokens.push(row.apns_token);
  }
  return tokens;
}

function pickName(f: { real_name: string | null; system_display_name: string | null; display_name: string | null } | null): string {
  return f?.real_name?.trim() || f?.system_display_name?.trim() || f?.display_name || '名前なし';
}

interface PushJob {
  kind: AppPushKind;
  friendId: string;
  accountId: string | null;
  friendName?: string | null;
  body: string;
}

async function sendPush(env: ApnsEnv, db: D1Database, job: PushJob, options: ApnsSendOptions): Promise<void> {
  const config = getApnsConfig(env);
  if (!config) return;
  try {
    const now = (options.now ?? Date.now)();
    const tokens = await resolvePushRecipients(db, job.accountId, now, job.kind);
    if (tokens.length === 0) return;

    let title = job.friendName?.trim() || '';
    if (!title) {
      const friend = await db
        .prepare('SELECT real_name, system_display_name, display_name FROM friends WHERE id = ?')
        .bind(job.friendId)
        .first<{ real_name: string | null; system_display_name: string | null; display_name: string | null }>();
      title = pickName(friend);
    }
    const account = job.accountId
      ? await db.prepare('SELECT name FROM line_accounts WHERE id = ?').bind(job.accountId).first<{ name: string | null }>()
      : null;
    const chat = await db
      .prepare('SELECT id FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(job.friendId)
      .first<{ id: string }>();
    const chatId = chat?.id ?? null;

    const alert = {
      title,
      ...(account?.name?.trim() ? { subtitle: account.name.trim() } : {}),
      body: job.body,
      threadId: job.friendId,
      collapseId: chatId ?? job.friendId,
      data: { chatId, accountId: job.accountId, friendId: job.friendId },
    };

    const results = await Promise.all(
      tokens.map(async (token) => ({ token, result: await sendApnsAlert(config, token, alert, options) })),
    );
    for (const { token, result } of results) {
      if (result.invalidToken) await clearInvalidApnsToken(db, token);
    }
  } catch (err) {
    console.error('[push-notify] 通知に失敗', err instanceof Error ? err.message : 'error');
  }
}

export async function notifyIncomingMessage(
  env: ApnsEnv,
  db: D1Database,
  notice: IncomingMessageNotice,
  options: ApnsSendOptions = {},
): Promise<void> {
  await sendPush(
    env,
    db,
    { kind: 'message', friendId: notice.friendId, accountId: notice.accountId, friendName: notice.friendName, body: describeMessageForPush(notice.messageType, notice.content) },
    options,
  );
}

export interface FormAnsweredNotice {
  friendId: string;
  accountId: string | null;
  formName: string;
}

/** フォームの本文(通知に出す1行) */
export function describeFormAnswered(formName: string): string {
  const name = Array.from(formName.replace(/\s+/g, ' ').trim());
  const clipped = name.length > 40 ? `${name.slice(0, 40).join('')}…` : name.join('');
  return clipped ? `フォーム「${clipped}」に回答がありました` : 'フォームに回答がありました';
}

/** お客様がフォームに回答したとき、アプリの端末に通知する(「フォームの回答」を止めている端末には送らない) */
export async function notifyFormAnswered(
  env: ApnsEnv,
  db: D1Database,
  notice: FormAnsweredNotice,
  options: ApnsSendOptions = {},
): Promise<void> {
  await sendPush(
    env,
    db,
    { kind: 'form_answered', friendId: notice.friendId, accountId: notice.accountId, body: describeFormAnswered(notice.formName) },
    options,
  );
}
