/**
 * スタッフごとのアカウント権限。
 * staff_account_access に行があるスタッフは、その公式アカウントだけを扱える。
 * 行が無い(=制限なし)スタッフは null を返し、全アカウントを扱える。
 */

/** 制限があればアカウントIDの配列、制限なし(全アカウント)なら null。 */
export async function getStaffAllowedAccountIds(
  db: D1Database,
  staffId: string,
): Promise<string[] | null> {
  const result = await db
    .prepare('SELECT line_account_id FROM staff_account_access WHERE staff_id = ?')
    .bind(staffId)
    .all<{ line_account_id: string }>();
  const ids = (result.results ?? []).map((r) => r.line_account_id);
  return ids.length > 0 ? ids : null;
}

/** 全スタッフ分の制限をまとめて取得(制限なしのスタッフはキーが無い)。 */
export async function getAllStaffAccountAccess(
  db: D1Database,
): Promise<Map<string, string[]>> {
  const result = await db
    .prepare('SELECT staff_id, line_account_id FROM staff_account_access ORDER BY created_at ASC')
    .all<{ staff_id: string; line_account_id: string }>();
  const map = new Map<string, string[]>();
  for (const row of result.results ?? []) {
    const list = map.get(row.staff_id) ?? [];
    list.push(row.line_account_id);
    map.set(row.staff_id, list);
  }
  return map;
}

/**
 * スタッフの見られるアカウントを置き換える。空配列 = 制限なし(全アカウント)。
 * 存在しないアカウントIDは無視する。
 */
export async function setStaffAccountAccess(
  db: D1Database,
  staffId: string,
  accountIds: string[],
): Promise<string[] | null> {
  const unique = [...new Set(accountIds)];
  const statements = [
    db.prepare('DELETE FROM staff_account_access WHERE staff_id = ?').bind(staffId),
    ...unique.map((accountId) =>
      db
        .prepare(
          `INSERT INTO staff_account_access (staff_id, line_account_id)
           SELECT ?, id FROM line_accounts WHERE id = ?`,
        )
        .bind(staffId, accountId),
    ),
  ];
  await db.batch(statements);
  return getStaffAllowedAccountIds(db, staffId);
}
