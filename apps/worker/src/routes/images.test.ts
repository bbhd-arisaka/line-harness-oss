import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { images } from './images.js';

type TestEnv = {
  Bindings: { DB: D1Database; IMAGES: R2Bucket };
};

function makeR2Stub() {
  const store = new Map<string, { body: string; contentType?: string }>();
  const r2 = {
    async put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { body: String(value), contentType: options?.httpMetadata?.contentType });
      return {} as never;
    },
    async get(key: string) {
      const item = store.get(key);
      if (!item) return null;
      return {
        body: item.body,
        httpMetadata: { contentType: item.contentType },
        etag: 'test-etag',
      } as never;
    },
    async delete() {},
  } as unknown as R2Bucket;
  return { r2, store };
}

function setupApp() {
  const { r2, store } = makeR2Stub();
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.env = { DB: {} as D1Database, IMAGES: r2 };
    await next();
  });
  app.route('/', images);
  return { app, store };
}

describe('GET /images/:key', () => {
  it('serves a flat key that exists', async () => {
    const { app, store } = setupApp();
    store.set('abc.png', { body: 'png-bytes', contentType: 'image/png' });
    const res = await app.request('/images/abc.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('404s for a missing key', async () => {
    const { app } = setupApp();
    const res = await app.request('/images/missing.png');
    expect(res.status).toBe(404);
  });

  it('never serves slash-containing keys (archive/ objects are not public)', async () => {
    const { app, store } = setupApp();
    store.set('archive/messages_log/2026-01-01/m1.ndjson', {
      body: 'secret',
      contentType: 'application/x-ndjson',
    });
    const res = await app.request('/images/archive%2Fmessages_log%2F2026-01-01%2Fm1.ndjson');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('secret');
  });
});

describe('POST /api/images(アプリは、画像のバイナリをそのまま送る)', () => {
  it('Content-Type が image/jpeg のバイナリを、そのまま保存して、URL を返す', async () => {
    const { app, store } = setupApp();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const res = await app.request('https://worker.example/api/images', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: bytes });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { url: string; key: string; mimeType: string; size: number } };
    expect(json.data.mimeType).toBe('image/jpeg');
    expect(json.data.size).toBe(7);
    expect(json.data.key.endsWith('.jpg')).toBe(true);
    expect(json.data.url).toBe(`https://worker.example/images/${json.data.key}`);
    expect(store.get(json.data.key)?.contentType).toBe('image/jpeg');
  });
  it('画像でない種類は受け付けない', async () => {
    const { app } = setupApp();
    const res = await app.request('https://worker.example/api/images', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
    expect(res.status).toBe(400);
  });
});
