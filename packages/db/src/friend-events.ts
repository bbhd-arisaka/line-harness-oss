// 友だちごとの「出来事のログ」。トークの履歴に、中央の小さな行として表示する。
// 記録に失敗しても元の処理(タグ付け・フォーム回答など)は失敗させない。
import { jstNow } from './utils.js';

export type FriendEventType =
  | 'tag_added'
  | 'tag_removed'
  | 'blocked'
  | 'unblocked'
  | 'followed'
  | 'form_submitted'
  | 'friend_info_changed'
  | 'profile_changed';

export interface RecordFriendEventInput {
  friendId: string;
  lineAccountId?: string | null;
  type: FriendEventType | string;
  /** 表示用の日本語(完成形)。値そのもの(個人情報)は入れない */
  text: string;
  /** 「スタッフ名」「システム」「フォーム」「自動」「LINE」など。表示用 */
  actor?: string | null;
  detail?: Record<string, unknown> | unknown[] | null;
}

export interface FriendEvent {
  id: string;
  friend_id: string;
  line_account_id: string | null;
  event_type: string;
  text: string;
  actor: string | null;
  detail: string | null;
  created_at: string;
}

export async function recordFriendEvent(db: D1Database, input: RecordFriendEventInput): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO friend_events (id, friend_id, line_account_id, event_type, text, actor, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.friendId,
        input.lineAccountId ?? null,
        input.type,
        input.text,
        input.actor ?? null,
        input.detail == null ? null : JSON.stringify(input.detail),
        jstNow(),
      )
      .run();
  } catch (error) {
    console.error('friend event record failed:', error);
  }
}

/** 新しい limit 件(既定500)を、時刻の昇順で返す。取得に失敗したら空配列 */
export async function listFriendEvents(
  db: D1Database,
  friendId: string,
  options: { limit?: number } = {},
): Promise<FriendEvent[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 500, 500));
  try {
    const result = await db
      .prepare(
        `SELECT id, friend_id, line_account_id, event_type, text, actor, detail, created_at FROM (
           SELECT rowid AS rid, * FROM friend_events WHERE friend_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
         ) ORDER BY created_at ASC, rid ASC`,
      )
      .bind(friendId, limit)
      .all<FriendEvent>();
    return result.results ?? [];
  } catch (error) {
    console.error('friend event list failed:', error);
    return [];
  }
}

/** 変更した項目名を「A」「B」の形にまとめる */
export function quoteLabels(labels: string[]): string {
  return labels.map((l) => `「${l}」`).join('');
}

/** metadata の変更(patch)のうち、実際に値が変わったキーだけを返す。null は削除 */
export function changedMetadataKeys(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const next = value === null || value === undefined ? undefined : JSON.stringify(value);
    const prev = before[key] === null || before[key] === undefined ? undefined : JSON.stringify(before[key]);
    if (next !== prev) keys.push(key);
  }
  return keys;
}

/**
 * 友だち情報欄のキーを、定義(friend_field_definitions)のラベルへ引く。
 * 定義が無いキーは、onlyDefined なら除き、そうでなければキー名のまま使う。
 */
export async function resolveFriendFieldLabels(
  db: D1Database,
  keys: string[],
  options: { onlyDefined?: boolean } = {},
): Promise<string[]> {
  if (keys.length === 0) return [];
  const labels = new Map<string, string>();
  try {
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = keys.slice(i, i + 50);
      const rows = await db
        .prepare(
          `SELECT field_key, label FROM friend_field_definitions WHERE field_key IN (${chunk.map(() => '?').join(',')})`,
        )
        .bind(...chunk)
        .all<{ field_key: string; label: string }>();
      for (const r of rows.results ?? []) labels.set(r.field_key, r.label);
    }
  } catch (error) {
    console.error('friend field label lookup failed:', error);
  }
  const out: string[] = [];
  for (const key of keys) {
    const label = labels.get(key);
    if (label) out.push(label);
    else if (!options.onlyDefined) out.push(key);
  }
  return out;
}

/** 友だち情報欄の変更を1件のログにする(値は入れない。項目名の配列だけ detail に持つ) */
export async function recordFriendInfoChanged(
  db: D1Database,
  input: {
    friendId: string;
    lineAccountId?: string | null;
    keys: string[];
    actor?: string | null;
    onlyDefined?: boolean;
  },
): Promise<void> {
  try {
    if (input.keys.length === 0) return;
    const labels = await resolveFriendFieldLabels(db, input.keys, { onlyDefined: input.onlyDefined });
    if (labels.length === 0) return;
    await recordFriendEvent(db, {
      friendId: input.friendId,
      lineAccountId: input.lineAccountId ?? null,
      type: 'friend_info_changed',
      text: `友だち情報${quoteLabels(labels)}を変更しました`,
      actor: input.actor ?? null,
      detail: { fields: labels },
    });
  } catch (error) {
    console.error('friend info event failed:', error);
  }
}

/** 本名・システム表示名・表示名・個別メモの変更を1件のログにする */
export async function recordProfileChanged(
  db: D1Database,
  input: { friendId: string; lineAccountId?: string | null; labels: string[]; actor?: string | null },
): Promise<void> {
  if (input.labels.length === 0) return;
  await recordFriendEvent(db, {
    friendId: input.friendId,
    lineAccountId: input.lineAccountId ?? null,
    type: 'profile_changed',
    text: `${input.labels.join('・')}を変更しました`,
    actor: input.actor ?? null,
    detail: { fields: input.labels },
  });
}
