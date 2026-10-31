import { describe, expect, it } from 'vitest';
import { images } from './images.js';
import { signIncomingKey } from '../lib/incoming-media-url.js';

const SECRET = 'test-secret';

function env(objects: Record<string, { type: string; body: string; name?: string }>) {
  return {
    API_KEY: SECRET,
    IMAGES: {
      get: async (key: string) => {
        const o = objects[key];
        if (!o) return null;
        return { body: new Response(o.body).body, size: o.body.length, etag: 'e', httpMetadata: { contentType: o.type }, customMetadata: o.name ? { originalFilename: o.name } : {} };
      },
    },
  } as never;
}

const files = {
  'incoming-a-1.pdf': { type: 'application/pdf', body: '%PDF-1', name: '見積.pdf' },
  'incoming-a-2.jpg': { type: 'image/jpeg', body: 'jpegdata' },
  'plain.png': { type: 'image/png', body: 'png' },
};

async function signedPath(key: string, exp = Math.floor(Date.now() / 1000) + 600) {
  return `/images/${key}?exp=${exp}&sig=${await signIncomingKey(SECRET, key, exp)}`;
}

describe('GET /images/:key(お客様から届いたもの)', () => {
  it('署名が無い・期限切れ・別ファイルの署名は 404', async () => {
    const e = env(files);
    expect((await images.request('/images/incoming-a-1.pdf', {}, e)).status).toBe(404);
    expect((await images.request(await signedPath('incoming-a-1.pdf', 1), {}, e)).status).toBe(404);
    const other = await signedPath('incoming-a-2.jpg');
    expect((await images.request(other.replace('incoming-a-2.jpg', 'incoming-a-1.pdf'), {}, e)).status).toBe(404);
  });

  it('署名が合えば開ける。PDFはダウンロード扱い・画像はそのまま表示。どちらも中身を解釈させない', async () => {
    const e = env(files);
    const pdf = await images.request(await signedPath('incoming-a-1.pdf'), {}, e);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(pdf.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(pdf.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(pdf.headers.get('Cache-Control')).toMatch(/^private/);
    const img = await images.request(await signedPath('incoming-a-2.jpg'), {}, e);
    expect(img.headers.get('Content-Disposition')).toMatch(/^inline/);
  });

  it('こちらから送った画像(incoming- でないもの)は、これまで通り公開', async () => {
    const res = await images.request('/images/plain.png', {}, env(files));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('public');
  });
});
