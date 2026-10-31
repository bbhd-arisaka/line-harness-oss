import { Hono } from 'hono';
import type { Env } from '../index.js';
import { INCOMING_KEY_PREFIX, verifyIncomingKey } from '../lib/incoming-media-url.js';

const images = new Hono<Env>();

// POST /api/images — upload image (base64 or binary)
images.post('/api/images', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';

    let data: ArrayBuffer;
    let mimeType: string;
    let filename: string | undefined;

    if (contentType.includes('application/json')) {
      const body = await c.req.json<{
        data: string;
        mimeType?: string;
        filename?: string;
      }>();

      if (!body.data) {
        return c.json({ success: false, error: 'data (base64) is required' }, 400);
      }

      let base64 = body.data;
      if (base64.startsWith('data:')) {
        const match = base64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64 = match[2];
        }
      }
      mimeType ??= body.mimeType ?? 'image/png';
      filename = body.filename;

      const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      data = binary.buffer;
    } else {
      data = await c.req.arrayBuffer();
      mimeType = contentType.split(';')[0] || 'image/png';
    }

    if (data.byteLength > 10 * 1024 * 1024) {
      return c.json({ success: false, error: 'Image too large (max 10MB)' }, 400);
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return c.json({ success: false, error: `Unsupported image type: ${mimeType}. Allowed: ${allowedTypes.join(', ')}` }, 400);
    }

    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const id = crypto.randomUUID();
    const key = `${id}.${ext}`;

    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename ?? key },
    });

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    const url = `${workerUrl}/images/${key}`;

    return c.json({
      success: true,
      data: { id, key, url, mimeType, size: data.byteLength },
    }, 201);
  } catch (err) {
    console.error('POST /api/images error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/images/import — 他のサービスの画像を、こちらに取り込んで保存する(Lステップからの引き継ぎ用)。
// 取り込める場所は、Lステップの画像置き場(CloudFront の1か所)だけ。https のみ・10MBまで・画像だけ。
const IMPORT_ALLOWED_HOSTS = new Set(['d27rnpuamwvieu.cloudfront.net']);
images.post('/api/images/import', async (c) => {
  try {
    const body = await c.req.json<{ url?: unknown }>().catch(() => ({}) as { url?: unknown });
    let source: URL;
    try {
      source = new URL(typeof body.url === 'string' ? body.url : '');
    } catch {
      return c.json({ success: false, error: 'url が正しくありません' }, 400);
    }
    if (source.protocol !== 'https:' || !IMPORT_ALLOWED_HOSTS.has(source.hostname)) {
      return c.json({ success: false, error: '取り込めない場所の画像です' }, 400);
    }
    const res = await fetch(source.toString(), { redirect: 'manual' });
    if (!res.ok) return c.json({ success: false, error: `画像を取得できませんでした(${res.status})` }, 502); // 転送(3xx)は、ほかの場所へ飛ばされるので取り込まない
    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0];
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)) {
      return c.json({ success: false, error: `対応していない画像の形式です: ${mimeType}` }, 400);
    }
    const data = await res.arrayBuffer();
    if (data.byteLength > 10 * 1024 * 1024) return c.json({ success: false, error: '画像が大きすぎます(10MBまで)' }, 400);
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
    const id = crypto.randomUUID();
    const key = `${id}.${ext}`;
    await c.env.IMAGES.put(key, data, { httpMetadata: { contentType: mimeType }, customMetadata: { originalFilename: source.pathname.split('/').filter(Boolean).slice(-2).join('-') } });
    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json({ success: true, data: { id, key, url: `${workerUrl}/images/${key}`, mimeType, size: data.byteLength } }, 201);
  } catch (err) {
    console.error('POST /api/images/import error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/media-files?kind=audio|video — 音声(m4a)・動画(mp4)のアップロード(テンプレートの音声・動画メッセージ用)。
// 本文は生のファイル(Content-Type は audio/* / video/mp4)。Workers の受け取り上限(約100MB)に合わせ、95MB まで。
// 保存先・公開URLは画像と同じ(/images/{uuid}.{ext})。
const MEDIA_FILE_MAX = 95 * 1024 * 1024;
images.post('/api/media-files', async (c) => {
  try {
    const kind = c.req.query('kind');
    if (kind !== 'audio' && kind !== 'video') return c.json({ success: false, error: 'kind は audio か video です' }, 400);
    const mimeType = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const audioTypes: Record<string, string> = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a' };
    const videoTypes: Record<string, string> = { 'video/mp4': 'mp4' };
    const ext = (kind === 'audio' ? audioTypes : videoTypes)[mimeType];
    if (!ext) {
      return c.json({ success: false, error: kind === 'audio' ? '音声は m4a 形式のみです' : '動画は mp4 形式のみです' }, 400);
    }
    const data = await c.req.arrayBuffer();
    if (data.byteLength === 0) return c.json({ success: false, error: 'ファイルが空です' }, 400);
    if (data.byteLength > MEDIA_FILE_MAX) return c.json({ success: false, error: 'ファイルが大きすぎます(95MBまで)' }, 400);
    const filename = c.req.header('X-Filename') ? decodeURIComponent(c.req.header('X-Filename') as string) : undefined;
    const key = `${crypto.randomUUID()}.${ext}`;
    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: kind === 'audio' ? 'audio/mp4' : 'video/mp4' },
      customMetadata: { originalFilename: filename ?? key },
    });
    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json({ success: true, data: { key, url: `${workerUrl}/images/${key}`, mimeType, size: data.byteLength } }, 201);
  } catch (err) {
    console.error('POST /api/media-files error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/media — 登録メディア一覧(Lステップの「登録メディア一覧」相当)。
// フォームの画像ブロックや配信で使った画像を、アップロード済みの中から選べるようにする。
// R2 直下の「{uuid}.{ext}」だけを対象にする(form-uploads/ など個人情報のフォルダは含めない)。
images.get('/api/media', async (c) => {
  try {
    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    const items: Array<{ key: string; url: string; name: string; mimeType: string; size: number; uploadedAt: string }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await c.env.IMAGES.list({ delimiter: '/', limit: 1000, cursor, include: ['httpMetadata', 'customMetadata'] } as R2ListOptions);
      for (const o of res.objects) {
        if (o.key.includes('/')) continue;
        items.push({
          key: o.key,
          url: `${workerUrl}/images/${o.key}`,
          name: o.customMetadata?.originalFilename || o.key,
          mimeType: o.httpMetadata?.contentType || '',
          size: o.size,
          uploadedAt: o.uploaded.toISOString(),
        });
      }
      if (!res.truncated) break;
      cursor = res.cursor;
    }
    items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/media error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /images/:key — serve image (public, no auth)
images.get('/images/:key', async (c) => {
  const key = c.req.param('key');
  // Public route: only flat "{uuid}.{ext}" keys are servable. Anything with a
  // path separator (e.g. archive/ objects) must 404.
  if (key.includes('/') || key.includes('\\')) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }
  // お客様から届いたもの(incoming-)は公開しない。トークの取得APIが発行した、期限つきの署名つきURLでだけ開ける。
  const incoming = key.startsWith(INCOMING_KEY_PREFIX);
  if (incoming) {
    const ok = await verifyIncomingKey(c.env.API_KEY, key, c.req.query('exp'), c.req.query('sig'), Math.floor(Date.now() / 1000));
    if (!ok) return c.json({ success: false, error: 'Image not found' }, 404);
  }

  // 動画は、Safari などが一部ずつ(Range)取りに来る
  const rangeHeader = c.req.header('Range');
  const object = await c.env.IMAGES.get(key, rangeHeader ? { range: c.req.raw.headers } : undefined);

  if (!object) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }

  const contentType = object.httpMetadata?.contentType || 'image/png';
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('ETag', object.etag);
  headers.set('Accept-Ranges', 'bytes');
  if (incoming) {
    // 中身を解釈させない。画像・動画・音声以外(PDFなど)は、開くのではなくダウンロード扱いにする
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    const original = object.customMetadata?.originalFilename;
    const inline = /^(image|video|audio)\//.test(contentType);
    headers.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}${original ? `; filename*=UTF-8''${encodeURIComponent(original)}` : ''}`);
  } else {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  const range = (object as R2ObjectBody & { range?: R2Range }).range;
  if (rangeHeader && range) {
    let offset = 0;
    let length = object.size;
    if ('suffix' in range && range.suffix !== undefined) {
      length = Math.min(range.suffix, object.size);
      offset = object.size - length;
    } else {
      offset = (range as { offset?: number }).offset ?? 0;
      length = (range as { length?: number }).length ?? object.size - offset;
    }
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }

  return new Response(object.body, { headers });
});

// GET /imagemap/:key/:width — 画像リンク付きの画像(LINE の imagemap メッセージ)。
// LINE は baseUrl の後ろに /1040 /700 /460 /300 /240 を付けて取りにくる。大きさを変えずに、同じ画像を返す
// (比率が同じなら表示できる。LINE は 10MB までの JPEG/PNG を受け付ける)。公開(認証なし)。
images.get('/imagemap/:key/:width', async (c) => {
  const key = c.req.param('key');
  if (key.includes('/') || key.includes('\\') || !/^\d+$/.test(c.req.param('width'))) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }
  const object = await c.env.IMAGES.get(key);
  if (!object) return c.json({ success: false, error: 'Image not found' }, 404);
  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.etag);
  return new Response(object.body, { headers });
});

// DELETE /api/images/:key — delete image
images.delete('/api/images/:key', async (c) => {
  try {
    const key = c.req.param('key');
    await c.env.IMAGES.delete(key);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/images/:key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { images };
