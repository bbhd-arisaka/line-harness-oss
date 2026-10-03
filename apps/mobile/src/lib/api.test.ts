import { describe, expect, it, vi } from 'vitest';
import { ApiError, buildQuery, createApiClient } from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(response: Response | (() => Promise<Response>), token: string | null = 'bl_app_token') {
  // 同じ応答を何度も返せるように、毎回 clone する(Response の本文は1回しか読めない)
  const fetchImpl = vi.fn(async () => (typeof response === 'function' ? response() : response.clone()));
  const onUnauthorized = vi.fn();
  const api = createApiClient({
    baseUrl: 'https://example.test/',
    getToken: () => token,
    onUnauthorized,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { api, fetchImpl, onUnauthorized };
}

function lastCall(fetchImpl: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1] as unknown as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe('buildQuery', () => {
  it('空の値を除き、日本語をエンコードする', () => {
    expect(buildQuery({ a: 'x', b: undefined, c: '', d: 0, e: '山田 太郎' })).toBe('?a=x&d=0&e=%E5%B1%B1%E7%94%B0%20%E5%A4%AA%E9%83%8E');
    expect(buildQuery({})).toBe('');
    expect(buildQuery(undefined)).toBe('');
  });
});

describe('login', () => {
  it('メール・パスワード・端末名を送り、Authorization は付けない', async () => {
    const data = { token: 't', expiresAt: '2026-12-31T00:00:00Z', staff: { id: 's', name: 'N', email: 'a@b.c', role: 'staff' } };
    const { api, fetchImpl } = setup(jsonResponse({ success: true, data }));
    const result = await api.login('a@b.c', 'pw', 'iPhone');
    expect(result).toEqual(data);
    const { url, init, headers } = lastCall(fetchImpl);
    expect(url).toBe('https://example.test/api/app/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.c', password: 'pw', deviceName: 'iPhone' });
    expect(headers.Authorization).toBeUndefined();
  });

  it('401 でも onUnauthorized を呼ばず、API の error をそのまま投げる', async () => {
    const { api, onUnauthorized } = setup(jsonResponse({ success: false, error: 'メールアドレスまたはパスワードが違います' }, 401));
    await expect(api.login('a@b.c', 'bad', 'iPhone')).rejects.toMatchObject({
      message: 'メールアドレスまたはパスワードが違います',
      status: 401,
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('429 は待つ旨のメッセージをそのまま返す', async () => {
    const msg = 'ログインに何度も失敗したため、15分ほど待ってからお試しください';
    const { api } = setup(jsonResponse({ success: false, error: msg }, 429));
    await expect(api.login('a@b.c', 'x', 'iPhone')).rejects.toMatchObject({ message: msg, status: 429 });
  });
});

describe('認証つきの呼び出し', () => {
  it('Bearer トークンを付ける', async () => {
    const { api, fetchImpl } = setup(jsonResponse({ success: true, data: [] }));
    await api.listLineAccounts();
    expect(lastCall(fetchImpl).headers.Authorization).toBe('Bearer bl_app_token');
    expect(lastCall(fetchImpl).url).toBe('https://example.test/api/line-accounts');
  });

  it('401 のとき onUnauthorized を呼ぶ', async () => {
    const { api, onUnauthorized } = setup(jsonResponse({ success: false, error: 'Unauthorized' }, 401));
    await expect(api.listLineAccounts()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('403 は API の文言をそのまま投げ、ログアウトさせない', async () => {
    const msg = 'このアカウントを操作する権限がありません。管理者に依頼してください。';
    const { api, onUnauthorized } = setup(jsonResponse({ success: false, error: msg }, 403));
    await expect(api.listChats({ lineAccountId: 'a1' })).rejects.toMatchObject({ message: msg, status: 403 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('通信失敗は status 0 の ApiError', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('Network request failed')));
    await expect(api.listLineAccounts()).rejects.toMatchObject({ status: 0 });
  });

  it('JSON でない応答でも落ちず、状態コード入りのメッセージにする', async () => {
    const { api } = setup(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(api.listLineAccounts()).rejects.toMatchObject({ status: 502 });
  });
});

describe('トーク', () => {
  it('一覧: アカウント・状態・カーソルをクエリにする', async () => {
    const { api, fetchImpl } = setup(jsonResponse({ success: true, data: [] }));
    await api.listChats({ lineAccountId: 'acc 1', status: 'unread', limit: 50, before: { at: '2026-10-03T10:00:00.000+09:00', id: 'f9' } });
    expect(lastCall(fetchImpl).url).toBe(
      'https://example.test/api/chats?lineAccountId=acc%201&status=unread&limit=50&beforeAt=2026-10-03T10%3A00%3A00.000%2B09%3A00&beforeId=f9',
    );
  });

  it('送信: text として POST する', async () => {
    const { api, fetchImpl } = setup(jsonResponse({ success: true, data: { sent: true, messageId: 'm1' } }));
    const res = await api.sendChatText('friend-1', 'こんにちは');
    expect(res.messageId).toBe('m1');
    const { url, init } = lastCall(fetchImpl);
    expect(url).toBe('https://example.test/api/chats/friend-1/send');
    expect(JSON.parse(init.body as string)).toEqual({ messageType: 'text', content: 'こんにちは' });
  });
});

describe('友だち', () => {
  it('一覧: 検索語の前後の空白を除き、既定は30件・先頭から', async () => {
    const { api, fetchImpl } = setup(jsonResponse({ success: true, data: { items: [], total: 0, page: 1, limit: 30, hasNextPage: false } }));
    await api.listFriends({ lineAccountId: 'a1', search: ' 山田 ' });
    expect(lastCall(fetchImpl).url).toBe('https://example.test/api/friends?lineAccountId=a1&search=%E5%B1%B1%E7%94%B0&limit=30&offset=0');
  });

  it('リッチメニューと友だち情報欄の定義を取得する', async () => {
    const { api, fetchImpl } = setup(jsonResponse({ success: true, data: { id: null } }));
    await api.getFriendRichMenu('f1');
    expect(lastCall(fetchImpl).url).toBe('https://example.test/api/friends/f1/rich-menu');
    await api.listFriendFieldDefinitions();
    expect(lastCall(fetchImpl).url).toBe('https://example.test/api/friend-fields/definitions');
  });

  it('リッチメニュー画像の URL', () => {
    const { api } = setup(jsonResponse({}));
    expect(api.richMenuImageUrl('richmenu-1', 'acc 1')).toBe(
      'https://example.test/api/rich-menu-groups/external/richmenu-1/image?accountId=acc%201',
    );
  });
});

describe('端末', () => {
  it('logout / APNs トークン登録', async () => {
    const { api, fetchImpl } = setup(jsonResponse({ success: true, data: null }));
    await api.logout();
    expect(lastCall(fetchImpl).url).toBe('https://example.test/api/app/logout');
    expect(lastCall(fetchImpl).init.method).toBe('POST');
    await api.setApnsToken('ab12'.repeat(10));
    expect(lastCall(fetchImpl).init.method).toBe('PUT');
    expect(JSON.parse(lastCall(fetchImpl).init.body as string)).toEqual({ apnsToken: 'ab12'.repeat(10) });
    await api.setApnsToken(null);
    expect(JSON.parse(lastCall(fetchImpl).init.body as string)).toEqual({ apnsToken: null });
  });
});
