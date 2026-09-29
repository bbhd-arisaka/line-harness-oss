import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getStaffById: vi.fn(),
  getLineAccountById: vi.fn(),
  setStaffAccountAccess: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getStaffMembers: vi.fn(),
  getStaffById: mocks.getStaffById,
  createStaffMember: vi.fn(),
  updateStaffMember: vi.fn(),
  deleteStaffMember: vi.fn(),
  regenerateStaffApiKey: vi.fn(),
  countActiveStaffByRole: vi.fn(),
  getStaffAllowedAccountIds: vi.fn(),
  getAllStaffAccountAccess: vi.fn(),
  setStaffAccountAccess: mocks.setStaffAccountAccess,
  getLineAccountById: mocks.getLineAccountById,
}));

import { staff } from './staff.js';

function put(body: unknown, role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'me', name: 'me', role });
    await next();
  });
  app.route('/', staff);
  return app.request('/api/staff/s1/accounts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: {} } as unknown as Env['Bindings']);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStaffById.mockResolvedValue({ id: 's1', role: 'staff', is_active: 1 });
  mocks.getLineAccountById.mockImplementation(async (_db, id: string) => (id.startsWith('acc-') ? { id } : null));
  mocks.setStaffAccountAccess.mockImplementation(async (_db, _id, ids: string[]) => (ids.length ? ids : null));
});

describe('PUT /api/staff/:id/accounts', () => {
  test('選んだアカウントだけを保存する', async () => {
    const res = await put({ accountIds: ['acc-a', 'acc-a', 'acc-b'] });
    expect(res.status).toBe(200);
    expect(mocks.setStaffAccountAccess).toHaveBeenCalledWith(expect.anything(), 's1', ['acc-a', 'acc-b']);
  });

  test('空配列は「制限なし」(全アカウント)', async () => {
    const res = await put({ accountIds: [] });
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { accountIds: unknown } }).data.accountIds).toBeNull();
  });

  test('存在しないアカウントを含むと拒否する(意図せず「制限なし」になるのを防ぐ)', async () => {
    const res = await put({ accountIds: ['ghost'] });
    expect(res.status).toBe(400);
    expect(mocks.setStaffAccountAccess).not.toHaveBeenCalled();
  });

  test('オーナーは制限できない', async () => {
    mocks.getStaffById.mockResolvedValue({ id: 's1', role: 'owner', is_active: 1 });
    expect((await put({ accountIds: ['acc-a'] })).status).toBe(400);
    expect(mocks.setStaffAccountAccess).not.toHaveBeenCalled();
  });

  test('配列以外は拒否、オーナー以外は操作できない', async () => {
    expect((await put({ accountIds: 'acc-a' })).status).toBe(400);
    expect((await put({ accountIds: ['acc-a'] }, 'admin')).status).toBe(403);
    expect(mocks.setStaffAccountAccess).not.toHaveBeenCalled();
  });
});
