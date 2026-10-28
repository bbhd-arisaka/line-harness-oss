import { describe, expect, it, vi } from 'vitest';
import { buildFcmMessage, getFcmConfig, sendFcmAlert } from './fcm.js';

const config = { projectId: 'proj', email: 'e@x', privateKey: 'k' };
const alert = { title: '山田', subtitle: '店', body: 'こんにちは', collapseId: 'chat1', data: { chatId: 'chat1', accountId: null, friendId: 'fr1' } };

describe('fcm', () => {
  it('3つそろわなければ無効', () => {
    expect(getFcmConfig({})).toBeNull();
    expect(getFcmConfig({ FCM_PROJECT_ID: 'p', FCM_SERVICE_ACCOUNT_EMAIL: 'e' })).toBeNull();
    expect(getFcmConfig({ FCM_PROJECT_ID: 'p', FCM_SERVICE_ACCOUNT_EMAIL: 'e', FCM_SERVICE_ACCOUNT_PRIVATE_KEY: 'k' })).not.toBeNull();
  });

  it('data は文字列だけ(null は入れない)・開き先が入る', () => {
    const m = buildFcmMessage('tok', alert).message as { data: Record<string, string>; token: string };
    expect(m.token).toBe('tok');
    expect(m.data).toEqual({ chatId: 'chat1', friendId: 'fr1' });
  });

  it('成功・無効トークン(404)・その他失敗を見分ける', async () => {
    const getAccessToken = async () => 'at';
    const ok = vi.fn(async () => new Response('{}', { status: 200 }));
    expect((await sendFcmAlert(config, 't', alert, { fetchImpl: ok as never, getAccessToken })).ok).toBe(true);
    const init = (ok.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer at');

    const gone = vi.fn(async () => new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 }));
    const r = await sendFcmAlert(config, 't', alert, { fetchImpl: gone as never, getAccessToken });
    expect(r).toMatchObject({ ok: false, invalidToken: true, reason: 'UNREGISTERED' });

    const bad = vi.fn(async () => new Response('{}', { status: 500 }));
    expect((await sendFcmAlert(config, 't', alert, { fetchImpl: bad as never, getAccessToken })).invalidToken).toBe(false);
  });

  it('アクセストークンが作れなくても例外を投げない', async () => {
    const r = await sendFcmAlert(config, 't', alert, { getAccessToken: async () => { throw new Error('x'); } });
    expect(r).toMatchObject({ ok: false, reason: 'auth_error' });
  });
});
