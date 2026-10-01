import { Hono } from 'hono';
import { requireRole } from '../middleware/role-guard.js';
import {
  ImportError,
  applyFormConfigs,
  applyFriends,
  applySubmissions,
  finishImport,
  listImports,
  loadFieldKeys,
  loadTagIds,
  planDefinitions,
  planFormConfigs,
  planFriends,
  planSubmissions,
  startImport,
  undoImport,
  validateDefinitions,
  validateFormConfigs,
  validateFriends,
  validateSubmissions,
} from '../services/lstep-import.js';
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

// 計画: 取り込み用データを検証し、何が作られ・何が変わるかを数える(書き込みなし)
imports.post('/api/imports/lstep/plan', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ definitions?: unknown; friends?: unknown; forms?: { configs?: unknown; submissions?: unknown } }>();
    const defs = validateDefinitions(body.definitions);
    const plan = await planDefinitions(c.env.DB, defs);
    const friends = validateFriends(body.friends ?? [], new Set(defs.fields.map((f) => f.key)));
    const tagIds = await loadTagIds(c.env.DB);
    const configs = validateFormConfigs(body.forms?.configs);
    const submissions = validateSubmissions(body.forms?.submissions);
    return c.json({
      success: true,
      data: {
        definitions: plan,
        friends: await planFriends(c.env.DB, defs.accountId, friends, tagIds),
        forms: configs.length ? await planFormConfigs(c.env.DB, configs) : null,
        submissions: submissions.length ? await planSubmissions(c.env.DB, submissions) : null,
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
