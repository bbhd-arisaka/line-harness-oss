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
    return c.json({ success: true, data: items.map(serializeDefinition) });
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
      defaultValue?: string | null;
      displayOrder?: number;
    }>();
    if (!body.fieldKey?.trim() || !body.label?.trim()) {
      return c.json({ success: false, error: 'fieldKey and label are required' }, 400);
    }
    const existing = await getFriendFieldDefinitionByKey(c.env.DB, body.fieldKey.trim());
    if (existing) {
      return c.json({ success: false, error: 'この項目キーは既に使われています' }, 400);
    }
    const definition = await createFriendFieldDefinition(c.env.DB, {
      folderId: body.folderId ?? null,
      fieldKey: body.fieldKey.trim(),
      label: body.label.trim(),
      fieldType: body.fieldType,
      options: body.options,
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

export { friendFields };
