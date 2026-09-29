import { jstNow } from './utils.js';
export interface Friend {
  id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  status_message: string | null;
  is_following: number;
  first_followed_at?: string | null;
  current_follow_started_at?: string | null;
  last_followed_at?: string | null;
  last_unfollowed_at?: string | null;
  unfollow_count?: number;
  user_id: string | null;
  line_account_id: string | null;
  metadata: string;
  first_tracked_link_id: string | null;
  real_name?: string | null;
  system_display_name?: string | null;
  memo?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 友だちの回答フォーム書き込み先。Lステップの新形式回答フォームで
 * 「友だち情報」とは別の登録先として扱われる3種 + 友だち情報欄(カスタム項目)。
 */
export type FriendRegistrationTarget =
  | { type: 'real_name' }
  | { type: 'display_name' }
  | { type: 'memo' }
  | { type: 'friend_field'; fieldKey: string };

export async function updateFriendRegistrationFields(
  db: D1Database,
  friendId: string,
  updates: { realName?: string | null; displayName?: string | null; systemDisplayName?: string | null; memo?: string | null; metadataPatch?: Record<string, unknown> },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if ('realName' in updates) { sets.push('real_name = ?'); values.push(updates.realName ?? null); }
  if ('displayName' in updates) { sets.push('display_name = ?'); values.push(updates.displayName ?? null); }
  if ('systemDisplayName' in updates) { sets.push('system_display_name = ?'); values.push(updates.systemDisplayName ?? null); }
  if ('memo' in updates) { sets.push('memo = ?'); values.push(updates.memo ?? null); }
  if (updates.metadataPatch && Object.keys(updates.metadataPatch).length > 0) {
    const friend = await db.prepare('SELECT metadata FROM friends WHERE id = ?').bind(friendId).first<{ metadata: string }>();
    const existing = friend ? (JSON.parse(friend.metadata || '{}') as Record<string, unknown>) : {};
    const merged = { ...existing, ...updates.metadataPatch };
    sets.push('metadata = ?');
    values.push(JSON.stringify(merged));
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(friendId);
  await db.prepare(`UPDATE friends SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export interface GetFriendsOptions {
  limit?: number;
  offset?: number;
  tagId?: string;
}

export async function getFriends(
  db: D1Database,
  opts: GetFriendsOptions = {},
): Promise<Friend[]> {
  const { limit = 50, offset = 0, tagId } = opts;

  if (tagId) {
    const result = await db
      .prepare(
        `SELECT f.*
         FROM friends f
         INNER JOIN friend_tags ft ON ft.friend_id = f.id
         WHERE ft.tag_id = ?
         ORDER BY f.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(tagId, limit, offset)
      .all<Friend>();
    return result.results;
  }

  const result = await db
    .prepare(
      `SELECT * FROM friends
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<Friend>();
  return result.results;
}

/**
 * 指定 LINE アカウント内で、指定タグを持ち、現在 friend 状態 (is_following = 1)
 * の友だちの line_user_id 配列を返す。リッチメニューの bulk link 用。
 *
 * - tagId が省略された場合は account 内全員の following を返す
 * - line_user_id は LINE bulk link API の userIds に直接渡す形式 (U... 始まり)
 * - 重複は無いはず (friends.line_user_id は UNIQUE)
 */
export async function getFollowingLineUserIdsByTag(
  db: D1Database,
  accountId: string,
  tagId: string | null,
): Promise<string[]> {
  if (tagId) {
    const result = await db
      .prepare(
        `SELECT DISTINCT f.line_user_id
           FROM friends f
           INNER JOIN friend_tags ft ON ft.friend_id = f.id
          WHERE ft.tag_id = ?
            AND f.line_account_id = ?
            AND f.is_following = 1`,
      )
      .bind(tagId, accountId)
      .all<{ line_user_id: string }>();
    return (result.results ?? []).map((r) => r.line_user_id);
  }
  const result = await db
    .prepare(
      `SELECT line_user_id
         FROM friends
        WHERE line_account_id = ? AND is_following = 1`,
    )
    .bind(accountId)
    .all<{ line_user_id: string }>();
  return (result.results ?? []).map((r) => r.line_user_id);
}

/**
 * アカウント指定の friend 解決。同じ人(同一プロバイダー配下では LINE ユーザーIDが同じ)でも、
 * 公式アカウントごとに別の friend 行として扱う。アカウントを指定したら、そのアカウントの行だけを返す
 * (他アカウントの行にはフォールバックしない)。アカウント不明(null)のときだけ従来どおり先頭一致。
 */
export async function getFriendByLineUserIdForAccount(
  db: D1Database,
  lineUserId: string,
  lineAccountId: string | null,
): Promise<Friend | null> {
  if (lineAccountId) {
    return db
      .prepare(`SELECT * FROM friends WHERE line_user_id = ? AND line_account_id = ?`)
      .bind(lineUserId, lineAccountId)
      .first<Friend>();
  }
  return getFriendByLineUserId(db, lineUserId);
}

export async function getFriendByLineUserId(
  db: D1Database,
  lineUserId: string,
): Promise<Friend | null> {
  return db
    .prepare(`SELECT * FROM friends WHERE line_user_id = ?`)
    .bind(lineUserId)
    .first<Friend>();
}

export async function getFriendById(
  db: D1Database,
  id: string,
): Promise<Friend | null> {
  return db
    .prepare(`SELECT * FROM friends WHERE id = ?`)
    .bind(id)
    .first<Friend>();
}

/**
 * Set friend.first_tracked_link_id ONLY if it is currently NULL.
 * Used to authoritatively pin a friend to the campaign they entered through,
 * without ever overwriting once set. The conditional `WHERE ... IS NULL` clause
 * makes this safe against client-side ref tampering: an existing friend cannot
 * change their attribution by replaying /auth/callback or /api/liff/send-form-link
 * with a different ref.
 */
export async function setFriendFirstTrackedLinkIfNull(
  db: D1Database,
  friendId: string,
  trackedLinkId: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friends
       SET first_tracked_link_id = ?, updated_at = ?
       WHERE id = ? AND first_tracked_link_id IS NULL`,
    )
    .bind(trackedLinkId, now, friendId)
    .run();
}

export interface UpsertFriendInput {
  lineUserId: string;
  /** 友だち追加された公式アカウント。指定すると、そのアカウントの行だけを対象にする。 */
  lineAccountId?: string | null;
  displayName?: string | null;
  pictureUrl?: string | null;
  statusMessage?: string | null;
}

export async function upsertFriend(
  db: D1Database,
  input: UpsertFriendInput,
): Promise<Friend> {
  const now = jstNow();
  const existing = input.lineAccountId
    ? await getFriendByLineUserIdForAccount(db, input.lineUserId, input.lineAccountId)
    : await getFriendByLineUserId(db, input.lineUserId);

  if (existing) {
    await db
      .prepare(
        `UPDATE friends
         SET display_name = ?,
             picture_url = ?,
             status_message = ?,
             first_followed_at = COALESCE(first_followed_at, created_at),
             current_follow_started_at = CASE
               WHEN is_following = 0 OR current_follow_started_at IS NULL THEN ?
               ELSE current_follow_started_at
             END,
             last_followed_at = CASE
               WHEN is_following = 0 THEN ?
               ELSE COALESCE(last_followed_at, created_at)
             END,
             is_following = 1,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        'displayName' in input ? (input.displayName ?? null) : existing.display_name,
        'pictureUrl' in input ? (input.pictureUrl ?? null) : existing.picture_url,
        'statusMessage' in input ? (input.statusMessage ?? null) : existing.status_message,
        now,
        now,
        now,
        existing.id,
      )
      .run();

    return (await getFriendById(db, existing.id))!;
  }

  const id = crypto.randomUUID();
  // line_user_key は内部の一意キー。最初の行は LINE ユーザーID そのまま(従来と同じ)。
  // 同じ人が別アカウントにも居る場合は、アカウントIDを付けて重複を避ける。
  const lineUserKey = await allocateLineUserKey(db, input.lineUserId, input.lineAccountId ?? null);
  await db
    .prepare(
      `INSERT INTO friends
         (id, line_user_key, line_user_id, line_account_id, display_name, picture_url, status_message, is_following,
          first_followed_at, current_follow_started_at, last_followed_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      lineUserKey,
      input.lineUserId,
      input.lineAccountId ?? null,
      input.displayName ?? null,
      input.pictureUrl ?? null,
      input.statusMessage ?? null,
      now,
      now,
      now,
      now,
      now,
    )
    .run();

  return (await getFriendById(db, id))!;
}

/**
 * friends.line_user_key(内部の一意キー)を決める。
 * 未使用なら LINE ユーザーIDそのまま。別アカウントの行が使用中なら "<ID>#<アカウントID>"。
 */
export async function allocateLineUserKey(
  db: D1Database,
  lineUserId: string,
  lineAccountId: string | null,
): Promise<string> {
  const taken = await db
    .prepare(`SELECT 1 AS x FROM friends WHERE line_user_key = ?`)
    .bind(lineUserId)
    .first<{ x: number }>();
  if (!taken) return lineUserId;
  return `${lineUserId}#${lineAccountId ?? crypto.randomUUID()}`;
}

export async function updateFriendFollowStatus(
  db: D1Database,
  lineUserId: string,
  isFollowing: boolean,
  lineAccountId?: string | null,
): Promise<void> {
  const now = jstNow();
  // アカウント指定があれば、そのアカウントの友だちだけを更新する(別アカウントの行は触らない)
  const scope = lineAccountId ? ' AND line_account_id = ?' : '';
  const scopeArgs = lineAccountId ? [lineAccountId] : [];
  if (isFollowing) {
    await db
      .prepare(
        `UPDATE friends
            SET first_followed_at = COALESCE(first_followed_at, created_at),
                current_follow_started_at = CASE
                  WHEN is_following = 0 OR current_follow_started_at IS NULL THEN ?
                  ELSE current_follow_started_at
                END,
                last_followed_at = CASE WHEN is_following = 0 THEN ? ELSE last_followed_at END,
                is_following = 1, updated_at = ?
          WHERE line_user_id = ?${scope}`,
      )
      .bind(now, now, now, lineUserId, ...scopeArgs)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE friends
          SET is_following = 0,
              current_follow_started_at = NULL,
              last_unfollowed_at = CASE WHEN is_following = 1 THEN ? ELSE last_unfollowed_at END,
              unfollow_count = unfollow_count + CASE WHEN is_following = 1 THEN 1 ELSE 0 END,
              updated_at = ?
        WHERE line_user_id = ?${scope}`,
    )
    .bind(now, now, lineUserId, ...scopeArgs)
    .run();
}

/** Get merged metadata across all friend records sharing the same user_id (UUID). */
export async function getMergedMetadataByUserId(
  db: D1Database,
  userId: string,
): Promise<Record<string, unknown>> {
  const result = await db
    .prepare(
      `SELECT metadata FROM friends
       WHERE user_id = ? AND metadata IS NOT NULL AND metadata != '{}'
       ORDER BY updated_at DESC`,
    )
    .bind(userId)
    .all<{ metadata: string }>();
  const merged: Record<string, unknown> = {};
  for (const row of result.results) {
    try {
      const meta = JSON.parse(row.metadata);
      for (const [k, v] of Object.entries(meta)) {
        if (v != null && v !== '' && !(merged[k] != null && merged[k] !== '')) {
          merged[k] = v;
        }
      }
    } catch { /* skip invalid JSON */ }
  }
  return merged;
}

export async function getFriendCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM friends`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
