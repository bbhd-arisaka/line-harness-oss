import { jstNow } from './utils.js';
import type { EntryRoute } from './entry-routes.js';

/**
 * 流入経路分析(Lステップの「流入経路分析」と同じ仕様)のデータ操作。
 * 流入経路の本体は entry_routes(旧来の列はそのまま。108 の列を足した)。ここは、フォルダ・一覧・集計・作成・複製・削除・並び替え。
 */

export interface InflowFolder {
  id: string;
  line_account_id: string | null;
  name: string;
  display_order: number;
  created_at: string;
}

export interface InflowFolderWithCount extends InflowFolder {
  route_count: number;
}

export interface InflowRouteListItem extends EntryRoute {
  /** 集計: アクセスした人数(同じ人は1人)と回数 */
  people: number;
  times: number;
}

export interface InflowRouteInput {
  lineAccountId: string;
  refCode: string;
  name: string;
  folderId?: string | null;
  qrText?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  outOfPeriodMessage?: string | null;
  /** アクション(JSON文字列。友だち追加時設定のアクションと同じ形) */
  actions: string;
  scenarioId?: string | null;
  ignoreFriendAddSettings?: boolean;
  actionMode: 'first' | 'always';
  adImportMode: 'first' | 'always';
  adParamMap?: string | null;
  htmlHead?: string | null;
  htmlBody?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  geoRadius?: number | null;
  /** 友だち追加ページの文言・配色(JSON文字列) */
  landingStyle?: string | null;
}

// ── フォルダ ──

export async function listInflowFolders(db: D1Database, lineAccountId: string): Promise<InflowFolderWithCount[]> {
  const rows = await db
    .prepare(
      `SELECT f.*, (SELECT COUNT(*) FROM entry_routes r WHERE r.folder_id = f.id) AS route_count
         FROM entry_route_folders f
        WHERE f.line_account_id = ?
        ORDER BY f.display_order, f.created_at`,
    )
    .bind(lineAccountId)
    .all<InflowFolderWithCount>();
  return rows.results ?? [];
}

export async function getInflowFolder(db: D1Database, id: string): Promise<InflowFolder | null> {
  return db.prepare('SELECT * FROM entry_route_folders WHERE id = ?').bind(id).first<InflowFolder>();
}

export async function createInflowFolder(db: D1Database, lineAccountId: string, name: string): Promise<InflowFolder> {
  const id = crypto.randomUUID();
  const max = await db
    .prepare('SELECT COALESCE(MAX(display_order), 0) AS m FROM entry_route_folders WHERE line_account_id = ?')
    .bind(lineAccountId)
    .first<{ m: number }>();
  await db
    .prepare('INSERT INTO entry_route_folders (id, line_account_id, name, display_order, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, lineAccountId, name, (max?.m ?? 0) + 1, jstNow())
    .run();
  return (await getInflowFolder(db, id))!;
}

export async function renameInflowFolder(db: D1Database, id: string, name: string): Promise<InflowFolder | null> {
  await db.prepare('UPDATE entry_route_folders SET name = ? WHERE id = ?').bind(name, id).run();
  return getInflowFolder(db, id);
}

/** フォルダを削除する。中の流入経路は消さず、「未分類」に戻す */
export async function deleteInflowFolder(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('UPDATE entry_routes SET folder_id = NULL WHERE folder_id = ?').bind(id),
    db.prepare('DELETE FROM entry_route_folders WHERE id = ?').bind(id),
  ]);
}

export async function reorderInflowFolders(db: D1Database, lineAccountId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id, i) => db.prepare('UPDATE entry_route_folders SET display_order = ? WHERE id = ? AND line_account_id = ?').bind(i + 1, id, lineAccountId)),
  );
}

// ── 一覧・集計 ──

export interface InflowListQuery {
  lineAccountId: string;
  /** 'none' = 未分類 / 'all' = すべて / フォルダID */
  folder: string;
  /** 名前の一部。ref コード(URL から取り出したもの)でも探せる */
  q?: string;
  refCode?: string | null;
  limit: number;
  offset: number;
}

/**
 * 一覧。公式アカウントのもの+(まだどのアカウントにも結びついていない)旧来のものを出す。
 * 集計(人数・回数)は、ref_tracking(OAuth/LIFF を完了したアクセス)から。同じ人は人数では1人、回数ではアクセスの数。
 */
export async function listInflowRoutes(db: D1Database, query: InflowListQuery): Promise<{ items: InflowRouteListItem[]; total: number }> {
  const conds: string[] = ['(r.line_account_id = ? OR r.line_account_id IS NULL)'];
  const binds: unknown[] = [query.lineAccountId];
  if (query.folder === 'none') conds.push('r.folder_id IS NULL');
  else if (query.folder !== 'all') {
    conds.push('r.folder_id = ?');
    binds.push(query.folder);
  }
  const q = (query.q ?? '').trim();
  if (q) {
    const esc = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const parts = ["r.name LIKE ? ESCAPE '\\'"];
    binds.push(`%${esc}%`);
    if (query.refCode) {
      parts.push('r.ref_code = ?');
      binds.push(query.refCode);
    }
    conds.push(`(${parts.join(' OR ')})`);
  }
  const where = conds.join(' AND ');
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM entry_routes r WHERE ${where}`).bind(...binds).first<{ n: number }>();
  const rows = await db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(DISTINCT t.friend_id) FROM ref_tracking t WHERE t.entry_route_id = r.id AND t.friend_id IS NOT NULL) AS people,
              (SELECT COUNT(*) FROM ref_tracking t WHERE t.entry_route_id = r.id) AS times
         FROM entry_routes r
        WHERE ${where}
        ORDER BY r.display_order, r.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(...binds, query.limit, query.offset)
    .all<InflowRouteListItem>();
  return { items: rows.results ?? [], total: total?.n ?? 0 };
}

/** 未分類の件数(一覧の左の「未分類」) */
export async function countUnfiledInflowRoutes(db: D1Database, lineAccountId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM entry_routes WHERE (line_account_id = ? OR line_account_id IS NULL) AND folder_id IS NULL')
    .bind(lineAccountId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface InflowHitRow {
  id: string;
  friend_id: string | null;
  friend_name: string | null;
  chat_status: string | null;
  created_at: string;
  query_params: string | null;
}

/** 集計画面: この経路でアクセスした友だちと日時(新しい順) */
export async function listInflowHits(
  db: D1Database,
  routeId: string,
  limit: number,
  offset: number,
): Promise<{ rows: InflowHitRow[]; total: number; people: number }> {
  const totals = await db
    .prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT friend_id) AS p FROM ref_tracking WHERE entry_route_id = ?')
    .bind(routeId)
    .first<{ n: number; p: number }>();
  const rows = await db
    .prepare(
      `SELECT t.id, t.friend_id, t.created_at, t.query_params,
              COALESCE(NULLIF(TRIM(f.real_name), ''), NULLIF(TRIM(f.system_display_name), ''), f.display_name) AS friend_name,
              (SELECT c.status FROM chats c WHERE c.friend_id = t.friend_id ORDER BY c.created_at DESC LIMIT 1) AS chat_status
         FROM ref_tracking t
         LEFT JOIN friends f ON f.id = t.friend_id
        WHERE t.entry_route_id = ?
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(routeId, limit, offset)
    .all<InflowHitRow>();
  return { rows: rows.results ?? [], total: totals?.n ?? 0, people: totals?.p ?? 0 };
}

// ── 作成・更新・複製・削除・並び替え ──

export async function createInflowRoute(db: D1Database, input: InflowRouteInput): Promise<EntryRoute> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const max = await db
    .prepare('SELECT COALESCE(MIN(display_order), 1) AS m FROM entry_routes WHERE line_account_id = ?')
    .bind(input.lineAccountId)
    .first<{ m: number }>();
  await db
    .prepare(
      `INSERT INTO entry_routes
         (id, ref_code, name, tag_id, scenario_id, redirect_url, pool_id, intro_template_id, run_account_friend_add_scenarios, is_active,
          line_account_id, folder_id, display_order, qr_text, valid_from, valid_to, out_of_period_message, actions, ignore_friend_add_settings,
          action_mode, ad_import_mode, ad_param_map, html_head, html_body, geo_lat, geo_lng, geo_radius, landing_style, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.refCode,
      input.name,
      input.scenarioId ?? null,
      input.lineAccountId,
      input.folderId ?? null,
      (max?.m ?? 1) - 1, // 新しいものは、いちばん上に
      input.qrText ?? null,
      input.validFrom ?? null,
      input.validTo ?? null,
      input.outOfPeriodMessage ?? null,
      input.actions,
      input.ignoreFriendAddSettings ? 1 : 0,
      input.actionMode,
      input.adImportMode,
      input.adParamMap ?? null,
      input.htmlHead ?? null,
      input.htmlBody ?? null,
      input.geoLat ?? null,
      input.geoLng ?? null,
      input.geoRadius ?? null,
      input.landingStyle ?? null,
      now,
      now,
    )
    .run();
  return (await db.prepare('SELECT * FROM entry_routes WHERE id = ?').bind(id).first<EntryRoute>())!;
}

/** 更新。「アクションの実行」「広告パラメータの取り込みのタイミング」は、作成後は変えられない(ここでは触らない) */
export async function updateInflowRoute(db: D1Database, id: string, input: Omit<InflowRouteInput, 'lineAccountId' | 'refCode' | 'actionMode' | 'adImportMode'>): Promise<EntryRoute | null> {
  await db
    .prepare(
      `UPDATE entry_routes SET
         name = ?, folder_id = ?, qr_text = ?, valid_from = ?, valid_to = ?, out_of_period_message = ?, actions = ?, scenario_id = ?,
         ignore_friend_add_settings = ?, ad_param_map = ?, html_head = ?, html_body = ?, geo_lat = ?, geo_lng = ?, geo_radius = ?, landing_style = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name,
      input.folderId ?? null,
      input.qrText ?? null,
      input.validFrom ?? null,
      input.validTo ?? null,
      input.outOfPeriodMessage ?? null,
      input.actions,
      input.scenarioId ?? null,
      input.ignoreFriendAddSettings ? 1 : 0,
      input.adParamMap ?? null,
      input.htmlHead ?? null,
      input.htmlBody ?? null,
      input.geoLat ?? null,
      input.geoLng ?? null,
      input.geoRadius ?? null,
      input.landingStyle ?? null,
      jstNow(),
      id,
    )
    .run();
  return db.prepare('SELECT * FROM entry_routes WHERE id = ?').bind(id).first<EntryRoute>();
}

export async function deleteInflowRoute(db: D1Database, id: string): Promise<void> {
  await db.batch([
    // 集計の記録は残す(経路との結びつきだけ外す)
    db.prepare('UPDATE ref_tracking SET entry_route_id = NULL WHERE entry_route_id = ?').bind(id),
    db.prepare('DELETE FROM entry_routes WHERE id = ?').bind(id),
  ]);
}

export async function reorderInflowRoutes(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(ids.map((id, i) => db.prepare('UPDATE entry_routes SET display_order = ? WHERE id = ?').bind(i + 1, id)));
}

/** 流入経路を、別の場所(フォルダ)へ移す */
export async function moveInflowRoute(db: D1Database, id: string, folderId: string | null): Promise<void> {
  await db.prepare('UPDATE entry_routes SET folder_id = ?, updated_at = ? WHERE id = ?').bind(folderId, jstNow(), id).run();
}

export async function refCodeExists(db: D1Database, refCode: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM entry_routes WHERE ref_code = ? LIMIT 1').bind(refCode).first();
  return !!row;
}
