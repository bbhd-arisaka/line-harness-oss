import { Hono } from 'hono';
import {
  getFriendFieldFolders,
  createFriendFieldFolder,
  updateFriendFieldFolder,
  deleteFriendFieldFolder,
  getFriendFieldDefinitions,
  getFriendFieldDefinitionByKey,
  createFriendFieldDefinition,
  updateFriendFieldDefinition,
  deleteFriendFieldDefinition,
  countFriendsByFieldKey,
  reorderFriendFieldDefinitions,
  reorderFriendFieldFolders,
} from '@line-crm/db';
import type {
  FriendFieldFolder as DbFolder,
  FriendFieldDefinition as DbDefinition,
} from '@line-crm/db';
import type { Env } from '../index.js';

const friendFields = new Hono<Env>();

function serializeFolder(row: DbFolder) {
  return {
    id: row.id,
    name: row.name,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeDefinition(row: DbDefinition) {
  return {
    id: row.id,
    folderId: row.folder_id,
    fieldKey: row.field_key,
    label: row.label,
    fieldType: row.field_type,
    options: row.options ? (JSON.parse(row.options) as string[]) : [],
    optionColors: row.option_colors ? (JSON.parse(row.option_colors) as string[]) : [],
    isFavorite: Boolean(row.is_favorite),
    defaultValue: row.default_value,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Folders ──────────────────────────────────────────────────────────────────

friendFields.get('/api/friend-fields/folders', async (c) => {
  try {
    const items = await getFriendFieldFolders(c.env.DB);
    return c.json({ success: true, data: items.map(serializeFolder) });
  } catch (err) {
    console.error('GET /api/friend-fields/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendFields.post('/api/friend-fields/folders', async (c) => {
  try {
    const body = await c.req.json<{ name: string; displayOrder?: number }>();
    if (!body.name?.trim()) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }
    const folder = await createFriendFieldFolder(c.env.DB, {
      name: body.name.trim(),
      displayOrder: body.displayOrder,
    });
    return c.json({ success: true, data: serializeFolder(folder) }, 201);
  } catch (err) {
    console.error('POST /api/friend-fields/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendFields.put('/api/friend-fields/folders/:id', async (c) => {
  try {
    const body = await c.req.json<{ name?: string; displayOrder?: number }>();
    const folder = await updateFriendFieldFolder(c.env.DB, c.req.param('id'), body);
    if (!folder) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeFolder(folder) });
  } catch (err) {
    console.error('PUT /api/friend-fields/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendFields.delete('/api/friend-fields/folders/:id', async (c) => {
  try {
    await deleteFriendFieldFolder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/friend-fields/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── Definitions ──────────────────────────────────────────────────────────────

friendFields.get('/api/friend-fields/definitions', async (c) => {
  try {
    const items = await getFriendFieldDefinitions(c.env.DB);
    const counts = c.req.query('withCounts') === 'true'
      ? await countFriendsByFieldKey(c.env.DB, items.map((d) => d.field_key))
      : null;
    return c.json({
      success: true,
      data: items.map((d) => ({
        ...serializeDefinition(d),
        ...(counts ? { friendCount: counts[d.field_key] ?? 0 } : {}),
      })),
    });
  } catch (err) {
    console.error('GET /api/friend-fields/definitions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendFields.post('/api/friend-fields/definitions', async (c) => {
  try {
    const body = await c.req.json<{
      folderId?: string | null;
      fieldKey: string;
      label: string;
      fieldType?: DbDefinition['field_type'];
      options?: string[];
      optionColors?: string[];
      defaultValue?: string | null;
      displayOrder?: number;
    }>();
    if (!body.label?.trim()) {
      return c.json({ success: false, error: '友だち情報欄名を入力してください' }, 400);
    }
    // Lステップの登録画面には「キー」入力が無いので、未指定なら自動採番する
    const fieldKey = body.fieldKey?.trim() || `ff_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const existing = await getFriendFieldDefinitionByKey(c.env.DB, fieldKey);
    if (existing) {
      return c.json({ success: false, error: 'この項目キーは既に使われています' }, 400);
    }
    const definition = await createFriendFieldDefinition(c.env.DB, {
      folderId: body.folderId ?? null,
      fieldKey,
      label: body.label.trim(),
      fieldType: body.fieldType,
      options: body.options,
      optionColors: body.optionColors,
      defaultValue: body.defaultValue,
      displayOrder: body.displayOrder,
    });
    return c.json({ success: true, data: serializeDefinition(definition) }, 201);
  } catch (err) {
    console.error('POST /api/friend-fields/definitions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendFields.put('/api/friend-fields/definitions/:id', async (c) => {
  try {
    const body = await c.req.json<{
      folderId?: string | null;
      label?: string;
      fieldType?: DbDefinition['field_type'];
      options?: string[];
      optionColors?: string[];
      isFavorite?: boolean;
      defaultValue?: string | null;
      displayOrder?: number;
    }>();
    const definition = await updateFriendFieldDefinition(c.env.DB, c.req.param('id'), body);
    if (!definition) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeDefinition(definition) });
  } catch (err) {
    console.error('PUT /api/friend-fields/definitions/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendFields.delete('/api/friend-fields/definitions/:id', async (c) => {
  try {
    await deleteFriendFieldDefinition(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/friend-fields/definitions/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 並び替え(ドラッグ&ドロップ): 渡した ID の順に display_order を振り直す
friendFields.post('/api/friend-fields/definitions/reorder', async (c) => {
  try {
    const body = await c.req.json<{ ids: string[] }>();
    await reorderFriendFieldDefinitions(c.env.DB, Array.isArray(body.ids) ? body.ids : []);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('POST /api/friend-fields/definitions/reorder error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendFields.post('/api/friend-fields/folders/reorder', async (c) => {
  try {
    const body = await c.req.json<{ ids: string[] }>();
    await reorderFriendFieldFolders(c.env.DB, Array.isArray(body.ids) ? body.ids : []);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('POST /api/friend-fields/folders/reorder error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// コピー(⋮メニュー): 名前に「のコピー」を付けて、キーは新規採番。友だちの値はコピーしない
friendFields.post('/api/friend-fields/definitions/:id/copy', async (c) => {
  try {
    const defs = await getFriendFieldDefinitions(c.env.DB);
    const src = defs.find((d) => d.id === c.req.param('id'));
    if (!src) return c.json({ success: false, error: 'Not found' }, 404);
    const copy = await createFriendFieldDefinition(c.env.DB, {
      folderId: src.folder_id,
      fieldKey: `ff_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      label: `${src.label}のコピー`,
      fieldType: src.field_type,
      options: src.options ? (JSON.parse(src.options) as string[]) : null,
      optionColors: src.option_colors ? (JSON.parse(src.option_colors) as string[]) : null,
      defaultValue: src.default_value,
      displayOrder: src.display_order + 1,
    });
    return c.json({ success: true, data: serializeDefinition(copy) }, 201);
  } catch (err) {
    console.error('POST /api/friend-fields/definitions/:id/copy error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friendFields };
