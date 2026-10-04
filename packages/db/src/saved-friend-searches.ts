import { jstNow } from './utils.js';

export interface SavedFriendSearch {
  id: string;
  line_account_id: string;
  name: string;
  filter: string; // JSON
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listSavedFriendSearches(db: D1Database, lineAccountId: string): Promise<SavedFriendSearch[]> {
  const r = await db
    .prepare('SELECT * FROM saved_friend_searches WHERE line_account_id = ? ORDER BY created_at DESC')
    .bind(lineAccountId)
    .all<SavedFriendSearch>();
  return r.results ?? [];
}

export async function getSavedFriendSearch(db: D1Database, id: string): Promise<SavedFriendSearch | null> {
  return db.prepare('SELECT * FROM saved_friend_searches WHERE id = ?').bind(id).first<SavedFriendSearch>();
}

export async function createSavedFriendSearch(
  db: D1Database,
  input: { lineAccountId: string; name: string; filter: string; createdBy: string | null },
): Promise<SavedFriendSearch> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare('INSERT INTO saved_friend_searches (id, line_account_id, name, filter, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, input.lineAccountId, input.name, input.filter, input.createdBy, now, now)
    .run();
  return (await getSavedFriendSearch(db, id))!;
}

export async function deleteSavedFriendSearch(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM saved_friend_searches WHERE id = ?').bind(id).run();
}
