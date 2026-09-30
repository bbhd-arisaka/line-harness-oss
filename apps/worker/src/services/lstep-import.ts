/**
 * Lステップ → beyond line のデータ引き継ぎ(友だち情報欄・タグ・友だちごとの値)。
 *
 * - 取り込み用データ(dataset)は、Lステップの画面から集めて、突き合わせ済みの友だち(beyond line の友だちID付き)にまとめたもの。
 * - 友だち情報欄の定義・タグを作り、友だちごとに 本名・システム表示名・友だち追加日時・友だち情報の値・タグ を反映する。
 * - 実行は「バッチ」単位。変更前の値と、作った行を記録しておき、あとから丸ごと元に戻せる。
 * - 反映の対象は、指定した公式アカウントの友だちだけ(他アカウントの友だちには触れない)。
 * - 何度実行しても同じ結果になる(同じタグの二重付与などは起きない)。
 */

export class ImportError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'datetime', 'select'] as const;
type FieldType = (typeof FIELD_TYPES)[number];

export interface DatasetFolder { name: string; order: number }
export interface DatasetField {
  key: string; label: string; type: FieldType; folder: string | null; order: number; options: string[]; defaultValue: string | null;
}
export interface DatasetTag { name: string }
export interface DatasetFriend {
  beyondFriendId: string;
  lstepId?: string;
  realName: string | null;
  systemDisplayName: string | null;
  /** 友だち追加日時(JST) 例: 2025-09-30T14:40:17 */
  addedAt: string | null;
  tags: string[];
  values: Record<string, string>;
}
export interface DatasetDefinitions {
  source: 'lstep';
  accountId: string;
  folders: DatasetFolder[];
  fields: DatasetField[];
  tags: DatasetTag[];
}

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '');

export function validateDefinitions(x: unknown): DatasetDefinitions {
  const o = x as Partial<DatasetDefinitions> | null;
  if (!o || typeof o !== 'object' || o.source !== 'lstep' || typeof o.accountId !== 'string' || !o.accountId) {
    throw new ImportError('取り込み用データの形式が正しくありません(source / accountId)');
  }
  if (!Array.isArray(o.folders) || !Array.isArray(o.fields) || !Array.isArray(o.tags)) {
    throw new ImportError('取り込み用データの形式が正しくありません(folders / fields / tags)');
  }
  const folders = o.folders.map((f) => ({ name: str(f?.name, 100).trim(), order: Number.isFinite(f?.order) ? Number(f.order) : 0 }));
  if (folders.some((f) => !f.name)) throw new ImportError('名前の無いフォルダがあります');
  const seenKeys = new Set<string>();
  const fields = o.fields.map((f) => {
    const type = (FIELD_TYPES as readonly string[]).includes(f?.type) ? (f.type as FieldType) : 'text';
    const key = str(f?.key, 64).trim();
    if (!/^[A-Za-z0-9_]+$/.test(key)) throw new ImportError(`友だち情報欄のキーが不正です: ${key}`);
    if (seenKeys.has(key)) throw new ImportError(`友だち情報欄のキーが重複しています: ${key}`);
    seenKeys.add(key);
    const label = str(f?.label, 100).trim();
    if (!label) throw new ImportError(`名前の無い友だち情報欄があります: ${key}`);
    const folder = f?.folder ? str(f.folder, 100).trim() : null;
    if (folder && !folders.some((x) => x.name === folder)) throw new ImportError(`存在しないフォルダが指定されています: ${folder}`);
    return {
      key, label, type, folder,
      order: Number.isFinite(f?.order) ? Number(f.order) : 0,
      options: Array.isArray(f?.options) ? f.options.map((v) => str(v, 200)).filter(Boolean).slice(0, 200) : [],
      defaultValue: f?.defaultValue ? str(f.defaultValue, 500) : null,
    };
  });
  const tags = o.tags.map((t) => ({ name: str(t?.name, 100).trim() })).filter((t) => t.name);
  return { source: 'lstep', accountId: o.accountId, folders, fields, tags: [...new Map(tags.map((t) => [t.name, t])).values()] };
}

export function validateFriends(x: unknown, fieldKeys: Set<string>): DatasetFriend[] {
  if (!Array.isArray(x)) throw new ImportError('friends は配列で指定してください');
  if (x.length > 100) throw new ImportError('一度に反映できる友だちは100人までです');
  return x.map((f) => {
    const id = str(f?.beyondFriendId, 64);
    if (!id) throw new ImportError('beyondFriendId がありません');
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries((f?.values ?? {}) as Record<string, unknown>)) {
      if (!fieldKeys.has(k)) throw new ImportError(`未定義の友だち情報欄キーです: ${k}`);
      const s = str(v, 5000);
      if (s !== '') values[k] = s;
    }
    const addedAt = typeof f?.addedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(f.addedAt) ? f.addedAt : null;
    return {
      beyondFriendId: id,
      lstepId: f?.lstepId ? str(f.lstepId, 32) : undefined,
      realName: f?.realName ? str(f.realName, 200) : null,
      systemDisplayName: f?.systemDisplayName ? str(f.systemDisplayName, 200) : null,
      addedAt,
      tags: Array.isArray(f?.tags) ? [...new Set((f.tags as unknown[]).map((t) => str(t, 100).trim()).filter(Boolean))] : [],
      values,
    };
  });
}

const jstNow = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00');
const toJst = (addedAt: string) => `${addedAt}.000+09:00`;

async function assertAccount(db: D1Database, accountId: string): Promise<void> {
  const row = await db.prepare('SELECT id FROM line_accounts WHERE id = ?').bind(accountId).first();
  if (!row) throw new ImportError('取り込み先の公式アカウントが見つかりません', 404);
}

async function chunked<T>(db: D1Database, statements: D1PreparedStatement[], size = 50): Promise<void> {
  for (let i = 0; i < statements.length; i += size) await db.batch(statements.slice(i, i + size));
}

// ── 計画(何も書き込まない) ─────────────────────────────────────────────

export interface ImportPlan {
  account: { id: string; name: string };
  folders: { total: number; toCreate: number };
  fields: { total: number; toCreate: number; existing: string[] };
  tags: { total: number; toCreate: number };
}

export async function planDefinitions(db: D1Database, defs: DatasetDefinitions): Promise<ImportPlan> {
  const account = await db.prepare('SELECT id, name FROM line_accounts WHERE id = ?').bind(defs.accountId).first<{ id: string; name: string }>();
  if (!account) throw new ImportError('取り込み先の公式アカウントが見つかりません', 404);
  const folderRows = (await db.prepare('SELECT name FROM friend_field_folders').all<{ name: string }>()).results ?? [];
  const fieldRows = (await db.prepare('SELECT field_key FROM friend_field_definitions').all<{ field_key: string }>()).results ?? [];
  const tagRows = (await db.prepare('SELECT name FROM tags').all<{ name: string }>()).results ?? [];
  const folderNames = new Set(folderRows.map((r) => r.name));
  const fieldKeys = new Set(fieldRows.map((r) => r.field_key));
  const tagNames = new Set(tagRows.map((r) => r.name));
  return {
    account,
    folders: { total: defs.folders.length, toCreate: defs.folders.filter((f) => !folderNames.has(f.name)).length },
    fields: { total: defs.fields.length, toCreate: defs.fields.filter((f) => !fieldKeys.has(f.key)).length, existing: defs.fields.filter((f) => fieldKeys.has(f.key)).map((f) => f.label) },
    tags: { total: defs.tags.length, toCreate: defs.tags.filter((t) => !tagNames.has(t.name)).length },
  };
}

export interface FriendsPlan {
  total: number;
  inAccount: number;
  notFoundOrOtherAccount: number;
  willSetRealName: number;
  willOverwriteRealName: number;
  willSetSystemDisplayName: number;
  withValues: number;
  overwritingValues: number;
  withTags: number;
  newTagAssignments: number;
}

export async function planFriends(db: D1Database, accountId: string, friends: DatasetFriend[], tagIdByName: Map<string, string>): Promise<FriendsPlan> {
  const plan: FriendsPlan = {
    total: friends.length, inAccount: 0, notFoundOrOtherAccount: 0, willSetRealName: 0, willOverwriteRealName: 0,
    willSetSystemDisplayName: 0, withValues: 0, overwritingValues: 0, withTags: 0, newTagAssignments: 0,
  };
  for (let i = 0; i < friends.length; i += 50) {
    const part = friends.slice(i, i + 50);
    const ph = part.map(() => '?').join(',');
    const rows = (await db.prepare(`SELECT id, line_account_id, real_name, system_display_name, metadata FROM friends WHERE id IN (${ph})`).bind(...part.map((f) => f.beyondFriendId)).all<{ id: string; line_account_id: string | null; real_name: string | null; system_display_name: string | null; metadata: string | null }>()).results ?? [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const existingTags = (await db.prepare(`SELECT friend_id, tag_id FROM friend_tags WHERE friend_id IN (${ph})`).bind(...part.map((f) => f.beyondFriendId)).all<{ friend_id: string; tag_id: string }>()).results ?? [];
    const tagSet = new Set(existingTags.map((t) => `${t.friend_id}|${t.tag_id}`));
    for (const f of part) {
      const row = byId.get(f.beyondFriendId);
      if (!row || row.line_account_id !== accountId) { plan.notFoundOrOtherAccount++; continue; }
      plan.inAccount++;
      if (f.realName) { plan.willSetRealName++; if (row.real_name && row.real_name !== f.realName) plan.willOverwriteRealName++; }
      if (f.systemDisplayName) plan.willSetSystemDisplayName++;
      if (Object.keys(f.values).length) {
        plan.withValues++;
        let meta: Record<string, unknown> = {};
        try { meta = row.metadata ? JSON.parse(row.metadata) : {}; } catch { meta = {}; }
        if (Object.keys(f.values).some((k) => meta[k] !== undefined && meta[k] !== f.values[k])) plan.overwritingValues++;
      }
      if (f.tags.length) plan.withTags++;
      for (const t of f.tags) {
        const tid = tagIdByName.get(t);
        if (!tid || !tagSet.has(`${f.beyondFriendId}|${tid}`)) plan.newTagAssignments++;
      }
    }
  }
  return plan;
}

// ── 実行 ─────────────────────────────────────────────────────────────

async function logOp(db: D1Database, batchId: string, op: string, ref1: string | null, ref2: string | null = null, before: string | null = null) {
  await db.prepare('INSERT INTO import_batch_ops (batch_id, op, ref1, ref2, before) VALUES (?, ?, ?, ?, ?)').bind(batchId, op, ref1, ref2, before).run();
}

/** バッチを作り、友だち情報欄のフォルダ・項目・タグを作る(すでにあるものは作らない)。 */
export async function startImport(db: D1Database, defs: DatasetDefinitions, createdBy: string): Promise<{ batchId: string; created: { folders: number; fields: number; tags: number } }> {
  await assertAccount(db, defs.accountId);
  const batchId = crypto.randomUUID();
  await db.prepare("INSERT INTO import_batches (id, source, line_account_id, status, created_by) VALUES (?, 'lstep', ?, 'running', ?)").bind(batchId, defs.accountId, createdBy).run();
  const now = jstNow();
  const created = { folders: 0, fields: 0, tags: 0 };

  const folderIdByName = new Map<string, string>();
  for (const r of (await db.prepare('SELECT id, name FROM friend_field_folders').all<{ id: string; name: string }>()).results ?? []) folderIdByName.set(r.name, r.id);
  for (const f of defs.folders) {
    if (folderIdByName.has(f.name)) continue;
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO friend_field_folders (id, name, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, f.name, f.order, now, now).run();
    await logOp(db, batchId, 'created_folder', id);
    folderIdByName.set(f.name, id);
    created.folders++;
  }
  const existingKeys = new Set(((await db.prepare('SELECT field_key FROM friend_field_definitions').all<{ field_key: string }>()).results ?? []).map((r) => r.field_key));
  for (const f of defs.fields) {
    if (existingKeys.has(f.key)) continue;
    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO friend_field_definitions (id, folder_id, field_key, label, field_type, options, default_value, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, f.folder ? folderIdByName.get(f.folder) ?? null : null, f.key, f.label, f.type, f.type === 'select' && f.options.length ? JSON.stringify(f.options) : null, f.defaultValue, f.order, now, now).run();
    await logOp(db, batchId, 'created_field', id);
    created.fields++;
  }
  const tagNames = new Set(((await db.prepare('SELECT name FROM tags').all<{ name: string }>()).results ?? []).map((r) => r.name));
  for (const t of defs.tags) {
    if (tagNames.has(t.name)) continue;
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').bind(id, t.name, '#3B82F6').run();
    await logOp(db, batchId, 'created_tag', id);
    created.tags++;
  }
  return { batchId, created };
}

export async function loadTagIds(db: D1Database): Promise<Map<string, string>> {
  return new Map(((await db.prepare('SELECT id, name FROM tags').all<{ id: string; name: string }>()).results ?? []).map((r) => [r.name, r.id]));
}

export async function loadFieldKeys(db: D1Database): Promise<Set<string>> {
  return new Set(((await db.prepare('SELECT field_key FROM friend_field_definitions').all<{ field_key: string }>()).results ?? []).map((r) => r.field_key));
}

export interface ApplyFriendsResult { updated: number; skipped: number; tagsAdded: number; skippedIds: string[] }

/** 友だちの一部(最大100人)に、本名・システム表示名・追加日時・友だち情報の値・タグを反映する。 */
export async function applyFriends(db: D1Database, batchId: string, friends: DatasetFriend[]): Promise<ApplyFriendsResult> {
  const batch = await db.prepare('SELECT id, status, line_account_id FROM import_batches WHERE id = ?').bind(batchId).first<{ id: string; status: string; line_account_id: string }>();
  if (!batch) throw new ImportError('取り込みの記録が見つかりません', 404);
  if (batch.status !== 'running') throw new ImportError('この取り込みはすでに完了または取り消し済みです', 409);
  const tagIdByName = await loadTagIds(db);
  const now = jstNow();
  const result: ApplyFriendsResult = { updated: 0, skipped: 0, tagsAdded: 0, skippedIds: [] };
  const ph = friends.map(() => '?').join(',');
  if (!friends.length) return result;
  const rows = (await db.prepare(`SELECT * FROM friends WHERE id IN (${ph})`).bind(...friends.map((f) => f.beyondFriendId)).all<Record<string, unknown>>()).results ?? [];
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const existingTags = (await db.prepare(`SELECT friend_id, tag_id FROM friend_tags WHERE friend_id IN (${ph})`).bind(...friends.map((f) => f.beyondFriendId)).all<{ friend_id: string; tag_id: string }>()).results ?? [];
  const tagSet = new Set(existingTags.map((t) => `${t.friend_id}|${t.tag_id}`));

  const statements: D1PreparedStatement[] = [];
  for (const f of friends) {
    const row = byId.get(f.beyondFriendId);
    if (!row || row.line_account_id !== batch.line_account_id) { result.skipped++; result.skippedIds.push(f.beyondFriendId); continue; }
    let meta: Record<string, unknown> = {};
    try { meta = row.metadata ? JSON.parse(row.metadata as string) : {}; } catch { meta = {}; }
    const before = {
      real_name: row.real_name ?? null, system_display_name: row.system_display_name ?? null, metadata: row.metadata ?? null,
      created_at: row.created_at ?? null, first_followed_at: row.first_followed_at ?? null,
    };
    const newMeta = { ...meta, ...f.values };
    statements.push(
      db.prepare('INSERT INTO import_batch_ops (batch_id, op, ref1, before) VALUES (?, ?, ?, ?)').bind(batchId, 'friend_before', f.beyondFriendId, JSON.stringify(before)),
      db.prepare(
        `UPDATE friends SET real_name = COALESCE(?, real_name), system_display_name = COALESCE(?, system_display_name),
                metadata = ?, created_at = COALESCE(?, created_at), first_followed_at = COALESCE(?, first_followed_at), updated_at = ?
          WHERE id = ? AND line_account_id = ?`,
      ).bind(f.realName, f.systemDisplayName, JSON.stringify(newMeta), f.addedAt ? toJst(f.addedAt) : null, f.addedAt ? toJst(f.addedAt) : null, now, f.beyondFriendId, batch.line_account_id),
    );
    for (const name of f.tags) {
      const tid = tagIdByName.get(name);
      if (!tid || tagSet.has(`${f.beyondFriendId}|${tid}`)) continue;
      tagSet.add(`${f.beyondFriendId}|${tid}`);
      statements.push(
        db.prepare('INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)').bind(f.beyondFriendId, tid, now),
        db.prepare('INSERT INTO import_batch_ops (batch_id, op, ref1, ref2) VALUES (?, ?, ?, ?)').bind(batchId, 'added_friend_tag', f.beyondFriendId, tid),
      );
      result.tagsAdded++;
    }
    result.updated++;
  }
  await chunked(db, statements);
  return result;
}

export async function finishImport(db: D1Database, batchId: string, summary: unknown): Promise<void> {
  const res = await db.prepare("UPDATE import_batches SET status = 'applied', summary = ?, finished_at = ? WHERE id = ? AND status = 'running'").bind(JSON.stringify(summary ?? {}), jstNow(), batchId).run();
  if (!res.meta.changes) throw new ImportError('この取り込みは完了できません(記録が無い、または完了済み)', 409);
}

export async function listImports(db: D1Database) {
  return ((await db.prepare(
    `SELECT b.id, b.source, b.status, b.summary, b.created_by, b.created_at, b.finished_at, b.undone_at, la.name AS account_name
       FROM import_batches b LEFT JOIN line_accounts la ON la.id = b.line_account_id ORDER BY b.created_at DESC LIMIT 50`,
  ).all()).results ?? []);
}

/** 取り込みを丸ごと元に戻す(記録を逆向きにたどる)。 */
export async function undoImport(db: D1Database, batchId: string): Promise<{ restoredFriends: number; removedTags: number; removedDefinitions: number }> {
  const batch = await db.prepare('SELECT id, status FROM import_batches WHERE id = ?').bind(batchId).first<{ id: string; status: string }>();
  if (!batch) throw new ImportError('取り込みの記録が見つかりません', 404);
  if (batch.status === 'undone') throw new ImportError('すでに取り消し済みです', 409);
  const ops = (await db.prepare('SELECT op, ref1, ref2, before FROM import_batch_ops WHERE batch_id = ? ORDER BY id DESC').bind(batchId).all<{ op: string; ref1: string | null; ref2: string | null; before: string | null }>()).results ?? [];
  const out = { restoredFriends: 0, removedTags: 0, removedDefinitions: 0 };
  const statements: D1PreparedStatement[] = [];
  const now = jstNow();
  for (const o of ops) {
    if (o.op === 'added_friend_tag') { statements.push(db.prepare('DELETE FROM friend_tags WHERE friend_id = ? AND tag_id = ?').bind(o.ref1, o.ref2)); out.removedTags++; }
    else if (o.op === 'friend_before' && o.before) {
      const b = JSON.parse(o.before) as Record<string, string | null>;
      statements.push(db.prepare('UPDATE friends SET real_name = ?, system_display_name = ?, metadata = ?, created_at = COALESCE(?, created_at), first_followed_at = ?, updated_at = ? WHERE id = ?')
        .bind(b.real_name, b.system_display_name, b.metadata ?? '{}', b.created_at, b.first_followed_at, now, o.ref1));
      out.restoredFriends++;
    }
  }
  await chunked(db, statements);
  // 作ったタグ・項目・フォルダは、まだ使われていなければ消す(他で使われ始めたものは残す)
  for (const o of ops) {
    if (o.op === 'created_tag') {
      const used = await db.prepare('SELECT 1 AS x FROM friend_tags WHERE tag_id = ? LIMIT 1').bind(o.ref1).first();
      if (!used) { await db.prepare('DELETE FROM tags WHERE id = ?').bind(o.ref1).run(); out.removedDefinitions++; }
    } else if (o.op === 'created_field') {
      await db.prepare('DELETE FROM friend_field_definitions WHERE id = ?').bind(o.ref1).run(); out.removedDefinitions++;
    } else if (o.op === 'created_folder') {
      const used = await db.prepare('SELECT 1 AS x FROM friend_field_definitions WHERE folder_id = ? LIMIT 1').bind(o.ref1).first();
      if (!used) { await db.prepare('DELETE FROM friend_field_folders WHERE id = ?').bind(o.ref1).run(); out.removedDefinitions++; }
    }
  }
  await db.prepare("UPDATE import_batches SET status = 'undone', undone_at = ? WHERE id = ?").bind(now, batchId).run();
  return out;
}
