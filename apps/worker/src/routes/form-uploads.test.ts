import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  verifyCallerLineUserId: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getFormById: mocks.getFormById,
  getFriendByLineUserId: mocks.getFriendByLineUserId,
}));
vi.mock('../services/liff-auth.js', () => ({ verifyCallerLineUserId: mocks.verifyCallerLineUserId }));

import { formUploads } from './form-uploads.js';

const FORM_ID = '11111111-1111-4111-8111-111111111111';

function makeApp() {
  const put = vi.fn(async () => undefined);
  const get = vi.fn();
  const app = new Hono<Env>();
  app.route('/', formUploads);
  const env = { DB: {}, IMAGES: { put, get }, WORKER_URL: 'https://api.example.test' } as unknown as Env['Bindings'];
  const call = (path: string, init?: RequestInit) => app.request(path, init, env);
  return { call, put, get };
}

function activeForm(fieldExtra: Record<string, unknown> = {}) {
  return {
    id: FORM_ID,
    is_active: 1,
    fields: JSON.stringify([{ name: 'photo', label: '写真', type: 'file', ...fieldExtra }]),
  };
}

const upload = (body: BodyInit, type: string, field = 'photo') => ({
  path: `/api/forms/${FORM_ID}/upload?field=${field}`,
  init: { method: 'POST', headers: { 'Content-Type': type, Authorization: 'Bearer t', 'X-Filename': encodeURIComponent('自撮り.jpg') }, body } as RequestInit,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyCallerLineUserId.mockResolvedValue('U123');
  mocks.getFriendByLineUserId.mockResolvedValue({ id: 'friend-1' });
  mocks.getFormById.mockResolvedValue(activeForm());
});

describe('POST /api/forms/:id/upload', () => {
  test('本人確認できなければ401', async () => {
    mocks.verifyCallerLineUserId.mockResolvedValue(null);
    const { call, put } = makeApp();
    const u = upload(new Uint8Array([1, 2, 3]), 'image/jpeg');
    const res = await call(u.path, u.init);
    expect(res.status).toBe(401);
    expect(put).not.toHaveBeenCalled();
  });

  test('画像を保存し、管理者専用のURLを返す', async () => {
    const { call, put } = makeApp();
    const u = upload(new Uint8Array([1, 2, 3]), 'image/jpeg');
    const res = await call(u.path, u.init);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { url: string; name: string } };
    expect(json.data.url).toMatch(new RegExp(`^https://api\\.example\\.test/api/form-uploads/${FORM_ID}/[0-9a-f-]{36}\\.jpg$`));
    expect(json.data.name).toBe('自撮り.jpg');
    const [key, , opts] = put.mock.calls[0] as unknown as [string, ArrayBuffer, { customMetadata: Record<string, string> }];
    expect(key.startsWith(`form-uploads/${FORM_ID}/`)).toBe(true);
    expect(opts.customMetadata.friendId).toBe('friend-1');
  });

  test('ファイル項目でない名前は400', async () => {
    const { call } = makeApp();
    const u = upload(new Uint8Array([1]), 'image/png', 'other');
    expect((await call(u.path, u.init)).status).toBe(400);
  });

  test('画像指定の項目にPDFは受け付けない / PDF指定なら受け付ける', async () => {
    const a = makeApp();
    const bad = upload(new Uint8Array([1]), 'application/pdf');
    expect((await a.call(bad.path, bad.init)).status).toBe(400);

    mocks.getFormById.mockResolvedValue(activeForm({ fileKind: 'pdf' }));
    const b = makeApp();
    const ok = upload(new Uint8Array([1]), 'application/pdf');
    expect((await b.call(ok.path, ok.init)).status).toBe(201);
  });

  test('10MBを超えると413', async () => {
    const { call, put } = makeApp();
    const u = upload(new Uint8Array(10 * 1024 * 1024 + 1), 'image/png');
    expect((await call(u.path, u.init)).status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  test('公開停止中のフォームには保存しない', async () => {
    mocks.getFormById.mockResolvedValue({ ...activeForm(), is_active: 0 });
    const { call, put } = makeApp();
    const u = upload(new Uint8Array([1]), 'image/png');
    expect((await call(u.path, u.init)).status).toBe(404);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('GET /api/form-uploads/:formId/:file', () => {
  test('不正なパスは404(パストラバーサル防止)', async () => {
    const { call, get } = makeApp();
    expect((await call(`/api/form-uploads/${FORM_ID}/..%2Fsecret.png`)).status).toBe(404);
    expect((await call('/api/form-uploads/not-a-uuid/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png')).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  test('保存済みのファイルを返す(キャッシュは private)', async () => {
    const { call, get } = makeApp();
    get.mockResolvedValue({ body: 'x', httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { originalFilename: 'a.jpg' } });
    const res = await call(`/api/form-uploads/${FORM_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('private');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(get).toHaveBeenCalledWith(`form-uploads/${FORM_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`);
  });
});
