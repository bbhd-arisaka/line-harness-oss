import { LineClient } from '@line-crm/line-sdk';

/**
 * 友だちのプロフィール(画像・ステータスメッセージ)を、LINEから取り直す。
 *
 * LINEのプロフィール画像のURLは、時間がたつと見られなくなることがある(本人が画像を変えたとき等)。
 * 登録時に1回だけ取っていると、チャットや友だち一覧の画像が出なくなるため、
 *  - 定期的に(古い順に少しずつ) refreshStaleProfiles で取り直す
 *  - 画面で画像が出なかったときに、その人だけ refreshFriendProfile で取り直す
 * 名前(display_name)は、空のときだけ埋める(別の名前に付け替えている人の名前を上書きしないため)。
 * 取り直した日時は、成功・失敗(ブロック済みで取れない等)にかかわらず記録する(同じ人で止まらないように)。
 */
export interface RefreshResult {
  ok: boolean;
  pictureUrl: string | null;
  displayName: string | null;
  /** 取れなかったときの理由(ブロック済み・LINEの認証エラーなど) */
  reason?: string;
}

const NOW_JST = "strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')";

export async function refreshFriendProfile(
  db: D1Database,
  friend: { id: string; line_user_id: string },
  accessToken: string,
  fetchProfile?: (userId: string) => Promise<{ displayName?: string; pictureUrl?: string; statusMessage?: string }>,
): Promise<RefreshResult> {
  try {
    const profile = await (fetchProfile ? fetchProfile(friend.line_user_id) : new LineClient(accessToken).getProfile(friend.line_user_id));
    await db
      .prepare(
        `UPDATE friends
            SET picture_url = ?,
                status_message = ?,
                display_name = CASE WHEN display_name IS NULL OR display_name = '' THEN ? ELSE display_name END,
                profile_checked_at = ${NOW_JST}
          WHERE id = ?`,
      )
      .bind(profile.pictureUrl ?? null, profile.statusMessage ?? null, profile.displayName ?? null, friend.id)
      .run();
    const row = await db.prepare('SELECT picture_url, display_name FROM friends WHERE id = ?').bind(friend.id).first<{ picture_url: string | null; display_name: string | null }>();
    return { ok: true, pictureUrl: row?.picture_url ?? null, displayName: row?.display_name ?? null };
  } catch (err) {
    await db.prepare(`UPDATE friends SET profile_checked_at = ${NOW_JST} WHERE id = ?`).bind(friend.id).run();
    return { ok: false, pictureUrl: null, displayName: null, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 取り直しが一番古い(または一度もしていない)友だちから、limit 人ずつ取り直す(cron から5分ごと)。
 * 取り直してから staleDays 日以内の人は、対象にしない。ブロック中の人は、LINEが返さないので対象外。
 */
export async function refreshStaleProfiles(
  db: D1Database,
  opts: { limit?: number; staleDays?: number; fallbackToken?: string; fetchProfile?: (userId: string) => Promise<{ displayName?: string; pictureUrl?: string; statusMessage?: string }> } = {},
): Promise<{ processed: number; updated: number }> {
  const limit = opts.limit ?? 20;
  const staleDays = opts.staleDays ?? 7;
  const cutoff = new Date(Date.now() + 9 * 3600 * 1000 - staleDays * 86_400_000).toISOString().slice(0, 23);
  const rows = await db
    .prepare(
      `SELECT f.id, f.line_user_id, a.channel_access_token AS token
         FROM friends f
         LEFT JOIN line_accounts a ON a.id = f.line_account_id
        WHERE f.is_following = 1 AND f.line_user_id IS NOT NULL
          AND (f.profile_checked_at IS NULL OR f.profile_checked_at < ?)
        ORDER BY f.profile_checked_at ASC
        LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<{ id: string; line_user_id: string; token: string | null }>();
  let updated = 0;
  const list = rows.results ?? [];
  for (const r of list) {
    const token = r.token ?? opts.fallbackToken ?? '';
    const res = await refreshFriendProfile(db, r, token, opts.fetchProfile);
    if (res.ok) updated++;
  }
  return { processed: list.length, updated };
}
