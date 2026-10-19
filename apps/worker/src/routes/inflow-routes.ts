import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  countUnfiledInflowRoutes,
  createInflowFolder,
  createInflowRoute,
  deleteInflowFolder,
  deleteInflowRoute,
  getEntryRouteById,
  getInflowFolder,
  getLineAccountById,
  listInflowFolders,
  listInflowHits,
  listInflowRoutes,
  moveInflowRoute,
  refCodeExists,
  renameInflowFolder,
  reorderInflowFolders,
  reorderInflowRoutes,
  updateInflowRoute,
} from '@line-crm/db';
import type { EntryRoute } from '@line-crm/db';
import type { Env } from '../index.js';
import { isReservedRef } from '../lib/reserved-refs.js';
import { parseLandingStyle, parseLandingStyleInput, resolveLanding } from '../services/inflow-landing-style.js';
import { renderLandingPage } from '../services/inflow-landing-page.js';
import { generateRefCode, parseInflowRouteInput, refCodeFromSearch, MAX_NAME } from '../services/inflow-route-input.js';

/**
 * 流入経路分析(Lステップの「流入経路分析」と同じ仕様)の API。画面: /inflow-links
 *   GET    /api/inflow/routes?lineAccountId&folder&q&page&pageSize   一覧(集計つき)+フォルダ
 *   POST   /api/inflow/routes                                       作成
 *   GET/PUT/DELETE /api/inflow/routes/:id                           取得・更新・削除
 *   POST   /api/inflow/routes/:id/copy                              「コピーを作成」
 *   PUT    /api/inflow/routes/order                                 並び替え
 *   GET    /api/inflow/routes/:id/stats?page&pageSize               集計(アクセスした友だちと日時)
 *   GET    /api/inflow/routes/:id/export                            集計のCSV
 *   フォルダ: GET/POST /api/inflow/folders ・ PUT/DELETE /api/inflow/folders/:id ・ PUT /api/inflow/folders/order
 */
const inflowRoutes = new Hono<Env>();

const PAGE_DEFAULT = 20;

function workerOrigin(c: Context<Env>): string {
  return (c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
}

/** 流入経路のURL。公式アカウントを指定して、別のアカウントに振られないようにする */
export function routeUrl(origin: string, route: Pick<EntryRoute, 'ref_code'>, channelId: string | null): string {
  return `${origin}/r/${encodeURIComponent(route.ref_code)}${channelId ? `?account=${encodeURIComponent(channelId)}` : ''}`;
}

function serialize(row: EntryRoute, origin: string, channelId: string | null, extra?: { people: number; times: number }) {
  let adParamMap: Array<{ param: string; fieldKey: string }> = [];
  try {
    adParamMap = row.ad_param_map ? (JSON.parse(row.ad_param_map) as typeof adParamMap) : [];
  } catch {
    adParamMap = [];
  }
  let actions: unknown[] = [];
  try {
    actions = row.actions ? (JSON.parse(row.actions) as unknown[]) : [];
  } catch {
    actions = [];
  }
  return {
    id: row.id,
    refCode: row.ref_code,
    name: row.name,
    lineAccountId: row.line_account_id,
    folderId: row.folder_id,
    displayOrder: row.display_order,
    qrText: row.qr_text,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    outOfPeriodMessage: row.out_of_period_message,
    /** 旧来の流入経路(アクションの設定画面を使わず、タグ・シナリオだけを持つもの) */
    legacy: row.actions === null,
    legacyTagId: row.actions === null ? row.tag_id : null,
    actions,
    scenarioId: row.scenario_id,
    ignoreFriendAddSettings: row.ignore_friend_add_settings === 1,
    actionMode: row.action_mode === 'always' ? 'always' : 'first',
    adImportMode: row.ad_import_mode === 'first' ? 'first' : 'always',
    adParamMap,
    htmlHead: row.html_head,
    htmlBody: row.html_body,
    geoLat: row.geo_lat,
    geoLng: row.geo_lng,
    geoRadius: row.geo_radius,
    landingStyle: parseLandingStyle(row.landing_style),
    isActive: row.is_active === 1,
    url: routeUrl(origin, row, channelId),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(extra ?? {}),
  };
}

async function accountOr404(c: Context<Env>, lineAccountId: string | undefined | null) {
  if (!lineAccountId) return { error: c.json({ success: false, error: '公式アカウントを指定してください' }, 400) } as const;
  const account = await getLineAccountById(c.env.DB, lineAccountId);
  if (!account) return { error: c.json({ success: false, error: '公式アカウントが見つかりません' }, 404) } as const;
  return { account } as const;
}

async function uniqueRefCode(db: D1Database): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = generateRefCode();
    if (!isReservedRef(code) && !(await refCodeExists(db, code))) return code;
  }
  throw new Error('ref コードを作れませんでした');
}

/** 入力のフォルダ・アカウントの整合を確かめる(フォルダは同じ公式アカウントのものだけ) */
async function folderError(c: Context<Env>, folderId: string | null, lineAccountId: string): Promise<string | null> {
  if (!folderId) return null;
  const f = await getInflowFolder(c.env.DB, folderId);
  if (!f || f.line_account_id !== lineAccountId) return 'フォルダが見つかりません';
  return null;
}

// ── 友だち追加ページのプレビュー ──
// 保存する前の設定(編集中)から、実際のページと同じ HTML を作って返す(画面の iframe の srcdoc に入れる)
inflowRoutes.post('/api/inflow/landing-preview', async (c) => {
  try {
    const body = await c.req.json<{ style?: unknown; kind?: string; url?: string }>().catch(() => ({}) as { style?: unknown; kind?: string; url?: string });
    const parsed = parseLandingStyleInput(body.style ?? null);
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    const L = resolveLanding(parsed.json ? (JSON.parse(parsed.json) as Parameters<typeof resolveLanding>[0]) : null);
    const origin = workerOrigin(c);
    const sample = typeof body.url === 'string' && body.url.startsWith('https://') ? body.url.slice(0, 500) : 'https://line.me/R/ti/p/@sample';
    const html =
      body.kind === 'pc'
        ? renderLandingPage(L, { kind: 'pc', qrSrc: `${origin}/api/qr?size=240x240&data=${encodeURIComponent(sample)}` })
        : renderLandingPage(L, { kind: 'mobile', buttonHref: '#', helpUrl: '#', ios: true });
    return c.json({ success: true, data: { html } });
  } catch (err) {
    console.error('POST /api/inflow/landing-preview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── フォルダ ──

inflowRoutes.get('/api/inflow/folders', async (c) => {
  try {
    const r = await accountOr404(c, c.req.query('lineAccountId'));
    if ('error' in r) return r.error;
    const [folders, unfiled] = await Promise.all([listInflowFolders(c.env.DB, r.account.id), countUnfiledInflowRoutes(c.env.DB, r.account.id)]);
    return c.json({ success: true, data: { folders: folders.map((f) => ({ id: f.id, name: f.name, count: f.route_count })), unfiledCount: unfiled } });
  } catch (err) {
    console.error('GET /api/inflow/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inflowRoutes.put('/api/inflow/folders/order', async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string; ids?: string[] }>().catch(() => ({}) as { lineAccountId?: string; ids?: string[] });
    const r = await accountOr404(c, body.lineAccountId);
    if ('error' in r) return r.error;
    if (!Array.isArray(body.ids)) return c.json({ success: false, error: 'ids が必要です' }, 400);
    await reorderInflowFolders(c.env.DB, r.account.id, body.ids);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/inflow/folders/order error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inflowRoutes.post('/api/inflow/folders', async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string; name?: string }>().catch(() => ({}) as { lineAccountId?: string; name?: string });
    const r = await accountOr404(c, body.lineAccountId);
    if ('error' in r) return r.error;
    const name = (body.name ?? '').trim();
    if (!name) return c.json({ success: false, error: 'フォルダ名を入力してください' }, 400);
    if (name.length > 100) return c.json({ success: false, error: 'フォルダ名は100文字までです' }, 400);
    const folder = await createInflowFolder(c.env.DB, r.account.id, name);
    return c.json({ success: true, data: { id: folder.id, name: folder.name, count: 0 } }, 201);
  } catch (err) {
    console.error('POST /api/inflow/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inflowRoutes.put('/api/inflow/folders/:id', async (c) => {
  try {
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const name = (body.name ?? '').trim();
    if (!name) return c.json({ success: false, error: 'フォルダ名を入力してください' }, 400);
    if (name.length > 100) return c.json({ success: false, error: 'フォルダ名は100文字までです' }, 400);
    const folder = await renameInflowFolder(c.env.DB, c.req.param('id'), name);
    if (!folder) return c.json({ success: false, error: 'フォルダが見つかりません' }, 404);
    return c.json({ success: true, data: { id: folder.id, name: folder.name } });
  } catch (err) {
    console.error('PUT /api/inflow/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inflowRoutes.delete('/api/inflow/folders/:id', async (c) => {
  try {
    await deleteInflowFolder(c.env.DB, c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/inflow/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── 流入経路 ──

inflowRoutes.get('/api/inflow/routes', async (c) => {
  try {
    const r = await accountOr404(c, c.req.query('lineAccountId'));
    if ('error' in r) return r.error;
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(c.req.query('pageSize') ?? '', 10) || PAGE_DEFAULT));
    const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '', 10) || 1);
    const q = (c.req.query('q') ?? '').trim().slice(0, 500);
    const folder = c.req.query('folder') || 'none';
    const { items, total } = await listInflowRoutes(c.env.DB, {
      lineAccountId: r.account.id,
      folder,
      q,
      refCode: q ? refCodeFromSearch(q) : null,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const origin = workerOrigin(c);
    return c.json({
      success: true,
      data: { items: items.map((row) => serialize(row, origin, r.account.channel_id, { people: row.people, times: row.times })), total, page, pageSize },
    });
  } catch (err) {
    console.error('GET /api/inflow/routes error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inflowRoutes.put('/api/inflow/routes/order', async (c) => {
  try {
    const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
    if (!Array.isArray(body.ids)) return c.json({ success: false, error: 'ids が必要です' }, 400);
    await reorderInflowRoutes(c.env.DB, body.ids);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/inflow/routes/order error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inflowRoutes.post('/api/inflow/routes', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const r = await accountOr404(c, typeof body.lineAccountId === 'string' ? body.lineAccountId : null);
    if ('error' in r) return r.error;
    const parsed = parseInflowRouteInput(body, { isCreate: true });
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    const fe = await folderError(c, parsed.value.folderId, r.account.id);
    if (fe) return c.json({ success: false, error: fe }, 400);
    const row = await createInflowRoute(c.env.DB, { ...parsed.value, lineAccountId: r.account.id, refCode: await uniqueRefCode(c.env.DB) });
    return c.json({ success: true, data: serialize(row, workerOrigin(c), r.account.channel_id, { people: 0, times: 0 }) }, 201);
  } catch (err) {
    console.error('POST /api/inflow/routes error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function loadRoute(c: Context<Env>) {
  const row = await getEntryRouteById(c.env.DB, c.req.param('id') ?? '');
  if (!row) return { error: c.json({ success: false, error: '流入経路が見つかりません' }, 404) } as const;
  const account = row.line_account_id ? await getLineAccountById(c.env.DB, row.line_account_id) : null;
  return { row, account } as const;
}

inflowRoutes.get('/api/inflow/routes/:id', async (c) => {
  try {
    const r = await loadRoute(c);
    if ('error' in r) return r.error;
    return c.json({ success: true, data: serialize(r.row, workerOrigin(c), r.account?.channel_id ?? null) });
  } catch (err) {
    console.error('GET /api/inflow/routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inflowRoutes.put('/api/inflow/routes/:id', async (c) => {
  try {
    const r = await loadRoute(c);
    if ('error' in r) return r.error;
    if (!r.row.line_account_id) return c.json({ success: false, error: 'この流入経路は、旧来のものです。新しく作り直してください' }, 400);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const parsed = parseInflowRouteInput(body, { isCreate: false });
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    const fe = await folderError(c, parsed.value.folderId, r.row.line_account_id);
    if (fe) return c.json({ success: false, error: fe }, 400);
    const { actionMode: _a, adImportMode: _b, ...rest } = parsed.value;
    void _a;
    void _b;
    const updated = await updateInflowRoute(c.env.DB, r.row.id, rest);
    return c.json({ success: true, data: serialize(updated ?? r.row, workerOrigin(c), r.account?.channel_id ?? null) });
  } catch (err) {
    console.error('PUT /api/inflow/routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inflowRoutes.delete('/api/inflow/routes/:id', async (c) => {
  try {
    const r = await loadRoute(c);
    if ('error' in r) return r.error;
    await deleteInflowRoute(c.env.DB, r.row.id);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/inflow/routes/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 「コピーを作成」: 設定をそのまま、新しい ref コードで複製する(集計は引き継がない) */
inflowRoutes.post('/api/inflow/routes/:id/copy', async (c) => {
  try {
    const r = await loadRoute(c);
    if ('error' in r) return r.error;
    if (!r.row.line_account_id || !r.account) return c.json({ success: false, error: 'この流入経路は、旧来のものです。コピーできません' }, 400);
    const name = `${r.row.name}のコピー`.slice(0, MAX_NAME);
    const row = await createInflowRoute(c.env.DB, {
      lineAccountId: r.row.line_account_id,
      refCode: await uniqueRefCode(c.env.DB),
      name,
      folderId: r.row.folder_id,
      qrText: r.row.qr_text,
      validFrom: r.row.valid_from,
      validTo: r.row.valid_to,
      outOfPeriodMessage: r.row.out_of_period_message,
      actions: r.row.actions ?? '[]',
      scenarioId: r.row.scenario_id,
      ignoreFriendAddSettings: r.row.ignore_friend_add_settings === 1,
      actionMode: r.row.action_mode === 'always' ? 'always' : 'first',
      adImportMode: r.row.ad_import_mode === 'first' ? 'first' : 'always',
      adParamMap: r.row.ad_param_map,
      htmlHead: r.row.html_head,
      htmlBody: r.row.html_body,
      geoLat: r.row.geo_lat,
      geoLng: r.row.geo_lng,
      geoRadius: r.row.geo_radius,
      landingStyle: r.row.landing_style,
    });
    return c.json({ success: true, data: serialize(row, workerOrigin(c), r.account.channel_id, { people: 0, times: 0 }) }, 201);
  } catch (err) {
    console.error('POST /api/inflow/routes/:id/copy error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 別のフォルダへ移す(folderId=null で未分類) */
inflowRoutes.put('/api/inflow/routes/:id/folder', async (c) => {
  try {
    const r = await loadRoute(c);
    if ('error' in r) return r.error;
    const body = await c.req.json<{ folderId?: string | null }>().catch(() => ({}) as { folderId?: string | null });
    const folderId = body.folderId ?? null;
    if (r.row.line_account_id) {
      const fe = await folderError(c, folderId, r.row.line_account_id);
      if (fe) return c.json({ success: false, error: fe }, 400);
    }
    await moveInflowRoute(c.env.DB, r.row.id, folderId);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/inflow/routes/:id/folder error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

const MARK_LABEL: Record<string, string> = { unread: '未対応', in_progress: '対応中', resolved: '対応済み' };

inflowRoutes.get('/api/inflow/routes/:id/stats', async (c) => {
  try {
    const r = await loadRoute(c);
    if ('error' in r) return r.error;
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(c.req.query('pageSize') ?? '', 10) || 50));
    const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '', 10) || 1);
    const hits = await listInflowHits(c.env.DB, r.row.id, pageSize, (page - 1) * pageSize);
    return c.json({
      success: true,
      data: {
        route: serialize(r.row, workerOrigin(c), r.account?.channel_id ?? null, { people: hits.people, times: hits.total }),
        total: hits.total,
        people: hits.people,
        page,
        pageSize,
        rows: hits.rows.map((h) => ({
          id: h.id,
          friendId: h.friend_id,
          friendName: h.friend_name ?? '(削除された友だち)',
          mark: MARK_LABEL[h.chat_status ?? ''] ?? '未対応',
          at: h.created_at,
          queryParams: h.query_params ? (JSON.parse(h.query_params) as Record<string, string>) : {},
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/inflow/routes/:id/stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

const csvCell = (v: string): string => `"${v.replace(/"/g, '""')}"`;

/** 集計のCSV(Excel で文字化けしないよう、UTF-8 の BOM つき)。流入経路を読み取った友だちと、日時、クエリパラメータ */
inflowRoutes.get('/api/inflow/routes/:id/export', async (c) => {
  try {
    const r = await loadRoute(c);
    if ('error' in r) return r.error;
    const lines = [['対応マーク', '友だちID', '名前', '日時', 'クエリパラメータ'].map(csvCell).join(',')];
    for (let offset = 0; offset < 50_000; offset += 500) {
      const hits = await listInflowHits(c.env.DB, r.row.id, 500, offset);
      for (const h of hits.rows) {
        const qp = h.query_params ? Object.entries(JSON.parse(h.query_params) as Record<string, string>).map(([k, v]) => `${k}=${v}`).join('&') : '';
        lines.push([MARK_LABEL[h.chat_status ?? ''] ?? '未対応', h.friend_id ?? '', h.friend_name ?? '', h.created_at.replace('T', ' ').slice(0, 19), qp].map(csvCell).join(','));
      }
      if (hits.rows.length < 500) break;
    }
    const filename = encodeURIComponent(`流入経路_${r.row.name}.csv`);
    return new Response('﻿' + lines.join('\r\n') + '\r\n', {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${filename}`, 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    console.error('GET /api/inflow/routes/:id/export error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { inflowRoutes };
