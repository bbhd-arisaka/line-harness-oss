import { ImportError } from './lstep-import.js';

/**
 * Lステップ引き継ぎで「照合できなかった人」「名前だけで結びつけた人」を、画面で確認するための記録(オーナー専用)。
 * 照合そのものは取り込みの作業で行い、その結果のうち確認が要る人だけをここへ入れる。
 *
 * 各行は「誰と誰を結びつけたか」を partner_* に持つ:
 *   side='beyond' の行 … partner は Lステップの人(名前だけで結びつけた相手 / 手で紐付けた相手)
 *   side='lstep'  の行 … partner は beyond line の友だち(手で紐付けた相手)
 * decision: NULL=未判断 / 'same'=同じ人と確認 / 'different'=別の人(要修正) / 'link'=手で紐付け(Lステップ側データの移行待ち)
 */

export type ReviewSide = 'beyond' | 'lstep';
export type ReviewReason = 'no_lstep' | 'ambiguous' | 'name_only' | 'no_beyond';
export type ReviewDecision = 'same' | 'different' | 'link';

export interface ReviewItemInput {
  side: ReviewSide;
  friendId: string | null;
  lstepId: string | null;
  name: string;
  pictureUrl: string | null;
  addedAt: string | null;
  reason: ReviewReason;
  detail: string | null;
  partnerId: string | null;
  partnerName: string | null;
  partnerPictureUrl: string | null;
  /** LINE名と、本名(Lステップでは表示名)。名前の見分け用 */
  lineName: string | null;
  realName: string | null;
  partnerLineName: string | null;
  partnerRealName: string | null;
}

const SIDES: readonly ReviewSide[] = ['beyond', 'lstep'];
const REASONS: readonly ReviewReason[] = ['no_lstep', 'ambiguous', 'name_only', 'no_beyond'];
const DECISIONS: readonly ReviewDecision[] = ['same', 'different', 'link'];
const MAX_ITEMS = 500;
const COLUMNS =
  'id, side, friend_id, lstep_id, name, picture_url, added_at, reason, detail, status, note, resolved_by, resolved_at, partner_id, partner_name, partner_picture_url, decision, line_name, real_name, partner_line_name, partner_real_name';

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null);
const httpsUrl = (v: unknown): string | null => {
  const s = text(v, 500);
  if (s && !/^https:\/\//.test(s)) throw new ImportError('画像のURLは https のものにしてください');
  return s;
};

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
    return {
      side,
      friendId,
      lstepId,
      name: text(it.name, 200) ?? '(名前なし)',
      pictureUrl: httpsUrl(it.pictureUrl),
      addedAt: text(it.addedAt, 40),
      reason,
      detail: text(it.detail, 500),
      partnerId: text(it.partnerId, 64),
      partnerName: text(it.partnerName, 200),
      partnerPictureUrl: httpsUrl(it.partnerPictureUrl),
      lineName: text(it.lineName, 200),
      realName: text(it.realName, 200),
      partnerLineName: text(it.partnerLineName, 200),
      partnerRealName: text(it.partnerRealName, 200),
    };
  });
}

type KeyRow = { side: string; friend_id: string | null; lstep_id: string | null };
const keyOf = (r: KeyRow) => `${r.side}|${r.side === 'beyond' ? r.friend_id : r.lstep_id}`;

/**
 * 確認リストを入れ替える。確認済み・「別の人」と判断した・手で紐付けた行は、そのまま残す
 * (同じ人を未判断に戻さない / 作業の途中の判断を消さない)。
 */
export async function replaceReviewItems(
  db: D1Database,
  accountId: string,
  items: ReviewItemInput[],
): Promise<{ inserted: number; kept: number }> {
  const account = await db.prepare('SELECT id FROM line_accounts WHERE id = ?').bind(accountId).first();
  if (!account) throw new ImportError('LINEアカウントが見つかりません', 404);
  const kept =
    (
      await db
        .prepare("SELECT side, friend_id, lstep_id FROM lstep_match_review WHERE line_account_id = ? AND (status = 'resolved' OR decision IS NOT NULL)")
        .bind(accountId)
        .all<KeyRow>()
    ).results ?? [];
  const keptKeys = new Set(kept.map(keyOf));
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM lstep_match_review WHERE line_account_id = ? AND status = 'open' AND decision IS NULL").bind(accountId),
  ];
  let inserted = 0;
  for (const it of items) {
    if (keptKeys.has(keyOf({ side: it.side, friend_id: it.friendId, lstep_id: it.lstepId }))) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO lstep_match_review
             (id, line_account_id, side, friend_id, lstep_id, name, picture_url, added_at, reason, detail, partner_id, partner_name, partner_picture_url,
              line_name, real_name, partner_line_name, partner_real_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), accountId, it.side, it.friendId, it.lstepId, it.name, it.pictureUrl, it.addedAt, it.reason, it.detail, it.partnerId, it.partnerName, it.partnerPictureUrl, it.lineName, it.realName, it.partnerLineName, it.partnerRealName),
    );
    inserted++;
  }
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  return { inserted, kept: keptKeys.size };
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
  partner_id: string | null;
  partner_name: string | null;
  partner_picture_url: string | null;
  decision: ReviewDecision | null;
  line_name: string | null;
  real_name: string | null;
  partner_line_name: string | null;
  partner_real_name: string | null;
}

export async function listReviewItems(db: D1Database, accountId: string): Promise<ReviewRow[]> {
  const rows = await db
    .prepare(`SELECT ${COLUMNS} FROM lstep_match_review WHERE line_account_id = ? ORDER BY side, reason, name`)
    .bind(accountId)
    .all<ReviewRow>();
  return rows.results ?? [];
}

async function getRow(db: D1Database, id: string): Promise<ReviewRow> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM lstep_match_review WHERE id = ?`).bind(id).first<ReviewRow>();
  if (!row) throw new ImportError('項目が見つかりません', 404);
  return row;
}

const jstNow = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00');

/** 確認済み/未確認の切り替え、「同じ人」「別の人」の判断、メモ。 */
export async function updateReviewItem(
  db: D1Database,
  id: string,
  input: { status?: unknown; note?: unknown; decision?: unknown },
  staffName: string,
): Promise<ReviewRow> {
  const row = await getRow(db, id);
  const status = input.status ?? row.status;
  if (status !== 'open' && status !== 'resolved') throw new ImportError('status は open か resolved で指定してください');
  let decision: ReviewDecision | null = row.decision;
  if (input.decision !== undefined) {
    if (input.decision !== null && !(DECISIONS as readonly unknown[]).includes(input.decision)) throw new ImportError('decision が不正です');
    if (input.decision === 'link') throw new ImportError('紐付けは、紐付け用の操作で行ってください');
    decision = input.decision as ReviewDecision | null;
  }
  const memo = input.note === undefined ? row.note : typeof input.note === 'string' && input.note !== '' ? input.note.slice(0, 500) : null;
  await db
    .prepare('UPDATE lstep_match_review SET status = ?, note = ?, decision = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
    .bind(status, memo, decision, status === 'resolved' ? staffName : null, status === 'resolved' ? jstNow() : null, id)
    .run();
  return getRow(db, id);
}

/** beyond line の友だち(side='beyond')と Lステップの人(side='lstep')を、手で結びつける。両方の行に相手を記録する。 */
export async function linkReviewItems(db: D1Database, id: string, partnerRowId: unknown): Promise<{ a: ReviewRow; b: ReviewRow }> {
  if (typeof partnerRowId !== 'string' || !partnerRowId) throw new ImportError('partnerRowId を指定してください');
  const a = await getRow(db, id);
  const b = await getRow(db, partnerRowId);
  if (a.side === b.side) throw new ImportError('beyond line の友だちと、Lステップの人を1人ずつ選んでください');
  const accounts = await db
    .prepare('SELECT line_account_id FROM lstep_match_review WHERE id IN (?, ?)')
    .bind(a.id, b.id)
    .all<{ line_account_id: string }>();
  if (new Set((accounts.results ?? []).map((r) => r.line_account_id)).size !== 1) throw new ImportError('別のアカウントの人とは結びつけられません');
  for (const r of [a, b]) {
    if (r.decision === 'link') throw new ImportError(`「${r.name}」はすでに紐付け済みです。先に解除してください`);
    if (r.status === 'resolved') throw new ImportError(`「${r.name}」は確認済みのため、紐付けられません`);
  }
  const [beyond, lstep] = a.side === 'beyond' ? [a, b] : [b, a];
  await db.batch([
    db
      .prepare("UPDATE lstep_match_review SET partner_id = ?, partner_name = ?, partner_picture_url = ?, partner_line_name = ?, partner_real_name = ?, decision = 'link' WHERE id = ?")
      .bind(lstep.lstep_id, lstep.name, lstep.picture_url, lstep.line_name, lstep.real_name, beyond.id),
    db
      .prepare("UPDATE lstep_match_review SET partner_id = ?, partner_name = ?, partner_picture_url = ?, partner_line_name = ?, partner_real_name = ?, decision = 'link' WHERE id = ?")
      .bind(beyond.friend_id, beyond.name, beyond.picture_url, beyond.line_name, beyond.real_name, lstep.id),
  ]);
  return { a: await getRow(db, a.id), b: await getRow(db, b.id) };
}

/** 手で結びつけたのを解除する(相手の行も一緒に戻す)。 */
export async function unlinkReviewItem(db: D1Database, id: string): Promise<ReviewRow[]> {
  const row = await getRow(db, id);
  if (row.decision !== 'link') throw new ImportError('紐付けされていません');
  const other = await db
    .prepare(
      `SELECT id FROM lstep_match_review
        WHERE decision = 'link' AND id != ? AND side != ?
          AND line_account_id = (SELECT line_account_id FROM lstep_match_review WHERE id = ?)
          AND partner_id = ?`,
    )
    .bind(row.id, row.side, row.id, row.side === 'beyond' ? row.friend_id : row.lstep_id)
    .first<{ id: string }>();
  const ids = [row.id, ...(other ? [other.id] : [])];
  await db.batch(
    ids.map((x) =>
      db.prepare('UPDATE lstep_match_review SET partner_id = NULL, partner_name = NULL, partner_picture_url = NULL, partner_line_name = NULL, partner_real_name = NULL, decision = NULL WHERE id = ?').bind(x),
    ),
  );
  return Promise.all(ids.map((x) => getRow(db, x)));
}
