import { Hono } from 'hono';
import { requireRole } from '../middleware/role-guard.js';
import {
  ImportError,
  applyFormConfigs,
  applyFriends,
  applyMessages,
  applySubmissions,
  finishImport,
  listImports,
  loadImportTargets,
  loadFieldKeys,
  loadTagIds,
  planDefinitions,
  planFormConfigs,
  planFriends,
  planMessages,
  planSubmissions,
  removeImportedMessages,
  startImport,
  undoImport,
  validateDefinitions,
  validateFormConfigs,
  validateFriends,
  validateMessages,
  validateSubmissions,
} from '../services/lstep-import.js';
import { linkReviewItems, listReviewItems, replaceReviewItems, unlinkReviewItem, updateReviewItem, validateReviewItems } from '../services/lstep-match-review.js';
import type { Env } from '../index.js';

/**
 * Lステップ → beyond line のデータ引き継ぎ(オーナー専用)。
 * 流れ: plan(計画・何も書かない) → start(定義を作る) → friends(友だちを数十人ずつ反映) → finish。
 * 取り消し: undo。
 */
const imports = new Hono<Env>();

function fail(c: { json: (b: unknown, s: 400 | 404 | 409 | 500) => Response }, err: unknown): Response {
  if (err instanceof ImportError) return c.json({ success: false, error: err.message }, err.status);
  console.error('imports error:', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
}

imports.get('/api/imports', requireRole('owner'), async (c) => {
  try {
    return c.json({ success: true, data: await listImports(c.env.DB) });
  } catch (err) {
    return fail(c, err);
  }
});

// 突き合わせの相手(取り込み先アカウントの友だち・フォーム・アカウント一覧)。読み取りのみ
imports.get('/api/imports/lstep/targets', requireRole('owner'), async (c) => {
  try {
    const accountId = c.req.query('accountId');
    if (!accountId) throw new ImportError('accountId を指定してください');
    return c.json({ success: true, data: await loadImportTargets(c.env.DB, accountId) });
  } catch (err) {
    return fail(c, err);
  }
});

// 計画: 取り込み用データを検証し、何が作られ・何が変わるかを数える(書き込みなし)
imports.post('/api/imports/lstep/plan', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ definitions?: unknown; friends?: unknown; forms?: { configs?: unknown; submissions?: unknown }; messages?: unknown }>();
    const defs = validateDefinitions(body.definitions);
    const plan = await planDefinitions(c.env.DB, defs);
    const friends = validateFriends(body.friends ?? [], new Set(defs.fields.map((f) => f.key)));
    const tagIds = await loadTagIds(c.env.DB);
    const configs = validateFormConfigs(body.forms?.configs);
    const submissions = validateSubmissions(body.forms?.submissions);
    const messages = validateMessages(body.messages);
    return c.json({
      success: true,
      data: {
        definitions: plan,
        friends: await planFriends(c.env.DB, defs.accountId, friends, tagIds),
        forms: configs.length ? await planFormConfigs(c.env.DB, configs) : null,
        submissions: submissions.length ? await planSubmissions(c.env.DB, submissions) : null,
        messages: messages.length ? await planMessages(c.env.DB, defs.accountId, messages) : null,
      },
    });
  } catch (err) {
    return fail(c, err);
  }
});

imports.post('/api/imports/lstep/start', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ definitions?: unknown }>();
    const defs = validateDefinitions(body.definitions);
    const staff = c.get('staff');
    return c.json({ success: true, data: await startImport(c.env.DB, defs, staff?.name ?? '不明') }, 201);
  } catch (err) {
    return fail(c, err);
  }
});

imports.post('/api/imports/lstep/:batchId/friends', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ friends?: unknown }>();
    const keys = await loadFieldKeys(c.env.DB);
    const friends = validateFriends(body.friends, keys);
    return c.json({ success: true, data: await applyFriends(c.env.DB, c.req.param('batchId')!, friends) });
  } catch (err) {
    return fail(c, err);
  }
});

imports.post('/api/imports/lstep/:batchId/forms', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ configs?: unknown }>();
    return c.json({ success: true, data: await applyFormConfigs(c.env.DB, c.req.param('batchId')!, validateFormConfigs(body.configs)) });
  } catch (err) {
    return fail(c, err);
  }
});

imports.post('/api/imports/lstep/:batchId/submissions', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ submissions?: unknown }>();
    return c.json({ success: true, data: await applySubmissions(c.env.DB, c.req.param('batchId')!, validateSubmissions(body.submissions)) });
  } catch (err) {
    return fail(c, err);
  }
});

// 照合できなかった人の確認リスト(画面で確認する)
imports.get('/api/imports/lstep/review', requireRole('owner'), async (c) => {
  try {
    const accountId = c.req.query('accountId');
    if (!accountId) throw new ImportError('accountId を指定してください');
    return c.json({ success: true, data: await listReviewItems(c.env.DB, accountId) });
  } catch (err) {
    return fail(c, err);
  }
});

imports.post('/api/imports/lstep/review', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; items?: unknown }>();
    if (typeof body.accountId !== 'string' || !body.accountId) throw new ImportError('accountId を指定してください');
    return c.json({ success: true, data: await replaceReviewItems(c.env.DB, body.accountId, validateReviewItems(body.items)) });
  } catch (err) {
    return fail(c, err);
  }
});

imports.put('/api/imports/lstep/review/:id', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ status?: unknown; note?: unknown; decision?: unknown; pictureUrl?: unknown; partnerPictureUrl?: unknown }>();
    const staff = c.get('staff');
    return c.json({ success: true, data: await updateReviewItem(c.env.DB, c.req.param('id')!, body, staff?.name ?? '不明') });
  } catch (err) {
    return fail(c, err);
  }
});

imports.post('/api/imports/lstep/review/:id/link', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ partnerRowId?: unknown }>();
    return c.json({ success: true, data: await linkReviewItems(c.env.DB, c.req.param('id')!, body.partnerRowId) });
  } catch (err) {
    return fail(c, err);
  }
});

imports.post('/api/imports/lstep/review/:id/unlink', requireRole('owner'), async (c) => {
  try {
    return c.json({ success: true, data: await unlinkReviewItem(c.env.DB, c.req.param('id')!) });
  } catch (err) {
    return fail(c, err);
  }
});

// 取り込んだ履歴のうち、別人の記録が混ざったメッセージを1件ずつ取り除く(元に戻せる)
imports.post('/api/imports/lstep/messages/remove', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ friendId?: unknown; messageIds?: unknown; reason?: unknown }>();
    const staff = c.get('staff');
    return c.json({ success: true, data: await removeImportedMessages(c.env.DB, body.friendId as string, body.messageIds, staff?.name ?? '不明', body.reason) });
  } catch (err) {
    return fail(c, err);
  }
});

imports.post('/api/imports/lstep/:batchId/messages', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ messages?: unknown }>();
    return c.json({ success: true, data: await applyMessages(c.env.DB, c.req.param('batchId')!, validateMessages(body.messages)) });
  } catch (err) {
    return fail(c, err);
  }
});

imports.post('/api/imports/lstep/:batchId/finish', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ summary?: unknown }>().catch(() => ({ summary: {} }));
    await finishImport(c.env.DB, c.req.param('batchId')!, body.summary);
    return c.json({ success: true, data: { finished: true } });
  } catch (err) {
    return fail(c, err);
  }
});

imports.post('/api/imports/:batchId/undo', requireRole('owner'), async (c) => {
  try {
    return c.json({ success: true, data: await undoImport(c.env.DB, c.req.param('batchId')!) });
  } catch (err) {
    return fail(c, err);
  }
});

export { imports };
