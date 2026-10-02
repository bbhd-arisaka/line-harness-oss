import { jstNow } from './utils.js';

export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff';
  api_key: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  /** beyond admin のユーザーID。あれば、名前・役割・停止は beyond admin 側で管理する */
  external_id?: string | null;
  external_tenant_id?: string | null;
  /** 1 = 見られるアカウントを許可するまで、どのアカウントも見られない */
  access_restricted?: number;
}

export interface CreateStaffInput {
  name: string;
  email?: string | null;
  role: 'owner' | 'admin' | 'staff';
}

export interface UpdateStaffInput {
  name?: string;
  email?: string | null;
  role?: 'owner' | 'admin' | 'staff';
  is_active?: number;
}

function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `lh_${hex}`;
}

export async function getStaffByApiKey(
  db: D1Database,
  apiKey: string,
): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE api_key = ? AND is_active = 1')
    .bind(apiKey)
    .first<StaffMember>();
}

/** beyond admin のユーザーIDからスタッフを探す(停止中も含む) */
export async function getStaffByExternalId(db: D1Database, externalId: string): Promise<StaffMember | null> {
  return db.prepare('SELECT * FROM staff_members WHERE external_id = ?').bind(externalId).first<StaffMember>();
}

export interface ExternalStaffInput {
  externalId: string;
  tenantId: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff';
}

/**
 * beyond admin のユーザーを、スタッフとして作る/更新する(ログインのたびに呼ぶ)。
 * 名前・メール・役割は beyond admin を正とする。見られるアカウントは、ここでは触らない
 * (新しく作る人は、オーナー以外は「許可するまで、どのアカウントも見られない」)。
 */
export async function upsertExternalStaff(db: D1Database, input: ExternalStaffInput): Promise<StaffMember> {
  const now = jstNow();
  const existing = await getStaffByExternalId(db, input.externalId);
  if (existing) {
    await db
      .prepare('UPDATE staff_members SET name = ?, email = ?, role = ?, external_tenant_id = ?, updated_at = ? WHERE id = ?')
      .bind(input.name, input.email, input.role, input.tenantId, now, existing.id)
      .run();
  } else {
    // API キーは使わない(ログインは beyond admin 経由)が、列が必須なので、誰にも知らされない乱数を入れる
    await db
      .prepare(
        `INSERT INTO staff_members (id, name, email, role, api_key, is_active, created_at, updated_at, external_id, external_tenant_id, access_restricted)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1)`,
      )
      .bind(crypto.randomUUID(), input.name, input.email, input.role, generateApiKey(), now, now, input.externalId, input.tenantId)
      .run();
  }
  return (await getStaffByExternalId(db, input.externalId))!;
}

export async function getStaffMembers(db: D1Database): Promise<StaffMember[]> {
  const result = await db
    .prepare('SELECT * FROM staff_members ORDER BY created_at ASC')
    .all<StaffMember>();
  return result.results;
}

export async function getStaffById(
  db: D1Database,
  id: string,
): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>();
}

export async function createStaffMember(
  db: D1Database,
  input: CreateStaffInput,
): Promise<StaffMember> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const apiKey = generateApiKey();

  await db
    .prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, input.name, input.email ?? null, input.role, apiKey, now, now)
    .run();

  return (await db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>())!;
}

export async function updateStaffMember(
  db: D1Database,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffMember | null> {
  const now = jstNow();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name); }
  if (input.email !== undefined) { sets.push('email = ?'); values.push(input.email ?? null); }
  if (input.role !== undefined) { sets.push('role = ?'); values.push(input.role); }
  if (input.is_active !== undefined) { sets.push('is_active = ?'); values.push(input.is_active); }

  values.push(id);
  await db
    .prepare(`UPDATE staff_members SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first<StaffMember>();
}

export async function deleteStaffMember(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM staff_members WHERE id = ?').bind(id).run();
}

export async function regenerateStaffApiKey(db: D1Database, id: string): Promise<string> {
  const newKey = generateApiKey();
  const now = jstNow();
  const result = await db
    .prepare('UPDATE staff_members SET api_key = ?, updated_at = ? WHERE id = ?')
    .bind(newKey, now, id)
    .run();
  if (result.meta.changes === 0) {
    throw new Error(`Staff member not found: ${id}`);
  }
  return newKey;
}

export async function countStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ?')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function countActiveStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ? AND is_active = 1')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}
