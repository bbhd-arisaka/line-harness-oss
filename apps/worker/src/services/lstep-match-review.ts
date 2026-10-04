import { ImportError } from './lstep-import.js';

/**
 * Lステップ引き継ぎで「照合できなかった人」を、画面で確認するための記録(オーナー専用)。
 * 照合そのものは取り込みの作業で行い、その結果のうち確認が要る人だけをここへ入れる。
 */

export type ReviewSide = 'beyond' | 'lstep';
export type ReviewReason = 'no_lstep' | 'ambiguous' | 'name_only' | 'no_beyond';

export interface ReviewItemInput {
  side: ReviewSide;
  friendId: string | null;
  lstepId: string | null;
  name: string;
  pictureUrl: string | null;
  addedAt: string | null;
  reason: ReviewReason;
  detail: string | null;
}

const SIDES: readonly ReviewSide[] = ['beyond', 'lstep'];
const REASONS: readonly ReviewReason[] = ['no_lstep', 'ambiguous', 'name_only', 'no_beyond'];
const MAX_ITEMS = 500;
const COLUMNS = 'id, side, friend_id, lstep_id, name, picture_url, added_at, reason, detail, status, note, resolved_by, resolved_at';

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null);

export function validateReviewItems(x: unknown): ReviewItemInput[] {
  if (!Array.isArray(x)) throw new ImportError('items は配列で指定してください');
  if (x.length > MAX_ITEMS) throw new ImportError(`一度に登録できるのは${MAX_ITEMS}件までです`);
  return x.map((it: Record<string, unknown>) => {
    const side = it?.side as ReviewSide;
    const reason = it?.reason as ReviewReason;
    if (!SIDES.includes(side)) throw new ImportError('side が不正です');
    if (!REASONS.includes(reason)) throw new ImportError('reason が不正です');
    const friendId = text(it.friendId, 64);
    const lstepId = text(it.lstepId, 32);
    if (side === 'beyond' && !friendId) throw new ImportError('beyond側の項目には friendId が必要です');
    if (side === 'lstep' && !lstepId) throw new ImportError('lstep側の項目には lstepId が必要です');
    const pictureUrl = text(it.pictureUrl, 500);
    if (pictureUrl && !/^https:\/\//.test(pictureUrl)) throw new ImportError('pictureUrl は https のURLにしてください');
    return {
      side,
      friendId,
      lstepId,
      name: text(it.name, 200) ?? '(名前なし)',
      pictureUrl,
      addedAt: text(it.addedAt, 40),
      reason,
      detail: text(it.detail, 500),
    };
  });
}

type KeyRow = { side: string; friend_id: string | null; lstep_id: string | null };
const keyOf = (r: KeyRow) => `${r.side}|${r.side === 'beyond' ? r.friend_id : r.lstep_id}`;

/** 確認リストを入れ替える。確認済みにした人は、そのまま残す(同じ人を未確認に戻さない)。 */
export async function replaceReviewItems(
  db: D1Database,
  accountId: string,
  items: ReviewItemInput[],
): Promise<{ inserted: number; keptResolved: number }> {
  const account = await db.prepare('SELECT id FROM line_accounts WHERE id = ?').bind(accountId).first();
  if (!account) throw new ImportError('LINEアカウントが見つかりません', 404);
  const existing =
    (
      await db
        .prepare('SELECT side, friend_id, lstep_id FROM lstep_match_review WHERE line_account_id = ? AND status = ?')
        .bind(accountId, 'resolved')
        .all<KeyRow>()
    ).results ?? [];
  const resolved = new Set(existing.map(keyOf));
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM lstep_match_review WHERE line_account_id = ? AND status = 'open'").bind(accountId),
  ];
  let inserted = 0;
  for (const it of items) {
    if (resolved.has(keyOf({ side: it.side, friend_id: it.friendId, lstep_id: it.lstepId }))) continue;
    statements.push(
      db
        .prepare(
          'INSERT INTO lstep_match_review (id, line_account_id, side, friend_id, lstep_id, name, picture_url, added_at, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(crypto.randomUUID(), accountId, it.side, it.friendId, it.lstepId, it.name, it.pictureUrl, it.addedAt, it.reason, it.detail),
    );
    inserted++;
  }
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  return { inserted, keptResolved: resolved.size };
}

export interface ReviewRow {
  id: string;
  side: ReviewSide;
  friend_id: string | null;
  lstep_id: string | null;
  name: string;
  picture_url: string | null;
  added_at: string | null;
  reason: ReviewReason;
  detail: string | null;
  status: 'open' | 'resolved';
  note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

export async function listReviewItems(db: D1Database, accountId: string): Promise<ReviewRow[]> {
  const rows = await db
    .prepare(`SELECT ${COLUMNS} FROM lstep_match_review WHERE line_account_id = ? ORDER BY side, reason, name`)
    .bind(accountId)
    .all<ReviewRow>();
  return rows.results ?? [];
}

export async function updateReviewItem(
  db: D1Database,
  id: string,
  status: unknown,
  note: unknown,
  staffName: string,
): Promise<ReviewRow> {
  if (status !== 'open' && status !== 'resolved') throw new ImportError('status は open か resolved で指定してください');
  const memo = typeof note === 'string' && note !== '' ? note.slice(0, 500) : null;
  const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00');
  const res = await db
    .prepare('UPDATE lstep_match_review SET status = ?, note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
    .bind(status, memo, status === 'resolved' ? staffName : null, status === 'resolved' ? now : null, id)
    .run();
  if (!res.meta.changes) throw new ImportError('項目が見つかりません', 404);
  return (await db.prepare(`SELECT ${COLUMNS} FROM lstep_match_review WHERE id = ?`).bind(id).first<ReviewRow>())!;
}
