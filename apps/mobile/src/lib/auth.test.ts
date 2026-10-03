import { describe, expect, it, vi } from 'vitest';
import { createAuthStore, SESSION_KEY, type KeyValueStorage } from './auth';
import { resolveAccount, saveSelectedAccountId, loadSelectedAccountId, SELECTED_ACCOUNT_KEY } from './accounts';
import type { LineAccount, LoginResult } from './types';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: async (k) => data[k] ?? null,
    set: async (k, v) => {
      data[k] = v;
    },
    remove: async (k) => {
      delete data[k];
    },
  };
}

const staff = { id: 's1', name: '有坂', email: 'a@example.com', role: 'staff' };
const loginResult: LoginResult = { token: 'bl_app_x', expiresAt: '2026-12-31T00:00:00.000Z', staff };

function make(storage = memoryStorage(), overrides: Partial<Parameters<typeof createAuthStore>[0]> = {}) {
  const login = vi.fn(async () => loginResult);
  const logout = vi.fn(async () => null);
  const store = createAuthStore({
    storage,
    login,
    logout,
    deviceName: 'iPhone',
    now: () => new Date('2026-10-03T00:00:00Z'),
    ...overrides,
  });
  return { store, login, logout, storage };
}

describe('認証ストア', () => {
  it('保存が無ければ signedOut', async () => {
    const { store } = make();
    expect(store.getState().status).toBe('loading');
    await store.restore();
    expect(store.getState().status).toBe('signedOut');
  });

  it('ログインするとトークンを保存し、メールは trim して端末名を渡す', async () => {
    const { store, login, storage } = make();
    const listener = vi.fn();
    store.subscribe(listener);
    await store.login('  a@example.com ', 'pw');
    expect(login).toHaveBeenCalledWith('a@example.com', 'pw', 'iPhone');
    expect(store.getState()).toMatchObject({ status: 'signedIn', token: 'bl_app_x', staff });
    expect(store.getToken()).toBe('bl_app_x');
    expect(JSON.parse(storage.data[SESSION_KEY])).toMatchObject({ token: 'bl_app_x' });
    expect(listener).toHaveBeenCalled();
  });

  it('ログイン失敗は例外をそのまま投げ、状態は変えない', async () => {
    const { store } = make(memoryStorage(), {
      login: async () => {
        throw new Error('メールアドレスまたはパスワードが違います');
      },
    });
    await store.restore();
    await expect(store.login('a@b.c', 'x')).rejects.toThrow('メールアドレスまたはパスワードが違います');
    expect(store.getState().status).toBe('signedOut');
  });

  it('次回起動で保存済みのトークンを復元する', async () => {
    const storage = memoryStorage({ [SESSION_KEY]: JSON.stringify(loginResult) });
    const { store } = make(storage);
    await store.restore();
    expect(store.getState()).toMatchObject({ status: 'signedIn', token: 'bl_app_x' });
  });

  it('期限切れ・壊れた保存データは捨てる', async () => {
    const expired = memoryStorage({ [SESSION_KEY]: JSON.stringify({ ...loginResult, expiresAt: '2026-01-01T00:00:00Z' }) });
    const a = make(expired);
    await a.store.restore();
    expect(a.store.getState().status).toBe('signedOut');
    expect(expired.data[SESSION_KEY]).toBeUndefined();

    const broken = make(memoryStorage({ [SESSION_KEY]: '{not json' }));
    await broken.store.restore();
    expect(broken.store.getState().status).toBe('signedOut');
  });

  it('ログアウトはサーバーのトークンも取り消す。通信失敗でも端末は必ずログアウト', async () => {
    const { store, logout, storage } = make();
    await store.login('a@b.c', 'pw');
    await store.logout();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe('signedOut');
    expect(storage.data[SESSION_KEY]).toBeUndefined();

    const failing = make(memoryStorage(), {
      logout: async () => {
        throw new Error('offline');
      },
    });
    await failing.store.login('a@b.c', 'pw');
    await failing.store.logout();
    expect(failing.store.getState().status).toBe('signedOut');
  });

  it('401(handleUnauthorized)はサーバーに問い合わせず、ログイン画面へ戻す', async () => {
    const { store, logout, storage } = make();
    await store.login('a@b.c', 'pw');
    await store.handleUnauthorized();
    expect(logout).not.toHaveBeenCalled();
    expect(store.getState().status).toBe('signedOut');
    expect(store.getToken()).toBeNull();
    expect(storage.data[SESSION_KEY]).toBeUndefined();
  });
});

const acc = (id: string): LineAccount => ({ id, channelId: id, name: id, isActive: true, displayName: `Acc ${id}`, pictureUrl: null, basicId: null });

describe('公式アカウントの選択', () => {
  it('0件は none(権限の設定前)', () => {
    expect(resolveAccount([], 'a')).toEqual({ kind: 'none' });
  });
  it('保存済みの選択が許可に残っていればそれを使う', () => {
    expect(resolveAccount([acc('a'), acc('b')], 'b')).toEqual({ kind: 'selected', account: acc('b') });
  });
  it('1件だけなら自動で決める', () => {
    expect(resolveAccount([acc('a')], null)).toEqual({ kind: 'selected', account: acc('a') });
    expect(resolveAccount([acc('a')], 'removed')).toEqual({ kind: 'selected', account: acc('a') });
  });
  it('複数で未選択(または許可から外れた)なら選んでもらう', () => {
    expect(resolveAccount([acc('a'), acc('b')], null)).toEqual({ kind: 'choose' });
    expect(resolveAccount([acc('a'), acc('b')], 'removed')).toEqual({ kind: 'choose' });
  });
  it('選択を保存・読み出し・解除できる', async () => {
    const storage = memoryStorage();
    await saveSelectedAccountId(storage, 'a');
    expect(storage.data[SELECTED_ACCOUNT_KEY]).toBe('a');
    expect(await loadSelectedAccountId(storage)).toBe('a');
    await saveSelectedAccountId(storage, null);
    expect(await loadSelectedAccountId(storage)).toBeNull();
  });
});
