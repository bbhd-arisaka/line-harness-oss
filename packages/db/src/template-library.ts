import { jstNow } from './utils.js';

/**
 * テンプレート(Lステップの「テンプレート」と同じ仕様)のデータ操作。
 * 本体は templates(旧来の列はそのまま。112 で列を足した)。ここは、フォルダ・一覧・作成・複製・移動・削除・並び替え・下書き・送信者・パックの中身。
 * 「公式アカウントに結びついていない(line_account_id が NULL)旧来のテンプレート」は、どのアカウントの一覧にも出す。
 */

export interface TemplateFolder {
  id: string;
  line_account_id: string | null;
  name: string;
  display_order: number;
  created_at: string;
}

export interface TemplateFolderWithCount extends TemplateFolder {
  template_count: number;
}

export interface LibraryTemplate {
  id: string;
  name: string;
  category: string;
  message_type: string;
  message_content: string;
  line_account_id: string | null;
  folder_id: string | null;
  display_order: number;
  kind: 'standard' | 'flex' | 'pack';
  editor_type: string | null;
  editor_data: string | null;
  sender_id: string | null;
  allow_sender_override: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateInput {
  id?: string;
  name: string;
  lineAccountId: string | null;
  folderId?: string | null;
  kind: 'standard' | 'flex' | 'pack';
  editorType: string | null;
  editorData: string | null;
  messageType: string;
  messageContent: string;
  senderId?: string | null;
  allowSenderOverride?: boolean;
}

// ── フォルダ ──

export async function listTemplateFolders(db: D1Database, lineAccountId: string): Promise<TemplateFolderWithCount[]> {
  const rows = await db
    .prepare(
      `SELECT f.*, (SELECT COUNT(*) FROM templates t WHERE t.folder_id = f.id) AS template_count
         FROM template_folders f
        WHERE f.line_account_id = ? OR f.line_account_id IS NULL
        ORDER BY f.display_order, f.created_at`,
    )
    .bind(lineAccountId)
    .all<TemplateFolderWithCount>();
  return rows.results ?? [];
}

export async function getTemplateFolder(db: D1Database, id: string): Promise<TemplateFolder | null> {
  return db.prepare('SELECT * FROM template_folders WHERE id = ?').bind(id).first<TemplateFolder>();
}

export async function createTemplateFolder(db: D1Database, lineAccountId: string, name: string): Promise<TemplateFolder> {
  const id = crypto.randomUUID();
  const max = await db
    .prepare('SELECT COALESCE(MAX(display_order), 0) AS m FROM template_folders WHERE line_account_id = ?')
    .bind(lineAccountId)
    .first<{ m: number }>();
  await db
    .prepare('INSERT INTO template_folders (id, line_account_id, name, display_order, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, lineAccountId, name, (max?.m ?? 0) + 1, jstNow())
    .run();
  return (await getTemplateFolder(db, id))!;
}

export async function renameTemplateFolder(db: D1Database, id: string, name: string): Promise<TemplateFolder | null> {
  await db.prepare('UPDATE template_folders SET name = ? WHERE id = ?').bind(name, id).run();
  return getTemplateFolder(db, id);
}

/** フォルダを消す。中のテンプレートは「未分類」に移す(消さない) */
export async function deleteTemplateFolder(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('UPDATE templates SET folder_id = NULL WHERE folder_id = ?').bind(id),
    db.prepare('UPDATE template_drafts SET folder_id = NULL WHERE folder_id = ?').bind(id),
    db.prepare('DELETE FROM template_folders WHERE id = ?').bind(id),
  ]);
}

export async function reorderTemplateFolders(db: D1Database, lineAccountId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id, i) =>
      db.prepare('UPDATE template_folders SET display_order = ? WHERE id = ? AND (line_account_id = ? OR line_account_id IS NULL)').bind(i + 1, id, lineAccountId),
    ),
  );
}

// ── テンプレート一覧 ──

export interface TemplateListQuery {
  lineAccountId: string;
  /** 'none' = 未分類 / 'all' = すべて / フォルダID */
  folder: string;
  q?: string;
  limit: number;
  offset: number;
}

export async function listLibraryTemplates(db: D1Database, query: TemplateListQuery): Promise<{ items: LibraryTemplate[]; total: number }> {
  const conds: string[] = ['(t.line_account_id = ? OR t.line_account_id IS NULL)'];
  const binds: unknown[] = [query.lineAccountId];
  if (query.folder === 'none') conds.push('t.folder_id IS NULL');
  else if (query.folder !== 'all') {
    conds.push('t.folder_id = ?');
    binds.push(query.folder);
  }
  const q = (query.q ?? '').trim();
  if (q) {
    const esc = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    conds.push("(t.name LIKE ? ESCAPE '\\' OR t.message_content LIKE ? ESCAPE '\\')");
    binds.push(`%${esc}%`, `%${esc}%`);
  }
  const where = conds.join(' AND ');
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM templates t WHERE ${where}`).bind(...binds).first<{ n: number }>();
  const rows = await db
    .prepare(`SELECT t.* FROM templates t WHERE ${where} ORDER BY t.display_order, t.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, query.limit, query.offset)
    .all<LibraryTemplate>();
  return { items: rows.results ?? [], total: total?.n ?? 0 };
}

export async function countUnfiledTemplates(db: D1Database, lineAccountId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM templates WHERE (line_account_id = ? OR line_account_id IS NULL) AND folder_id IS NULL')
    .bind(lineAccountId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getLibraryTemplate(db: D1Database, id: string): Promise<LibraryTemplate | null> {
  return db.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first<LibraryTemplate>();
}

export async function createLibraryTemplate(db: D1Database, input: TemplateInput): Promise<LibraryTemplate> {
  const id = input.id ?? crypto.randomUUID();
  const now = jstNow();
  const max = await db
    .prepare('SELECT COALESCE(MAX(display_order), 0) AS m FROM templates WHERE (line_account_id = ? OR line_account_id IS NULL) AND folder_id IS ?')
    .bind(input.lineAccountId, input.folderId ?? null)
    .first<{ m: number }>();
  await db
    .prepare(
      `INSERT INTO templates (id, name, category, message_type, message_content, line_account_id, folder_id, display_order, kind,
                              editor_type, editor_data, sender_id, allow_sender_override, created_at, updated_at)
       VALUES (?, ?, 'general', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.messageType,
      input.messageContent,
      input.lineAccountId,
      input.folderId ?? null,
      (max?.m ?? 0) + 1,
      input.kind,
      input.editorType,
      input.editorData,
      input.senderId ?? null,
      input.allowSenderOverride ? 1 : 0,
      now,
      now,
    )
    .run();
  return (await getLibraryTemplate(db, id))!;
}

export async function updateLibraryTemplate(db: D1Database, id: string, input: Partial<TemplateInput>): Promise<LibraryTemplate | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };
  if (input.name !== undefined) set('name', input.name);
  if (input.folderId !== undefined) set('folder_id', input.folderId);
  if (input.editorType !== undefined) set('editor_type', input.editorType);
  if (input.editorData !== undefined) set('editor_data', input.editorData);
  if (input.messageType !== undefined) set('message_type', input.messageType);
  if (input.messageContent !== undefined) set('message_content', input.messageContent);
  if (input.senderId !== undefined) set('sender_id', input.senderId);
  if (input.allowSenderOverride !== undefined) set('allow_sender_override', input.allowSenderOverride ? 1 : 0);
  if (sets.length === 0) return getLibraryTemplate(db, id);
  set('updated_at', jstNow());
  values.push(id);
  await db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getLibraryTemplate(db, id);
}

export async function moveLibraryTemplates(db: D1Database, ids: string[], folderId: string | null): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(ids.map((id) => db.prepare('UPDATE templates SET folder_id = ?, updated_at = ? WHERE id = ?').bind(folderId, jstNow(), id)));
}

export async function deleteLibraryTemplates(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // パックの中の参照は ON DELETE SET NULL(中身の内容は残らない)ので、先に参照を外す
  await db.batch([
    ...ids.map((id) => db.prepare('DELETE FROM template_pack_items WHERE pack_id = ?').bind(id)),
    ...ids.map((id) => db.prepare('DELETE FROM templates WHERE id = ?').bind(id)),
  ]);
}

export async function reorderLibraryTemplates(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(ids.map((id, i) => db.prepare('UPDATE templates SET display_order = ? WHERE id = ?').bind(i + 1, id)));
}

/** このテンプレートを、中に参照しているパック(元のテンプレートを直したら、パックの送信内容も作り直す) */
export async function listPacksReferencing(db: D1Database, templateId: string): Promise<string[]> {
  const rows = await db.prepare('SELECT DISTINCT pack_id FROM template_pack_items WHERE template_id = ?').bind(templateId).all<{ pack_id: string }>();
  return (rows.results ?? []).map((r) => r.pack_id);
}

// ── 送信者(送信名・アイコン) ──

export interface TemplateSender {
  id: string;
  line_account_id: string | null;
  name: string;
  icon_url: string | null;
  created_at: string;
}

export async function listTemplateSenders(db: D1Database, lineAccountId: string): Promise<TemplateSender[]> {
  const rows = await db
    .prepare('SELECT * FROM template_senders WHERE line_account_id = ? OR line_account_id IS NULL ORDER BY created_at')
    .bind(lineAccountId)
    .all<TemplateSender>();
  return rows.results ?? [];
}

export async function getTemplateSender(db: D1Database, id: string): Promise<TemplateSender | null> {
  return db.prepare('SELECT * FROM template_senders WHERE id = ?').bind(id).first<TemplateSender>();
}

export async function createTemplateSender(db: D1Database, lineAccountId: string, name: string, iconUrl: string | null): Promise<TemplateSender> {
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO template_senders (id, line_account_id, name, icon_url, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, lineAccountId, name, iconUrl, jstNow()).run();
  return (await getTemplateSender(db, id))!;
}

export async function deleteTemplateSender(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('UPDATE templates SET sender_id = NULL WHERE sender_id = ?').bind(id),
    db.prepare('UPDATE template_drafts SET sender_id = NULL WHERE sender_id = ?').bind(id),
    db.prepare('DELETE FROM template_senders WHERE id = ?').bind(id),
  ]);
}

// ── 下書き ──

export interface TemplateDraft {
  id: string;
  line_account_id: string | null;
  template_id: string | null;
  kind: string;
  editor_type: string;
  name: string;
  folder_id: string | null;
  editor_data: string;
  sender_id: string | null;
  allow_sender_override: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateDraftInput {
  lineAccountId: string;
  templateId?: string | null;
  kind: string;
  editorType: string;
  name: string;
  folderId?: string | null;
  editorData: string;
  senderId?: string | null;
  allowSenderOverride?: boolean;
}

export async function listTemplateDrafts(db: D1Database, lineAccountId: string): Promise<TemplateDraft[]> {
  const rows = await db
    .prepare('SELECT * FROM template_drafts WHERE line_account_id = ? OR line_account_id IS NULL ORDER BY updated_at DESC')
    .bind(lineAccountId)
    .all<TemplateDraft>();
  return rows.results ?? [];
}

export async function getTemplateDraft(db: D1Database, id: string): Promise<TemplateDraft | null> {
  return db.prepare('SELECT * FROM template_drafts WHERE id = ?').bind(id).first<TemplateDraft>();
}

export async function saveTemplateDraft(db: D1Database, input: TemplateDraftInput, id?: string): Promise<TemplateDraft> {
  const now = jstNow();
  if (id) {
    await db
      .prepare(
        `UPDATE template_drafts SET template_id = ?, kind = ?, editor_type = ?, name = ?, folder_id = ?, editor_data = ?, sender_id = ?, allow_sender_override = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(input.templateId ?? null, input.kind, input.editorType, input.name, input.folderId ?? null, input.editorData, input.senderId ?? null, input.allowSenderOverride ? 1 : 0, now, id)
      .run();
    return (await getTemplateDraft(db, id))!;
  }
  const newId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO template_drafts (id, line_account_id, template_id, kind, editor_type, name, folder_id, editor_data, sender_id, allow_sender_override, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId, input.lineAccountId, input.templateId ?? null, input.kind, input.editorType, input.name, input.folderId ?? null, input.editorData, input.senderId ?? null, input.allowSenderOverride ? 1 : 0, now, now)
    .run();
  return (await getTemplateDraft(db, newId))!;
}

export async function deleteTemplateDrafts(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(ids.map((id) => db.prepare('DELETE FROM template_drafts WHERE id = ?').bind(id)));
}

// ── パックの中身 ──

export interface PackItem {
  id: string;
  pack_id: string;
  position: number;
  template_id: string | null;
  editor_type: string | null;
  editor_data: string | null;
  message_type: string | null;
  message_content: string | null;
  created_at: string;
}

export async function listPackItems(db: D1Database, packId: string): Promise<PackItem[]> {
  const rows = await db.prepare('SELECT * FROM template_pack_items WHERE pack_id = ? ORDER BY position, created_at').bind(packId).all<PackItem>();
  return rows.results ?? [];
}

export async function getPackItem(db: D1Database, id: string): Promise<PackItem | null> {
  return db.prepare('SELECT * FROM template_pack_items WHERE id = ?').bind(id).first<PackItem>();
}

export interface PackItemInput {
  packId: string;
  templateId?: string | null;
  editorType?: string | null;
  editorData?: string | null;
  messageType?: string | null;
  messageContent?: string | null;
}

export async function addPackItem(db: D1Database, input: PackItemInput): Promise<PackItem> {
  const id = crypto.randomUUID();
  const max = await db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM template_pack_items WHERE pack_id = ?').bind(input.packId).first<{ m: number }>();
  await db
    .prepare(
      `INSERT INTO template_pack_items (id, pack_id, position, template_id, editor_type, editor_data, message_type, message_content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.packId, (max?.m ?? 0) + 1, input.templateId ?? null, input.editorType ?? null, input.editorData ?? null, input.messageType ?? null, input.messageContent ?? null, jstNow())
    .run();
  return (await getPackItem(db, id))!;
}

export async function updatePackItem(db: D1Database, id: string, input: Partial<PackItemInput>): Promise<PackItem | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };
  if (input.templateId !== undefined) set('template_id', input.templateId);
  if (input.editorType !== undefined) set('editor_type', input.editorType);
  if (input.editorData !== undefined) set('editor_data', input.editorData);
  if (input.messageType !== undefined) set('message_type', input.messageType);
  if (input.messageContent !== undefined) set('message_content', input.messageContent);
  if (sets.length === 0) return getPackItem(db, id);
  values.push(id);
  await db.prepare(`UPDATE template_pack_items SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getPackItem(db, id);
}

export async function deletePackItem(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM template_pack_items WHERE id = ?').bind(id).run();
}

export async function reorderPackItems(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(ids.map((id, i) => db.prepare('UPDATE template_pack_items SET position = ? WHERE id = ?').bind(i + 1, id)));
}
