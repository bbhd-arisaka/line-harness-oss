import { Hono } from 'hono';
import { getFormById, getFriendByLineUserId } from '@line-crm/db';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
import type { Env } from '../index.js';

/**
 * 回答フォームの「ファイル」ブロックのアップロード。
 * - 回答者(LIFF)は LINE の ID トークンで本人確認して、フォームごとの領域に保存する
 * - 保存したファイルは個人情報なので、閲覧できるのは管理者だけ(公開URLにはしない)
 */
const formUploads = new Hono<Env>();

const MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
const PDF_TYPES: Record<string, string> = { 'application/pdf': 'pdf' };

// POST /api/forms/:id/upload?field=<項目名> — 公開(LIFF の ID トークンで認証)
formUploads.post('/api/forms/:id/upload', async (c) => {
  try {
    const formId = c.req.param('id');
    const fieldName = c.req.query('field') ?? '';

    const lineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
    if (!lineUserId) return c.json({ success: false, error: 'Unauthorized' }, 401);
    const friend = await getFriendByLineUserId(c.env.DB, lineUserId);
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    const form = await getFormById(c.env.DB, formId);
    if (!form || !form.is_active) return c.json({ success: false, error: 'Form not found' }, 404);

    const fields = JSON.parse(form.fields || '[]') as Array<{ name: string; type: string; fileKind?: 'image' | 'pdf' }>;
    const field = fields.find((f) => f.name === fieldName && f.type === 'file');
    if (!field) return c.json({ success: false, error: 'ファイル項目が見つかりません' }, 400);

    const mimeType = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const allowed = field.fileKind === 'pdf' ? PDF_TYPES : IMAGE_TYPES;
    const ext = allowed[mimeType];
    if (!ext) {
      return c.json(
        { success: false, error: field.fileKind === 'pdf' ? 'PDFファイルのみ添付できます' : '画像(jpg/png/gif/heic)のみ添付できます' },
        400,
      );
    }

    const declared = Number(c.req.header('Content-Length') ?? '0');
    if (declared > MAX_BYTES) return c.json({ success: false, error: 'ファイルサイズは10MB以内にしてください' }, 413);
    const data = await c.req.arrayBuffer();
    if (data.byteLength === 0) return c.json({ success: false, error: 'ファイルが空です' }, 400);
    if (data.byteLength > MAX_BYTES) return c.json({ success: false, error: 'ファイルサイズは10MB以内にしてください' }, 413);

    let originalName = '';
    try { originalName = decodeURIComponent(c.req.header('X-Filename') ?? ''); } catch { /* 名前が読めなくても保存は続ける */ }

    const file = `${crypto.randomUUID()}.${ext}`;
    const key = `form-uploads/${formId}/${file}`;
    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: originalName.slice(0, 200), friendId: friend.id, fieldName },
    });

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json(
      { success: true, data: { url: `${workerUrl}/api/form-uploads/${formId}/${file}`, name: originalName, size: data.byteLength, mimeType } },
      201,
    );
  } catch (err) {
    console.error('POST /api/forms/:id/upload error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/form-uploads/:formId/:file — 管理者のみ(管理画面の回答一覧・友だち情報から表示する)
formUploads.get('/api/form-uploads/:formId/:file', async (c) => {
  const formId = c.req.param('formId');
  const file = c.req.param('file');
  if (!/^[0-9a-f-]{36}$/i.test(formId) || !/^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(file)) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const object = await c.env.IMAGES.get(`form-uploads/${formId}/${file}`);
  if (!object) return c.json({ success: false, error: 'Not found' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  const original = object.customMetadata?.originalFilename;
  headers.set('Content-Disposition', original ? `inline; filename*=UTF-8''${encodeURIComponent(original)}` : 'inline');
  return new Response(object.body, { headers });
});

export { formUploads };
