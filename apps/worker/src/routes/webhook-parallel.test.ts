import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

// Lステップと並行運用(受信をLステップにも転送する)のテスト。DB と LINE は最小限のモックにする。
const accountRow = vi.hoisted(() => ({
  value: {
    id: 'acc1',
    is_active: 1,
    channel_secret: 'secret-1',
    channel_access_token: 'token-1',
    lstep_forward_url: 'https://rcv.linestep.net/v3/call/123' as string | null,
  },
}));

vi.mock('@line-crm/db', () => ({
  getLineAccounts: vi.fn(async () => [accountRow.value]),
  jstNow: vi.fn(() => '2026-10-13T10:00:00.000+09:00'),
}));

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    verifySignature: vi.fn(async (secret: string) => secret === 'secret-1'),
  };
});

vi.mock('../services/push-notify.js', () => ({ notifyIncomingMessage: vi.fn() }));
vi.mock('../durable-objects/tenant-scheduler.js', () => ({ ensureSchedulerArmed: vi.fn(async () => {}) }));

import { webhook, suppressSending } from './webhook.js';
import { LineClient } from '@line-crm/line-sdk';

const SIG = 'A'.repeat(43) + '=';
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext;
const env = { DB: {} as D1Database } as Record<string, unknown>;

function post(body: string) {
  const app = new Hono();
  app.route('/', webhook);
  return app.request('/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Line-Signature': SIG }, body }, env, ctx);
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  accountRow.value.lstep_forward_url = 'https://rcv.linestep.net/v3/call/123';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('POST /webhook — Lステップへの転送(並行運用)', () => {
  test('受け取った本文と署名を、そのまま転送し、Lステップの応答ステータスを LINE に返す', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const body = JSON.stringify({ destination: 'U1', events: [] });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://rcv.linestep.net/v3/call/123');
    expect(calls[0].init.body).toBe(body);
    expect((calls[0].init.headers as Record<string, string>)['x-line-signature']).toBe(SIG);
  });

  test('Lステップがエラーを返したら、そのステータスを LINE に返す(再送してもらう)', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch;
    const res = await post(JSON.stringify({ events: [] }));
    expect(res.status).toBe(503);
  });

  test('Lステップに届かなかったら 502(再送してもらう)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(JSON.stringify({ events: [] }));
    expect(res.status).toBe(502);
    err.mockRestore();
  });

  test('本文が壊れていても、Lステップには転送する(署名が正しいとき)', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post('{not json');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  test('転送先が未設定のアカウントは、転送しない(今までどおり)', async () => {
    accountRow.value.lstep_forward_url = null;
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await post(JSON.stringify({ events: [] }));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('suppressSending(並行運用中は LINE への送信をしない)', () => {
  test('送信・リッチメニュー変更の関数が、何もせずに成功する', async () => {
    const client = new LineClient('t');
    const req = vi.spyOn(client, 'request').mockResolvedValue({ data: {}, headers: new Headers() });
    const quiet = suppressSending(client);
    await quiet.pushMessage('U1', [{ type: 'text', text: 'x' }]);
    await quiet.replyMessage('r', [{ type: 'text', text: 'x' }]);
    await quiet.multicast(['U1'], [{ type: 'text', text: 'x' }]);
    await quiet.linkRichMenuToUser('U1', 'rm');
    expect(req).not.toHaveBeenCalled();
  });
});
