import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  addPackItem,
  countUnfiledTemplates,
  createLibraryTemplate,
  createTemplateFolder,
  createTemplateSender,
  deleteLibraryTemplates,
  deletePackItem,
  deleteTemplateDrafts,
  deleteTemplateFolder,
  deleteTemplateSender,
  getLibraryTemplate,
  getLineAccountById,
  getPackItem,
  getTemplateDraft,
  getTemplateFolder,
  getTemplateSender,
  listLibraryTemplates,
  listPackItems,
  listPacksReferencing,
  listTemplateDrafts,
  listTemplateFolders,
  listTemplateSenders,
  moveLibraryTemplates,
  renameTemplateFolder,
  reorderLibraryTemplates,
  reorderPackItems,
  reorderTemplateFolders,
  saveTemplateDraft,
  updateLibraryTemplate,
  updatePackItem,
} from '@line-crm/db';
import type { LibraryTemplate, PackItem } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import {
  EDITOR_TYPE_LABEL,
  compileTemplate,
  describeTemplate,
  emptyEditorData,
  validateTemplate,
} from '@line-crm/shared';
import type { CompiledTemplate, EditorData, EditorType, SenderInfo, TemplateKind } from '@line-crm/shared';
import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';
import { buildMessages } from '../services/step-delivery.js';
import { expandFormLinks } from '../services/form-link.js';
import { renderBroadcastMessageContent } from '../services/render-message.js';

/**
 * テンプレート(Lステップの「テンプレート」と同じ仕様)。
 *  フォルダ: GET/POST /api/tpl/folders ・ PUT /api/tpl/folders/order ・ PUT/DELETE /api/tpl/folders/:id
 *  一覧・作成・編集: GET /api/tpl/items ・ GET/PUT/DELETE /api/tpl/items/:id ・ POST /api/tpl/items ・ 複製・移動・並び替え・一括削除
 *  プレビュー・テスト送信: POST /api/tpl/preview ・ POST /api/tpl/test-send ・ POST /api/tpl/items/:id/test-send
 *  送信者: GET/POST /api/tpl/senders ・ DELETE /api/tpl/senders/:id
 *  下書き: GET/POST /api/tpl/drafts ・ GET/PUT /api/tpl/drafts/:id ・ POST /api/tpl/drafts/delete
 *  パック: GET /api/tpl/packs/:id ・ POST /api/tpl/packs/:id/items ・ PUT/DELETE /api/tpl/pack-items/:id ・ PUT /api/tpl/packs/:id/order
 * 変換(入力データ → 送る形)は packages/shared/src/templates.ts。画面のプレビューと同じ関数を使う。
 */
export const templateLibrary = new Hono<Env>();

const PAGE_DEFAULT = 50;
const MAX_NAME = 200;
const MAX_TEST_RECIPIENTS = 10;
const STANDARD_TYPES = new Set(['text', 'sticker', 'image', 'question', 'carousel', 'location', 'referral', 'audio', 'video']);

function workerUrlOf(c: Context<Env>): string {
  return c.env.WORKER_URL || new URL(c.req.url).origin;
}

async function accountOr400(c: Context<Env>, lineAccountId: string | undefined | null) {
  if (!lineAccountId) return { error: c.json({ success: false, error: '公式アカウントを指定してください' }, 400) } as const;
  const account = await getLineAccountById(c.env.DB, lineAccountId);
  if (!account) return { error: c.json({ success: false, error: '公式アカウントが見つかりません' }, 404) } as const;
  return { account } as const;
}

async function folderError(c: Context<Env>, folderId: string | null | undefined, lineAccountId: string): Promise<string | null> {
  if (!folderId) return null;
  const f = await getTemplateFolder(c.env.DB, folderId);
  if (!f || (f.line_account_id && f.line_account_id !== lineAccountId)) return 'フォルダが見つかりません';
  return null;
}

async function senderOf(c: Context<Env>, senderId: string | null | undefined): Promise<SenderInfo | null> {
  if (!senderId) return null;
  const s = await getTemplateSender(c.env.DB, senderId);
  return s ? { name: s.name, iconUrl: s.icon_url } : null;
}

// ── 保存済みの内容 → 画面に返す形 ──

/** 旧来のテンプレート(editor_type が無い)も、編集画面で開けるように、できる範囲で入力データに直す */
function inferEditor(row: LibraryTemplate): { editorType: EditorType | 'legacy_flex' | 'pack'; editorData: unknown } {
  if (row.kind === 'pack') return { editorType: 'pack', editorData: null };
  if (row.editor_type) {
    try {
      return { editorType: row.editor_type as EditorType, editorData: row.editor_data ? JSON.parse(row.editor_data) : emptyEditorData(row.editor_type as EditorType) };
    } catch {
      return { editorType: row.editor_type as EditorType, editorData: emptyEditorData(row.editor_type as EditorType) };
    }
  }
  if (row.message_type === 'text') return { editorType: 'text', editorData: { text: row.message_content, urlSettings: { links: [] } } };
  if (row.message_type === 'image') {
    try {
      const p = JSON.parse(row.message_content) as { originalContentUrl?: string };
      return { editorType: 'image', editorData: { imageUrl: p.originalContentUrl ?? '', layout: 'none', areas: [] } };
    } catch {
      return { editorType: 'image', editorData: emptyEditorData('image') };
    }
  }
  return { editorType: 'legacy_flex', editorData: { json: row.message_content } };
}

function legacyTypeLabel(row: LibraryTemplate): string {
  if (row.kind === 'pack') return 'パック';
  if (row.kind === 'flex') return 'フレックスメッセージ';
  if (row.editor_type) return EDITOR_TYPE_LABEL[row.editor_type as EditorType] ?? row.editor_type;
  if (row.message_type === 'text') return 'テキスト';
  if (row.message_type === 'image') return '画像';
  if (row.message_type === 'carousel') return 'カルーセル';
  return 'フレックスメッセージ';
}

function summaryOf(row: LibraryTemplate): string {
  if (row.kind === 'pack') return '';
  if (row.editor_type) {
    try {
      return describeTemplate(row.editor_type as EditorType, row.editor_data ? JSON.parse(row.editor_data) : null, '');
    } catch {
      return '';
    }
  }
  if (row.message_type === 'text') return (row.message_content.split('\n').find((l) => l.trim()) ?? '').slice(0, 80);
  if (row.message_type === 'image') return '[画像]';
  return '【フレックスメッセージ】';
}

function serialize(row: LibraryTemplate, extra?: Record<string, unknown>) {
  const inferred = inferEditor(row);
  return {
    id: row.id,
    name: row.name,
    lineAccountId: row.line_account_id,
    folderId: row.folder_id,
    displayOrder: row.display_order,
    kind: row.kind,
    typeLabel: legacyTypeLabel(row),
    editorType: inferred.editorType,
    editorData: inferred.editorData,
    legacy: row.editor_type === null && row.kind !== 'pack',
    messageType: row.message_type,
    messageContent: row.message_content,
    senderId: row.sender_id,
    allowSenderOverride: row.allow_sender_override === 1,
    summary: summaryOf(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(extra ?? {}),
  };
}

function serializeSummary(row: LibraryTemplate, extra?: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folder_id,
    displayOrder: row.display_order,
    kind: row.kind,
    typeLabel: legacyTypeLabel(row),
    editorType: row.editor_type,
    legacy: row.editor_type === null && row.kind !== 'pack',
    summary: summaryOf(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(extra ?? {}),
  };
}

// ── 入力の検査と変換 ──

interface ParsedInput {
  name: string;
  folderId: string | null;
  kind: TemplateKind;
  editorType: EditorType | 'pack';
  editorData: EditorData | null;
  senderId: string | null;
  allowSenderOverride: boolean;
  draftId: string | null;
}

function parseInput(body: Record<string, unknown>, opts: { partial: boolean; current?: LibraryTemplate }): { ok: true; value: Partial<ParsedInput> } | { ok: false; error: string } {
  const out: Partial<ParsedInput> = {};
  if (body.name !== undefined || !opts.partial) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { ok: false, error: 'テンプレート名を入力してください' };
    if (name.length > MAX_NAME) return { ok: false, error: `テンプレート名は${MAX_NAME}文字までです` };
    out.name = name;
  }
  if (body.folderId !== undefined) out.folderId = typeof body.folderId === 'string' && body.folderId ? body.folderId : null;
  if (body.kind !== undefined || !opts.partial) {
    const kind = body.kind === 'flex' ? 'flex' : body.kind === 'pack' ? 'pack' : 'standard';
    out.kind = kind;
  }
  const kind = out.kind ?? opts.current?.kind ?? 'standard';
  if (body.editorType !== undefined || !opts.partial) {
    const t = typeof body.editorType === 'string' ? body.editorType : '';
    if (kind === 'pack') out.editorType = 'pack';
    else if (kind === 'flex') out.editorType = 'flex';
    else if (STANDARD_TYPES.has(t)) out.editorType = t as EditorType;
    else return { ok: false, error: 'メッセージの種類が正しくありません' };
  }
  if (body.editorData !== undefined || (!opts.partial && kind !== 'pack')) {
    if (kind === 'pack') out.editorData = null;
    else if (body.editorData && typeof body.editorData === 'object') out.editorData = body.editorData as EditorData;
    else return { ok: false, error: '内容が正しくありません' };
  }
  if (body.senderId !== undefined) out.senderId = typeof body.senderId === 'string' && body.senderId ? body.senderId : null;
  if (body.allowSenderOverride !== undefined) out.allowSenderOverride = body.allowSenderOverride === true;
  out.draftId = typeof body.draftId === 'string' && body.draftId ? body.draftId : null;
  return { ok: true, value: out };
}

async function compileFor(c: Context<Env>, templateId: string, editorType: EditorType, editorData: EditorData, senderId: string | null): Promise<{ ok: true; compiled: CompiledTemplate } | { ok: false; error: string }> {
  const errors = validateTemplate(editorType, editorData);
  if (errors.length > 0) return { ok: false, error: errors[0] };
  const sender = await senderOf(c, senderId);
  const compiled = compileTemplate(editorType, editorData, { templateId, workerUrl: workerUrlOf(c), sender });
  if (compiled.messages.length > 5) return { ok: false, error: 'メッセージが長すぎて、5通を超えてしまいます' };
  return { ok: true, compiled };
}

// ── パックを作り直す(中身の送る形をつなげて、パック自身の保存内容にする) ──

async function rebuildPack(c: Context<Env>, packId: string): Promise<void> {
  const items = await listPackItems(c.env.DB, packId);
  const messages: unknown[] = [];
  for (const it of items) {
    let type: string | null = it.message_type;
    let content: string | null = it.message_content;
    if (it.template_id) {
      const t = await getLibraryTemplate(c.env.DB, it.template_id);
      if (!t) continue;
      type = t.message_type;
      content = t.message_content;
    }
    if (!type || content === null) continue;
    messages.push(...buildMessages(type, content));
  }
  const { TEMPLATE_RAW_KEY } = await import('@line-crm/shared');
  await updateLibraryTemplate(c.env.DB, packId, {
    messageType: 'flex',
    messageContent: JSON.stringify({ [TEMPLATE_RAW_KEY]: messages.slice(0, 5) }),
  });
}

async function rebuildPacksReferencing(c: Context<Env>, templateId: string): Promise<void> {
  for (const packId of await listPacksReferencing(c.env.DB, templateId)) await rebuildPack(c, packId);
}

// ── フォルダ ──

templateLibrary.get('/api/tpl/folders', async (c) => {
  try {
    const r = await accountOr400(c, c.req.query('lineAccountId'));
    if ('error' in r) return r.error;
    const [folders, unfiled] = await Promise.all([listTemplateFolders(c.env.DB, r.account.id), countUnfiledTemplates(c.env.DB, r.account.id)]);
    return c.json({ success: true, data: { folders: folders.map((f) => ({ id: f.id, name: f.name, count: f.template_count })), unfiledCount: unfiled } });
  } catch (err) {
    console.error('GET /api/tpl/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.put('/api/tpl/folders/order', async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string; ids?: string[] }>().catch(() => ({}) as { lineAccountId?: string; ids?: string[] });
    const r = await accountOr400(c, body.lineAccountId);
    if ('error' in r) return r.error;
    if (!Array.isArray(body.ids)) return c.json({ success: false, error: 'ids が必要です' }, 400);
    await reorderTemplateFolders(c.env.DB, r.account.id, body.ids);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/tpl/folders/order error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.post('/api/tpl/folders', async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string; name?: string }>().catch(() => ({}) as { lineAccountId?: string; name?: string });
    const r = await accountOr400(c, body.lineAccountId);
    if ('error' in r) return r.error;
    const name = (body.name ?? '').trim();
    if (!name) return c.json({ success: false, error: 'フォルダ名を入力してください' }, 400);
    if (name.length > 100) return c.json({ success: false, error: 'フォルダ名は100文字までです' }, 400);
    const folder = await createTemplateFolder(c.env.DB, r.account.id, name);
    return c.json({ success: true, data: { id: folder.id, name: folder.name } }, 201);
  } catch (err) {
    console.error('POST /api/tpl/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.put('/api/tpl/folders/:id', async (c) => {
  try {
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const name = (body.name ?? '').trim();
    if (!name) return c.json({ success: false, error: 'フォルダ名を入力してください' }, 400);
    if (name.length > 100) return c.json({ success: false, error: 'フォルダ名は100文字までです' }, 400);
    const folder = await renameTemplateFolder(c.env.DB, c.req.param('id'), name);
    if (!folder) return c.json({ success: false, error: 'フォルダが見つかりません' }, 404);
    return c.json({ success: true, data: { id: folder.id, name: folder.name } });
  } catch (err) {
    console.error('PUT /api/tpl/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.delete('/api/tpl/folders/:id', async (c) => {
  try {
    await deleteTemplateFolder(c.env.DB, c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tpl/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── 一覧 ──

templateLibrary.get('/api/tpl/items', async (c) => {
  try {
    const r = await accountOr400(c, c.req.query('lineAccountId'));
    if ('error' in r) return r.error;
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(c.req.query('pageSize') ?? '', 10) || PAGE_DEFAULT));
    const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '', 10) || 1);
    const q = (c.req.query('q') ?? '').trim().slice(0, 500);
    const folder = c.req.query('folder') || 'none';
    const { items, total } = await listLibraryTemplates(c.env.DB, { lineAccountId: r.account.id, folder, q, limit: pageSize, offset: (page - 1) * pageSize });
    // パックは、中のメッセージ数を添える
    const packIds = items.filter((t) => t.kind === 'pack').map((t) => t.id);
    const counts = new Map<string, number>();
    for (const id of packIds) counts.set(id, (await listPackItems(c.env.DB, id)).length);
    return c.json({
      success: true,
      data: { items: items.map((t) => serializeSummary(t, t.kind === 'pack' ? { packCount: counts.get(t.id) ?? 0 } : undefined)), total, page, pageSize },
    });
  } catch (err) {
    console.error('GET /api/tpl/items error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.put('/api/tpl/items/order', async (c) => {
  try {
    const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
    if (!Array.isArray(body.ids)) return c.json({ success: false, error: 'ids が必要です' }, 400);
    await reorderLibraryTemplates(c.env.DB, body.ids);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/tpl/items/order error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.put('/api/tpl/items/move', async (c) => {
  try {
    const body = await c.req.json<{ ids?: string[]; folderId?: string | null }>().catch(() => ({}) as { ids?: string[]; folderId?: string | null });
    if (!Array.isArray(body.ids)) return c.json({ success: false, error: 'ids が必要です' }, 400);
    const folderId = body.folderId || null;
    if (folderId && !(await getTemplateFolder(c.env.DB, folderId))) return c.json({ success: false, error: 'フォルダが見つかりません' }, 404);
    await moveLibraryTemplates(c.env.DB, body.ids, folderId);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/tpl/items/move error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.post('/api/tpl/items/delete', async (c) => {
  try {
    const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
    if (!Array.isArray(body.ids)) return c.json({ success: false, error: 'ids が必要です' }, 400);
    await deleteLibraryTemplates(c.env.DB, body.ids);
    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/tpl/items/delete error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── 作成 ──

templateLibrary.post('/api/tpl/items', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const r = await accountOr400(c, typeof body.lineAccountId === 'string' ? body.lineAccountId : null);
    if ('error' in r) return r.error;
    const parsed = parseInput(body, { partial: false });
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    const v = parsed.value;
    const fe = await folderError(c, v.folderId, r.account.id);
    if (fe) return c.json({ success: false, error: fe }, 400);

    const id = crypto.randomUUID();
    let messageType = 'flex';
    let messageContent = JSON.stringify({ lineMessages: [] });
    if (v.kind !== 'pack') {
      const comp = await compileFor(c, id, v.editorType as EditorType, v.editorData as EditorData, v.senderId ?? null);
      if (!comp.ok) return c.json({ success: false, error: comp.error }, 400);
      messageType = comp.compiled.messageType;
      messageContent = comp.compiled.messageContent;
    }
    const row = await createLibraryTemplate(c.env.DB, {
      id,
      name: v.name!,
      lineAccountId: r.account.id,
      folderId: v.folderId ?? null,
      kind: v.kind!,
      editorType: v.editorType ?? null,
      editorData: v.editorData ? JSON.stringify(v.editorData) : null,
      messageType,
      messageContent,
      senderId: v.senderId ?? null,
      allowSenderOverride: v.allowSenderOverride ?? false,
    });
    if (v.draftId) await deleteTemplateDrafts(c.env.DB, [v.draftId]);
    return c.json({ success: true, data: serialize(row) }, 201);
  } catch (err) {
    console.error('POST /api/tpl/items error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.get('/api/tpl/items/:id', async (c) => {
  try {
    const row = await getLibraryTemplate(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'テンプレートが見つかりません' }, 404);
    return c.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('GET /api/tpl/items/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.put('/api/tpl/items/:id', async (c) => {
  try {
    const row = await getLibraryTemplate(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'テンプレートが見つかりません' }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);

    // 旧来のテンプレート(editor_type なし)の「JSONそのまま」保存(フレックスなど)
    if (row.editor_type === null && row.kind !== 'pack' && typeof (body as { legacyContent?: unknown }).legacyContent === 'string') {
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : row.name;
      const updated = await updateLibraryTemplate(c.env.DB, row.id, {
        name,
        folderId: body.folderId === undefined ? undefined : ((body.folderId as string | null) || null),
        messageContent: (body as { legacyContent: string }).legacyContent,
      });
      await rebuildPacksReferencing(c, row.id);
      return c.json({ success: true, data: serialize(updated ?? row) });
    }

    const parsed = parseInput(body, { partial: true, current: row });
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    const v = parsed.value;
    const accountId = row.line_account_id ?? (typeof body.lineAccountId === 'string' ? body.lineAccountId : null);
    if (v.folderId && accountId) {
      const fe = await folderError(c, v.folderId, accountId);
      if (fe) return c.json({ success: false, error: fe }, 400);
    }

    const update: Parameters<typeof updateLibraryTemplate>[2] = {};
    if (v.name !== undefined) update.name = v.name;
    if (v.folderId !== undefined) update.folderId = v.folderId;
    if (v.senderId !== undefined) update.senderId = v.senderId;
    if (v.allowSenderOverride !== undefined) update.allowSenderOverride = v.allowSenderOverride;

    if (row.kind !== 'pack' && (v.editorData !== undefined || v.senderId !== undefined || v.editorType !== undefined)) {
      const editorType = (v.editorType ?? inferEditor(row).editorType) as EditorType;
      const editorData = (v.editorData ?? (inferEditor(row).editorData as EditorData)) as EditorData;
      if (editorType !== ('legacy_flex' as unknown)) {
        const comp = await compileFor(c, row.id, editorType, editorData, v.senderId !== undefined ? v.senderId : row.sender_id);
        if (!comp.ok) return c.json({ success: false, error: comp.error }, 400);
        update.editorType = editorType;
        update.editorData = JSON.stringify(editorData);
        update.messageType = comp.compiled.messageType;
        update.messageContent = comp.compiled.messageContent;
      }
    }
    const updated = await updateLibraryTemplate(c.env.DB, row.id, update);
    if (body.draftId && typeof body.draftId === 'string') await deleteTemplateDrafts(c.env.DB, [body.draftId]);
    await rebuildPacksReferencing(c, row.id);
    return c.json({ success: true, data: serialize(updated ?? row) });
  } catch (err) {
    console.error('PUT /api/tpl/items/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.delete('/api/tpl/items/:id', async (c) => {
  try {
    await deleteLibraryTemplates(c.env.DB, [c.req.param('id')]);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tpl/items/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 回答率: 質問・カルーセル・フレックスの、選択肢ごとの「押した人数・回数」(パネルごとの帯グラフ用) */
templateLibrary.get('/api/tpl/items/:id/stats', async (c) => {
  try {
    const row = await getLibraryTemplate(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'テンプレートが見つかりません' }, 404);
    let data: Record<string, unknown> = {};
    try {
      data = row.editor_data ? (JSON.parse(row.editor_data) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    type Labelled = { label?: string };
    // パネルごとの選択肢(名前)
    let panels: Array<{ title: string; choices: string[] }> = [];
    if (row.editor_type === 'question') panels = [{ title: '質問', choices: ((data.choices as Labelled[]) ?? []).map((x) => x.label ?? '') }];
    else if (row.editor_type === 'carousel') {
      panels = ((data.panels as Array<{ choices?: Labelled[] }>) ?? []).map((p, i) => ({ title: `パネル#${i + 1}`, choices: (p.choices ?? []).map((x) => x.label ?? '') }));
    } else if (row.editor_type === 'flex') {
      panels = ((data.panels as Array<{ blocks?: Array<{ type: string; label?: string; action?: { kind?: string } }> }>) ?? []).map((p, i) => ({
        title: `パネル#${i + 1}`,
        choices: (p.blocks ?? []).map((b) => (b.action?.kind === 'actions' ? b.label || (b.type === 'button' ? 'ボタン' : b.type) : '')),
      }));
    } else return c.json({ success: true, data: { available: false, panels: [], answeredFriends: 0 } });

    const taps = await c.env.DB
      .prepare('SELECT panel, choice, COUNT(*) AS friends, SUM(count) AS taps FROM template_taps WHERE template_id = ? GROUP BY panel, choice')
      .bind(row.id)
      .all<{ panel: number; choice: number; friends: number; taps: number }>();
    const answered = await c.env.DB.prepare('SELECT COUNT(DISTINCT friend_id) AS n FROM template_taps WHERE template_id = ?').bind(row.id).first<{ n: number }>();
    const byKey = new Map((taps.results ?? []).map((t) => [`${t.panel}:${t.choice}`, t]));
    return c.json({
      success: true,
      data: {
        available: true,
        answeredFriends: answered?.n ?? 0,
        panels: panels.map((p, pi) => ({
          title: p.title,
          choices: p.choices
            .map((label, ci) => ({ choice: ci, label, friends: byKey.get(`${pi}:${ci}`)?.friends ?? 0, taps: byKey.get(`${pi}:${ci}`)?.taps ?? 0 }))
            .filter((x) => x.label),
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/tpl/items/:id/stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 「コピー」: 同じ内容・同じフォルダに「〇〇のコピー」を作る(パックは中身も) */
templateLibrary.post('/api/tpl/items/:id/copy', async (c) => {
  try {
    const row = await getLibraryTemplate(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'テンプレートが見つかりません' }, 404);
    const id = crypto.randomUUID();
    let messageType = row.message_type;
    let messageContent = row.message_content;
    // 質問・カルーセルは、押したときの動きがテンプレートIDに結びつくので、新しいIDで作り直す
    if (row.editor_type && row.kind !== 'pack' && row.editor_data) {
      const comp = await compileFor(c, id, row.editor_type as EditorType, JSON.parse(row.editor_data) as EditorData, row.sender_id);
      if (comp.ok) {
        messageType = comp.compiled.messageType;
        messageContent = comp.compiled.messageContent;
      }
    }
    const copy = await createLibraryTemplate(c.env.DB, {
      id,
      name: `${row.name}のコピー`.slice(0, MAX_NAME),
      lineAccountId: row.line_account_id,
      folderId: row.folder_id,
      kind: row.kind,
      editorType: row.editor_type,
      editorData: row.editor_data,
      messageType,
      messageContent,
      senderId: row.sender_id,
      allowSenderOverride: row.allow_sender_override === 1,
    });
    if (row.kind === 'pack') {
      for (const it of await listPackItems(c.env.DB, row.id)) {
        await addPackItem(c.env.DB, { packId: copy.id, templateId: it.template_id, editorType: it.editor_type, editorData: it.editor_data, messageType: it.message_type, messageContent: it.message_content });
      }
      await rebuildPack(c, copy.id);
    }
    return c.json({ success: true, data: serialize((await getLibraryTemplate(c.env.DB, copy.id)) ?? copy) }, 201);
  } catch (err) {
    console.error('POST /api/tpl/items/:id/copy error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── プレビュー・テスト送信 ──

/** 編集中の内容から、送る LINE メッセージを作って返す(保存しない。画面のプレビューの確認用) */
templateLibrary.post('/api/tpl/preview', async (c) => {
  try {
    type PreviewBody = { editorType?: string; editorData?: EditorData; senderId?: string | null; templateId?: string };
    const body = await c.req.json<PreviewBody>().catch((): PreviewBody => ({}));
    if (!body.editorType || !body.editorData) return c.json({ success: false, error: '内容が正しくありません' }, 400);
    const comp = await compileFor(c, body.templateId ?? 'preview', body.editorType as EditorType, body.editorData, body.senderId ?? null);
    if (!comp.ok) return c.json({ success: false, error: comp.error }, 400);
    return c.json({ success: true, data: { messages: comp.compiled.messages } });
  } catch (err) {
    console.error('POST /api/tpl/preview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function sendToTestRecipients(
  c: Context<Env>,
  accountId: string,
  type: string,
  content: string,
  friendIds: string[] | null,
): Promise<Response> {
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: '公式アカウントが見つかりません' }, 404);
  let ids = friendIds;
  if (!ids || ids.length === 0) {
    const setting = await c.env.DB.prepare(`SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'test_recipients'`).bind(accountId).first<{ value: string }>();
    ids = setting ? (JSON.parse(setting.value) as string[]) : [];
  }
  if (ids.length === 0) return c.json({ success: false, error: 'テスト送信の宛先を選んでください' }, 400);
  if (ids.length > MAX_TEST_RECIPIENTS) return c.json({ success: false, error: `テスト送信の宛先は${MAX_TEST_RECIPIENTS}人までです` }, 400);
  const placeholders = ids.map(() => '?').join(',');
  const friends = await c.env.DB
    .prepare(`SELECT id, line_user_id, display_name, real_name FROM friends WHERE id IN (${placeholders}) AND line_account_id = ? AND is_following = 1`)
    .bind(...ids, accountId)
    .all<{ id: string; line_user_id: string; display_name: string | null; real_name: string | null }>();
  if (friends.results.length === 0) return c.json({ success: false, error: '選んだ友だちには送れません(この公式アカウントの友だちではないか、ブロックされています)' }, 400);

  const lineClient = new LineClient(account.channel_access_token);
  const liffId = (account as unknown as { liff_id?: string | null }).liff_id ?? null;
  let sent = 0;
  let failed = 0;
  for (const friend of friends.results) {
    try {
      let rendered = renderBroadcastMessageContent(type, content, { liffId, displayName: friend.display_name, realName: friend.real_name });
      rendered = await expandFormLinks(c.env.DB, rendered, accountId);
      const messages = buildMessages(type, rendered);
      // 先頭に【テスト配信】の目印(文章のときだけ)
      const first = messages[0] as { type: string; text?: string };
      if (first.type === 'text' && typeof first.text === 'string') first.text = `【テスト配信】\n${first.text}`;
      await lineClient.pushMessage(friend.line_user_id, messages);
      sent++;
      await c.env.DB
        .prepare(`INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, delivery_type, source, created_at) VALUES (?, ?, 'outgoing', ?, ?, NULL, 'test', 'template', ?)`)
        .bind(crypto.randomUUID(), friend.id, type, rendered, jstNow())
        .run();
    } catch (err) {
      console.error(`Template test send to ${friend.id} failed:`, err);
      failed++;
    }
  }
  return c.json({ success: true, data: { sent, failed } });
}

/** 編集中の内容を、そのままテスト送信(保存しない) */
templateLibrary.post('/api/tpl/test-send', async (c) => {
  try {
    type TestBody = { lineAccountId?: string; editorType?: string; editorData?: EditorData; senderId?: string | null; friendIds?: string[]; packId?: string };
    const body = await c.req.json<TestBody>().catch((): TestBody => ({}));
    const r = await accountOr400(c, body.lineAccountId);
    if ('error' in r) return r.error;
    const friendIds = Array.isArray(body.friendIds) ? [...new Set(body.friendIds.filter((v): v is string => typeof v === 'string' && v.length > 0))] : null;
    if (body.packId) {
      const pack = await getLibraryTemplate(c.env.DB, body.packId);
      if (!pack) return c.json({ success: false, error: 'パックが見つかりません' }, 404);
      return sendToTestRecipients(c, r.account.id, pack.message_type, pack.message_content, friendIds);
    }
    if (!body.editorType || !body.editorData) return c.json({ success: false, error: '内容が正しくありません' }, 400);
    const comp = await compileFor(c, 'test', body.editorType as EditorType, body.editorData, body.senderId ?? null);
    if (!comp.ok) return c.json({ success: false, error: comp.error }, 400);
    return sendToTestRecipients(c, r.account.id, comp.compiled.messageType, comp.compiled.messageContent, friendIds);
  } catch (err) {
    console.error('POST /api/tpl/test-send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 保存済みのテンプレートを、テスト送信 */
templateLibrary.post('/api/tpl/items/:id/test-send', async (c) => {
  try {
    const row = await getLibraryTemplate(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'テンプレートが見つかりません' }, 404);
    const body = await c.req.json<{ lineAccountId?: string; friendIds?: string[] }>().catch(() => ({}) as { lineAccountId?: string; friendIds?: string[] });
    const accountId = row.line_account_id ?? body.lineAccountId;
    const r = await accountOr400(c, accountId);
    if ('error' in r) return r.error;
    const friendIds = Array.isArray(body.friendIds) ? [...new Set(body.friendIds.filter((v): v is string => typeof v === 'string' && v.length > 0))] : null;
    return sendToTestRecipients(c, r.account.id, row.message_type, row.message_content, friendIds);
  } catch (err) {
    console.error('POST /api/tpl/items/:id/test-send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── 送信者(送信名・アイコン) ──

templateLibrary.get('/api/tpl/senders', async (c) => {
  try {
    const r = await accountOr400(c, c.req.query('lineAccountId'));
    if ('error' in r) return r.error;
    const rows = await listTemplateSenders(c.env.DB, r.account.id);
    return c.json({ success: true, data: rows.map((s) => ({ id: s.id, name: s.name, iconUrl: s.icon_url })) });
  } catch (err) {
    console.error('GET /api/tpl/senders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.post('/api/tpl/senders', async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string; name?: string; iconUrl?: string | null }>().catch(() => ({}) as { lineAccountId?: string; name?: string; iconUrl?: string | null });
    const r = await accountOr400(c, body.lineAccountId);
    if ('error' in r) return r.error;
    const name = (body.name ?? '').trim();
    if (!name) return c.json({ success: false, error: '送信名を入力してください' }, 400);
    if (name.length > 20) return c.json({ success: false, error: '送信名は20文字までです(LINEの決まり)' }, 400);
    const icon = typeof body.iconUrl === 'string' && body.iconUrl.startsWith('https://') ? body.iconUrl : null;
    const s = await createTemplateSender(c.env.DB, r.account.id, name, icon);
    return c.json({ success: true, data: { id: s.id, name: s.name, iconUrl: s.icon_url } }, 201);
  } catch (err) {
    console.error('POST /api/tpl/senders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.delete('/api/tpl/senders/:id', async (c) => {
  try {
    await deleteTemplateSender(c.env.DB, c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tpl/senders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── 下書き ──

function serializeDraft(d: Awaited<ReturnType<typeof getTemplateDraft>> & object) {
  let editorData: unknown = null;
  try {
    editorData = JSON.parse(d.editor_data);
  } catch {
    editorData = null;
  }
  return {
    id: d.id,
    templateId: d.template_id,
    kind: d.kind,
    editorType: d.editor_type,
    typeLabel: d.kind === 'flex' ? 'フレックスメッセージ' : (EDITOR_TYPE_LABEL[d.editor_type as EditorType] ?? d.editor_type),
    name: d.name,
    folderId: d.folder_id,
    editorData,
    senderId: d.sender_id,
    allowSenderOverride: d.allow_sender_override === 1,
    summary: describeTemplate(d.editor_type as EditorType, editorData, ''),
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

templateLibrary.get('/api/tpl/drafts', async (c) => {
  try {
    const r = await accountOr400(c, c.req.query('lineAccountId'));
    if ('error' in r) return r.error;
    const rows = await listTemplateDrafts(c.env.DB, r.account.id);
    return c.json({ success: true, data: rows.map(serializeDraft) });
  } catch (err) {
    console.error('GET /api/tpl/drafts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.post('/api/tpl/drafts/delete', async (c) => {
  try {
    const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
    if (!Array.isArray(body.ids)) return c.json({ success: false, error: 'ids が必要です' }, 400);
    await deleteTemplateDrafts(c.env.DB, body.ids);
    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/tpl/drafts/delete error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.get('/api/tpl/drafts/:id', async (c) => {
  try {
    const d = await getTemplateDraft(c.env.DB, c.req.param('id'));
    if (!d) return c.json({ success: false, error: '下書きが見つかりません' }, 404);
    return c.json({ success: true, data: serializeDraft(d) });
  } catch (err) {
    console.error('GET /api/tpl/drafts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function saveDraft(c: Context<Env>, id?: string): Promise<Response> {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const r = await accountOr400(c, typeof body.lineAccountId === 'string' ? body.lineAccountId : null);
  if ('error' in r) return r.error as Response;
  const kind = body.kind === 'flex' ? 'flex' : 'standard';
  const editorType = typeof body.editorType === 'string' ? body.editorType : '';
  if (!(kind === 'flex' ? editorType === 'flex' : STANDARD_TYPES.has(editorType))) return c.json({ success: false, error: 'メッセージの種類が正しくありません' }, 400);
  if (!body.editorData || typeof body.editorData !== 'object') return c.json({ success: false, error: '内容が正しくありません' }, 400);
  // 下書きは、途中の内容でも保存できる(検査しない)。名前が空なら「(名称未設定)」
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, MAX_NAME) : '';
  const d = await saveTemplateDraft(
    c.env.DB,
    {
      lineAccountId: r.account.id,
      templateId: typeof body.templateId === 'string' ? body.templateId : null,
      kind,
      editorType,
      name,
      folderId: typeof body.folderId === 'string' && body.folderId ? body.folderId : null,
      editorData: JSON.stringify(body.editorData),
      senderId: typeof body.senderId === 'string' && body.senderId ? body.senderId : null,
      allowSenderOverride: body.allowSenderOverride === true,
    },
    id,
  );
  return c.json({ success: true, data: serializeDraft(d) }, id ? 200 : 201);
}

templateLibrary.post('/api/tpl/drafts', async (c) => {
  try {
    return await saveDraft(c);
  } catch (err) {
    console.error('POST /api/tpl/drafts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.put('/api/tpl/drafts/:id', async (c) => {
  try {
    if (!(await getTemplateDraft(c.env.DB, c.req.param('id')))) return c.json({ success: false, error: '下書きが見つかりません' }, 404);
    return await saveDraft(c, c.req.param('id'));
  } catch (err) {
    console.error('PUT /api/tpl/drafts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── パック ──

function serializePackItem(it: PackItem, tpl: LibraryTemplate | null) {
  const src = tpl;
  const editorType = src ? (src.editor_type ?? (src.message_type === 'text' ? 'text' : src.message_type === 'image' ? 'image' : null)) : it.editor_type;
  let summary = '';
  if (src) summary = summaryOf(src);
  else if (it.editor_type) {
    try {
      summary = describeTemplate(it.editor_type as EditorType, it.editor_data ? JSON.parse(it.editor_data) : null, '');
    } catch {
      summary = '';
    }
  }
  return {
    id: it.id,
    position: it.position,
    templateId: it.template_id,
    templateName: src?.name ?? null,
    templateMissing: it.template_id !== null && !src,
    editorType,
    typeLabel: src ? legacyTypeLabel(src) : it.editor_type ? (EDITOR_TYPE_LABEL[it.editor_type as EditorType] ?? it.editor_type) : '',
    summary,
    editorData: it.editor_data ? safeJson(it.editor_data) : null,
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

templateLibrary.get('/api/tpl/packs/:id', async (c) => {
  try {
    const pack = await getLibraryTemplate(c.env.DB, c.req.param('id'));
    if (!pack || pack.kind !== 'pack') return c.json({ success: false, error: 'パックが見つかりません' }, 404);
    const items = await listPackItems(c.env.DB, pack.id);
    const out = [];
    for (const it of items) out.push(serializePackItem(it, it.template_id ? await getLibraryTemplate(c.env.DB, it.template_id) : null));
    return c.json({ success: true, data: { ...serialize(pack), items: out } });
  } catch (err) {
    console.error('GET /api/tpl/packs/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.put('/api/tpl/packs/:id/order', async (c) => {
  try {
    const pack = await getLibraryTemplate(c.env.DB, c.req.param('id'));
    if (!pack || pack.kind !== 'pack') return c.json({ success: false, error: 'パックが見つかりません' }, 404);
    const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
    if (!Array.isArray(body.ids)) return c.json({ success: false, error: 'ids が必要です' }, 400);
    await reorderPackItems(c.env.DB, body.ids);
    await rebuildPack(c, pack.id);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/tpl/packs/:id/order error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** パックにメッセージを足す。templateId(テンプレートから追加)か、editorType+editorData(新規追加) */
templateLibrary.post('/api/tpl/packs/:id/items', async (c) => {
  try {
    const pack = await getLibraryTemplate(c.env.DB, c.req.param('id'));
    if (!pack || pack.kind !== 'pack') return c.json({ success: false, error: 'パックが見つかりません' }, 404);
    const existing = await listPackItems(c.env.DB, pack.id);
    if (existing.length >= 5) return c.json({ success: false, error: 'パックに入れられるのは5通までです' }, 400);
    type AddBody = { templateId?: string; editorType?: string; editorData?: EditorData };
    const body = await c.req.json<AddBody>().catch((): AddBody => ({}));
    let item: PackItem;
    if (body.templateId) {
      const t = await getLibraryTemplate(c.env.DB, body.templateId);
      if (!t) return c.json({ success: false, error: 'テンプレートが見つかりません' }, 404);
      if (t.kind === 'pack') return c.json({ success: false, error: 'パックの中にパックは入れられません' }, 400);
      item = await addPackItem(c.env.DB, { packId: pack.id, templateId: t.id });
    } else {
      if (!body.editorType || !body.editorData || !STANDARD_TYPES.has(body.editorType)) return c.json({ success: false, error: '内容が正しくありません' }, 400);
      const comp = await compileFor(c, pack.id, body.editorType as EditorType, body.editorData, pack.sender_id);
      if (!comp.ok) return c.json({ success: false, error: comp.error }, 400);
      item = await addPackItem(c.env.DB, {
        packId: pack.id,
        editorType: body.editorType,
        editorData: JSON.stringify(body.editorData),
        messageType: comp.compiled.messageType,
        messageContent: comp.compiled.messageContent,
      });
    }
    await rebuildPack(c, pack.id);
    return c.json({ success: true, data: serializePackItem(item, item.template_id ? await getLibraryTemplate(c.env.DB, item.template_id) : null) }, 201);
  } catch (err) {
    console.error('POST /api/tpl/packs/:id/items error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.put('/api/tpl/pack-items/:id', async (c) => {
  try {
    const item = await getPackItem(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'メッセージが見つかりません' }, 404);
    if (item.template_id) return c.json({ success: false, error: 'テンプレートを参照しているメッセージは、テンプレートを編集してください' }, 400);
    type ItemBody = { editorType?: string; editorData?: EditorData };
    const body = await c.req.json<ItemBody>().catch((): ItemBody => ({}));
    if (!body.editorType || !body.editorData || !STANDARD_TYPES.has(body.editorType)) return c.json({ success: false, error: '内容が正しくありません' }, 400);
    const comp = await compileFor(c, item.pack_id, body.editorType as EditorType, body.editorData, null);
    if (!comp.ok) return c.json({ success: false, error: comp.error }, 400);
    const updated = await updatePackItem(c.env.DB, item.id, {
      editorType: body.editorType,
      editorData: JSON.stringify(body.editorData),
      messageType: comp.compiled.messageType,
      messageContent: comp.compiled.messageContent,
    });
    await rebuildPack(c, item.pack_id);
    return c.json({ success: true, data: serializePackItem(updated ?? item, null) });
  } catch (err) {
    console.error('PUT /api/tpl/pack-items/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templateLibrary.delete('/api/tpl/pack-items/:id', async (c) => {
  try {
    const item = await getPackItem(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'メッセージが見つかりません' }, 404);
    await deletePackItem(c.env.DB, item.id);
    await rebuildPack(c, item.pack_id);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tpl/pack-items/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
