import { describe, expect, test, vi } from 'vitest';
import { ensureLiffApp, LiffSetupError } from './liff-setup';

const BASE = { loginChannelId: '2001', loginChannelSecret: 'sec', workerUrl: 'https://api.example.test/' };

type Call = { url: string; method: string; body?: unknown; auth?: string };

/** LINE API の疑似サーバー。呼ばれた内容を記録する。 */
function fakeLine(opts: { tokenOk?: boolean; apps?: Array<{ liffId: string; view?: { url?: string } }>; createOk?: boolean } = {}) {
  const calls: Call[] = [];
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* 文字列のまま */ }
    } else if (body instanceof URLSearchParams) {
      body = Object.fromEntries(body.entries());
    }
    calls.push({ url, method, body, auth: headers.Authorization });
    if (url.endsWith('/v2/oauth/accessToken')) {
      return opts.tokenOk === false
        ? new Response('{}', { status: 400 })
        : new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    }
    if (url.endsWith('/liff/v1/apps') && method === 'GET') return new Response(JSON.stringify({ apps: opts.apps ?? [] }), { status: 200 });
    if (url.endsWith('/liff/v1/apps') && method === 'POST') {
      return opts.createOk === false ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ liffId: '2001-NEW' }), { status: 200 });
    }
    if (/\/liff\/v1\/apps\/[^/]+$/.test(url) && method === 'PUT') return new Response('{}', { status: 200 });
    return new Response('{}', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('ensureLiffApp', () => {
  test('LIFFが無ければ新規作成し、エンドポイントに自分のIDを付ける', async () => {
    const { f, calls } = fakeLine();
    const r = await ensureLiffApp(BASE, f);
    expect(r).toEqual({ liffId: '2001-NEW', created: true });
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/liff/v1/apps'))!;
    expect((post.body as { view: { url: string } }).view.url).toBe('https://api.example.test/');
    expect(post.auth).toBe('Bearer tok');
    // LINEの制限: LIFFの名前は20文字以内(超えると作成が拒否される)
    expect([...((post.body as { description: string }).description)].length).toBeLessThanOrEqual(20);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/liff/v1/apps/2001-NEW');
    expect((put.body as { view: { url: string } }).view.url).toBe('https://api.example.test/?liffId=2001-NEW');
  });

  test('エンドポイントが自分のURLの既存LIFFは再利用し、新規作成しない', async () => {
    const { f, calls } = fakeLine({ apps: [{ liffId: '2001-OLD', view: { url: 'https://api.example.test/' } }] });
    const r = await ensureLiffApp(BASE, f);
    expect(r).toEqual({ liffId: '2001-OLD', created: false });
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/liff/v1/apps'))).toBe(false);
    expect((calls.find((c) => c.method === 'PUT')!.body as { view: { url: string } }).view.url).toBe('https://api.example.test/?liffId=2001-OLD');
  });

  test('他のアカウントが使っているLIFFは横取りせず、新しく作る', async () => {
    const { f } = fakeLine({ apps: [{ liffId: '2001-OLD', view: { url: 'https://api.example.test/?liffId=2001-OLD' } }] });
    const r = await ensureLiffApp({ ...BASE, takenLiffIds: ['2001-OLD'] }, f);
    expect(r).toEqual({ liffId: '2001-NEW', created: true });
  });

  test('割り当て済みLIFFのエンドポイントが正しければ、何も書き換えない(何度実行しても安全)', async () => {
    const { f, calls } = fakeLine({ apps: [{ liffId: '2001-OLD', view: { url: 'https://api.example.test/?liffId=2001-OLD' } }] });
    const r = await ensureLiffApp({ ...BASE, existingLiffId: '2001-OLD' }, f);
    expect(r).toEqual({ liffId: '2001-OLD', created: false });
    expect(calls.some((c) => c.method === 'PUT' || c.method === 'POST' && c.url.endsWith('/apps'))).toBe(false);
  });

  test('IDかシークレットが違うと、分かりやすい日本語のエラー', async () => {
    const { f } = fakeLine({ tokenOk: false });
    const err = await ensureLiffApp(BASE, f).catch((e) => e);
    expect(err).toBeInstanceOf(LiffSetupError);
    expect((err as Error).message).toContain('チャネルシークレット');
  });

  test('LINE側で作成に失敗したら、エラーにする', async () => {
    const { f } = fakeLine({ createOk: false });
    await expect(ensureLiffApp(BASE, f)).rejects.toBeInstanceOf(LiffSetupError);
  });
});
