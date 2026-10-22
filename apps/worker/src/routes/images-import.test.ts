import { afterEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { images } from './images.js';

const put = vi.fn();
function post(body: unknown) {
  const app = new Hono<Env>();
  app.route('/', images);
  return app.request('/api/images/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { IMAGES: { put }, WORKER_URL: 'https://api.example.test' } as unknown as Env['Bindings']);
}
afterEach(() => { vi.restoreAllMocks(); put.mockReset(); });

describe('POST /api/images/import(Lステップの画像の取り込み)', () => {
  test('Lステップの画像置き場の画像を取り込み、こちらの保存先のURLを返す', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    const res = await post({ url: 'https://d27rnpuamwvieu.cloudfront.net/abc/normal' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { url: string; mimeType: string; size: number } };
    expect(body.data.url).toMatch(/^https:\/\/api\.example\.test\/images\/.+\.png$/);
    expect(body.data).toMatchObject({ mimeType: 'image/png', size: 3 });
    expect(put).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://d27rnpuamwvieu.cloudfront.net/abc/normal', { redirect: 'manual' });
  });
  test('ほかの場所・http・壊れたURLは取り込まない(外部へ勝手に取りに行かない)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (const url of ['https://example.com/a.png', 'http://d27rnpuamwvieu.cloudfront.net/a', 'https://d27rnpuamwvieu.cloudfront.net.evil.test/a', 'not a url', 123]) {
      expect((await post({ url })).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('画像でないものは取り込まない', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<xml/>', { headers: { 'content-type': 'application/xml' } }));
    expect((await post({ url: 'https://d27rnpuamwvieu.cloudfront.net/abc/normal' })).status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });
});
