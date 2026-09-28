import { jstNow } from './utils.js';
// =============================================================================
// Friend field definitions — Lステップ「友だち情報欄管理」相当
// =============================================================================

export interface FriendFieldFolder {
  id: string;
  name: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface FriendFieldDefinition {
  id: string;
  folder_id: string | null;
  field_key: string;
  label: string;
  field_type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'radio' | 'checkbox';
  options: string | null; // JSON配列文字列。select/radio/checkboxのときのみ使う
  default_value: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// ── Folders ──────────────────────────────────────────────────────────────────

export async function getFriendFieldFolders(db: D1Database): Promise<FriendFieldFolder[]> {
  const result = await db
    .prepare(`SELECT * FROM friend_field_folders ORDER BY display_order ASC, created_at ASC`)
    .all<FriendFieldFolder>();
  return result.results;
}

export interface CreateFriendFieldFolderInput {
  name: string;
  displayOrder?: number;
}

export async function createFriendFieldFolder(
  db: D1Database,
  input: CreateFriendFieldFolderInput,
): Promise<FriendFieldFolder> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO friend_field_folders (id, name, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, input.displayOrder ?? 0, now, now)
    .run();
  return (await db
    .prepare(`SELECT * FROM friend_field_folders WHERE id = ?`)
    .bind(id)
    .first<FriendFieldFolder>())!;
}

export interface UpdateFriendFieldFolderInput {
  name?: string;
  displayOrder?: number;
}

export async function updateFriendFieldFolder(
  db: D1Database,
  id: string,
  input: UpdateFriendFieldFolderInput,
): Promise<FriendFieldFolder | null> {
  const existing = await db
    .prepare(`SELECT * FROM friend_field_folders WHERE id = ?`)
    .bind(id)
    .first<FriendFieldFolder>();
  if (!existing) return null;

  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_field_folders SET name = ?, display_order = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      input.name ?? existing.name,
      input.displayOrder ?? existing.display_order,
      now,
      id,
    )
    .run();
  return db
    .prepare(`SELECT * FROM friend_field_folders WHERE id = ?`)
    .bind(id)
    .first<FriendFieldFolder>();
}

export async function deleteFriendFieldFolder(db: D1Database, id: string): Promise<void> {
  // D1 は FK 制約を強制しないため、先に所属する項目の folder_id を手動で外す。
  await db.batch([
    db.prepare(`UPDATE friend_field_definitions SET folder_id = NULL WHERE folder_id = ?`).bind(id),
    db.prepare(`DELETE FROM friend_field_folders WHERE id = ?`).bind(id),
  ]);
}

// ── Definitions ──────────────────────────────────────────────────────────────

export async function getFriendFieldDefinitions(db: D1Database): Promise<FriendFieldDefinition[]> {
  const result = await db
    .prepare(`SELECT * FROM friend_field_definitions ORDER BY display_order ASC, created_at ASC`)
    .all<FriendFieldDefinition>();
  return result.results;
}

export async function getFriendFieldDefinitionByKey(
  db: D1Database,
  fieldKey: string,
): Promise<FriendFieldDefinition | null> {
  return db
    .prepare(`SELECT * FROM friend_field_definitions WHERE field_key = ?`)
    .bind(fieldKey)
    .first<FriendFieldDefinition>();
}

export interface CreateFriendFieldDefinitionInput {
  folderId?: string | null;
  fieldKey: string;
  label: string;
  fieldType?: FriendFieldDefinition['field_type'];
  options?: string[] | null;
  defaultValue?: string | null;
  displayOrder?: number;
}

export async function createFriendFieldDefinition(
  db: D1Database,
  input: CreateFriendFieldDefinitionInput,
): Promise<FriendFieldDefinition> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO friend_field_definitions
         (id, folder_id, field_key, label, field_type, options, default_value, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.folderId ?? null,
      input.fieldKey,
      input.label,
      input.fieldType ?? 'text',
      input.options ? JSON.stringify(input.options) : null,
      input.defaultValue ?? null,
      input.displayOrder ?? 0,
      now,
      now,
    )
    .run();
  return (await db
    .prepare(`SELECT * FROM friend_field_definitions WHERE id = ?`)
    .bind(id)
    .first<FriendFieldDefinition>())!;
}

export interface UpdateFriendFieldDefinitionInput {
  folderId?: string | null;
  label?: string;
  fieldType?: FriendFieldDefinition['field_type'];
  options?: string[] | null;
  defaultValue?: string | null;
  displayOrder?: number;
}

export async function updateFriendFieldDefinition(
  db: D1Database,
  id: string,
  input: UpdateFriendFieldDefinitionInput,
): Promise<FriendFieldDefinition | null> {
  const existing = await db
    .prepare(`SELECT * FROM friend_field_definitions WHERE id = ?`)
    .bind(id)
    .first<FriendFieldDefinition>();
  if (!existing) return null;

  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_field_definitions
       SET folder_id = ?, label = ?, field_type = ?, options = ?, default_value = ?, display_order = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      'folderId' in input ? (input.folderId ?? null) : existing.folder_id,
      input.label ?? existing.label,
      input.fieldType ?? existing.field_type,
      'options' in input ? (input.options ? JSON.stringify(input.options) : null) : existing.options,
      'defaultValue' in input ? (input.defaultValue ?? null) : existing.default_value,
      input.displayOrder ?? existing.display_order,
      now,
      id,
    )
    .run();
  return db
    .prepare(`SELECT * FROM friend_field_definitions WHERE id = ?`)
    .bind(id)
    .first<FriendFieldDefinition>();
}

export async function deleteFriendFieldDefinition(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM friend_field_definitions WHERE id = ?`).bind(id).run();
}
