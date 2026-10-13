import { describe, expect, it, vi } from 'vitest';
import { forwardWebhookToLstep, statusForLine, validateLstepForwardUrl } from './lstep-forward.js';

describe('validateLstepForwardUrl(転送先として許すURL)', () => {
  it('Lステップの受信URL(https の linestep.net 配下)だけ許す', () => {
    expect(validateLstepForwardUrl('https://rcv.linestep.net/v3/call/2008163446')).toEqual({ ok: true, url: 'https://rcv.linestep.net/v3/call/2008163446' });
    expect(validateLstepForwardUrl('  https://linestep.net/x ')).toMatchObject({ ok: true });
  });
  it('他のサイト・http・ユーザー情報つき・空・壊れたURLは断る(任意のURLへ転送させない)', () => {
    for (const bad of ['http://rcv.linestep.net/x', 'https://evil.example/x', 'https://linestep.net.evil.example/x', 'https://notlinestep.net/x', 'https://user:pw@rcv.linestep.net/x', '', '   ', 'not a url', null, 123]) {
      expect(validateLstepForwardUrl(bad as unknown).ok).toBe(false);
    }
  });
});

describe('forwardWebhookToLstep', () => {
  it('本文と署名をそのまま POST し、ステータスを返す', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const r = await forwardWebhookToLstep('https://rcv.linestep.net/v3/call/1', '{"a":"あ"}', 'SIG', 'application/json; charset=utf-8', fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, status: 200 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{"a":"あ"}');
    expect(init.headers).toMatchObject({ 'x-line-signature': 'SIG', 'Content-Type': 'application/json; charset=utf-8' });
  });
  it('通信できなかったら ok:false。LINE には 502 を返す', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const r = await forwardWebhookToLstep('https://rcv.linestep.net/v3/call/1', '{}', 'S', null, fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: 'down' });
    expect(statusForLine(r)).toBe(502);
    expect(statusForLine({ ok: true, status: 204 })).toBe(204);
  });
  it('応答が遅すぎるときは、時間で打ち切る', async () => {
    const fetchImpl = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))));
    const r = await forwardWebhookToLstep('https://rcv.linestep.net/v3/call/1', '{}', 'S', null, fetchImpl as unknown as typeof fetch, 20);
    expect(r).toMatchObject({ ok: false });
  });
});
