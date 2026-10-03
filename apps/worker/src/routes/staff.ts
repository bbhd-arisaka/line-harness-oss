import { Hono } from 'hono';
import {
  cancelStaffDeletionRequest,
  getStaffMembers,
  getStaffById,
  createStaffMember,
  updateStaffMember,
  deleteStaffMember,
  regenerateStaffApiKey,
  countActiveStaffByRole,
  getStaffAllowedAccountIds,
  getAllStaffAccountAccess,
  setStaffAccountAccess,
  getLineAccountById,
} from '@line-crm/db';
import type { StaffMember } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import { syncExternalUsers } from '../services/external-auth.js';
import type { Env } from '../index.js';

const staff = new Hono<Env>();

function maskApiKey(key: string): string {
  return `lh_****${key.slice(-4)}`;
}

const EXTERNAL_MANAGED = 'beyond admin で管理されているユーザーです。名前・メール・役割・パスワード・停止は beyond admin で変更してください。';

/** 見られるアカウント。beyond admin から入った人(オーナー以外)は、許可するまで空(どのアカウントも見られない) */
function effectiveAccountIds(row: StaffMember, rows: string[] | null): string[] | null {
  if (rows && rows.length > 0) return rows;
  return row.access_restricted && row.role !== 'owner' ? [] : null;
}

function serializeStaff(row: StaffMember, masked = true, accountIds: string[] | null = null) {
  const external = !!row.external_id;
  return {
    /** beyond admin のユーザー(名前・役割・パスワードは beyond admin で管理) */
    external,
    /** 見られるアカウント。null = 制限なし(全アカウント) */
    accountIds,
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    apiKey: external ? null : masked ? maskApiKey(row.api_key) : row.api_key,
    isActive: Boolean(row.is_active),
    /** アプリから削除を申請した時刻(申請中は入れない)。オーナーが beyond admin で削除する */
    deletionRequestedAt: row.deletion_requested_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/staff/me — any authenticated user (MUST be before /:id)
staff.get('/api/staff/me', async (c) => {
  try {
    const currentStaff = c.get('staff');

    // env-owner: return minimal info
    if (currentStaff.id === 'env-owner') {
      return c.json({
        success: true,
        data: {
          id: 'env-owner',
          name: 'Owner',
          role: 'owner',
          email: null,
          accountIds: null,
        },
      });
    }

    const member = await getStaffById(c.env.DB, currentStaff.id);
    if (!member) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        id: member.id,
        name: member.name,
        role: member.role,
        email: member.email,
        accountIds: member.role === 'owner' ? null : await getStaffAllowedAccountIds(c.env.DB, member.id),
      },
    });
  } catch (err) {
    console.error('GET /api/staff/me error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/staff — owner only. List all staff with masked API keys.
staff.get('/api/staff', requireRole('owner'), async (c) => {
  try {
    // beyond admin のユーザー(まだ一度もログインしていない人も)を、先に映す。取れなくても一覧は返す
    await syncExternalUsers(c.env.DB, c.env).catch((err) => console.error('syncExternalUsers failed:', err));
    const members = await getStaffMembers(c.env.DB);
    const access = await getAllStaffAccountAccess(c.env.DB);
    return c.json({ success: true, data: members.map((m) => serializeStaff(m, true, effectiveAccountIds(m, access.get(m.id) ?? null))) });
  } catch (err) {
    console.error('GET /api/staff error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/staff/:id — owner only. Get staff detail with masked key.
staff.get('/api/staff/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const member = await getStaffById(c.env.DB, id);
    if (!member) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }
    return c.json({ success: true, data: serializeStaff(member, true, effectiveAccountIds(member, await getStaffAllowedAccountIds(c.env.DB, member.id))) });
  } catch (err) {
    console.error('GET /api/staff/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/staff — owner only. Create staff. Returns full API key (one-time visible).
staff.post('/api/staff', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ name: string; email?: string; role: string }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const validRoles = ['owner', 'admin', 'staff'] as const;
    if (!body.role || !validRoles.includes(body.role as (typeof validRoles)[number])) {
      return c.json({ success: false, error: 'role must be owner, admin, or staff' }, 400);
    }

    const member = await createStaffMember(c.env.DB, {
      name: body.name,
      email: body.email ?? null,
      role: body.role as 'owner' | 'admin' | 'staff',
    });

    // Return full (unmasked) API key one-time
    return c.json({ success: true, data: serializeStaff(member, false) }, 201);
  } catch (err) {
    console.error('POST /api/staff error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/staff/:id/accounts — owner only. スタッフが見られる公式アカウントを設定する。
// accountIds が空 = 制限なし(全アカウント)。ただし beyond admin から入った人は、空 = どのアカウントも見られない。オーナーは常に全アカウントなので設定不可。
staff.put('/api/staff/:id/accounts', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{ accountIds?: unknown }>();
    if (!Array.isArray(body.accountIds) || body.accountIds.some((v) => typeof v !== 'string')) {
      return c.json({ success: false, error: 'accountIds must be an array of account ids' }, 400);
    }
    const accountIds = [...new Set(body.accountIds as string[])];
    const target = await getStaffById(c.env.DB, id);
    if (!target) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }
    if (target.role === 'owner' && accountIds.length > 0) {
      return c.json({ success: false, error: 'オーナーは常に全アカウントを扱えるため、制限できません' }, 400);
    }
    // 存在しないアカウントを指定して「意図せず制限なし」になるのを防ぐ
    for (const accountId of accountIds) {
      if (!(await getLineAccountById(c.env.DB, accountId))) {
        return c.json({ success: false, error: `LINE account not found: ${accountId}` }, 400);
      }
    }
    const saved = await setStaffAccountAccess(c.env.DB, id, accountIds);
    return c.json({ success: true, data: { accountIds: saved } });
  } catch (err) {
    console.error('PUT /api/staff/:id/accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/staff/:id — owner only. Update staff.
staff.patch('/api/staff/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{
      name?: string;
      email?: string | null;
      role?: string;
      isActive?: boolean;
    }>();

    const validRoles = ['owner', 'admin', 'staff'] as const;
    if (body.role !== undefined && !validRoles.includes(body.role as (typeof validRoles)[number])) {
      return c.json({ success: false, error: 'role must be owner, admin, or staff' }, 400);
    }

    // Prevent removing the last active owner
    const target = await getStaffById(c.env.DB, id);
    if (!target) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }
    if (target.external_id && (body.name !== undefined || body.email !== undefined || body.role !== undefined || body.isActive !== undefined)) {
      return c.json({ success: false, error: EXTERNAL_MANAGED }, 400);
    }
    if (target.role === 'owner' && target.is_active === 1) {
      const willLoseOwner =
        (body.role !== undefined && body.role !== 'owner') ||
        body.isActive === false;
      if (willLoseOwner) {
        const ownerCount = await countActiveStaffByRole(c.env.DB, 'owner');
        if (ownerCount <= 1) {
          return c.json({ success: false, error: 'オーナーは最低1人必要です' }, 400);
        }
      }
    }

    const updated = await updateStaffMember(c.env.DB, id, {
      name: body.name,
      email: body.email,
      role: body.role as 'owner' | 'admin' | 'staff' | undefined,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }

    return c.json({ success: true, data: serializeStaff(updated, true, effectiveAccountIds(updated, await getStaffAllowedAccountIds(c.env.DB, updated.id))) });
  } catch (err) {
    console.error('PATCH /api/staff/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/staff/:id/deletion-request/cancel — owner only. アプリからの削除申請を取り消す(誤って申請された人を戻す)
staff.post('/api/staff/:id/deletion-request/cancel', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const target = await getStaffById(c.env.DB, id);
    if (!target) return c.json({ success: false, error: 'Staff member not found' }, 404);
    await cancelStaffDeletionRequest(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('POST /api/staff/:id/deletion-request/cancel error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/staff/:id — owner only. Cannot delete self. Must keep at least 1 owner.
staff.delete('/api/staff/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const currentStaff = c.get('staff');

    if (id === currentStaff.id) {
      return c.json({ success: false, error: '自分自身は削除できません' }, 400);
    }

    const target = await getStaffById(c.env.DB, id);
    if (!target) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }

    if (target.external_id) {
      return c.json({ success: false, error: 'beyond admin で管理されているユーザーは削除できません(次にログインしたとき、また作られます)。入れたくないときは、beyond admin 側でユーザーを止めてください。' }, 400);
    }

    if (target.role === 'owner' && target.is_active === 1) {
      const ownerCount = await countActiveStaffByRole(c.env.DB, 'owner');
      if (ownerCount <= 1) {
        return c.json({ success: false, error: 'オーナーは最低1人必要です' }, 400);
      }
    }

    await deleteStaffMember(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/staff/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/staff/:id/regenerate-key — owner only. Return new API key.
staff.post('/api/staff/:id/regenerate-key', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const exists = await getStaffById(c.env.DB, id);
    if (!exists) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }
    if (exists.external_id) {
      return c.json({ success: false, error: 'beyond admin で管理されているユーザーは、API キーを使いません' }, 400);
    }
    const newKey = await regenerateStaffApiKey(c.env.DB, id);
    return c.json({ success: true, data: { apiKey: newKey } });
  } catch (err) {
    console.error('POST /api/staff/:id/regenerate-key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { staff };
