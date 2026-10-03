// ログイン状態の管理。保存先(storage)と API 呼び出しは外から渡すので、React Native に依存しない。
import type { LoginResult, Staff } from './types';

/** トークンの保存先(実機では expo-secure-store、Web 確認では localStorage) */
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const SESSION_KEY = 'beyondline.session';

export interface AuthState {
  /** loading=保存済みの確認中 */
  status: 'loading' | 'signedOut' | 'signedIn';
  token: string | null;
  staff: Staff | null;
  expiresAt: string | null;
}

interface StoredSession {
  token: string;
  expiresAt: string;
  staff: Staff;
}

export interface AuthDeps {
  storage: KeyValueStorage;
  login: (email: string, password: string, deviceName: string) => Promise<LoginResult>;
  logout: () => Promise<unknown>;
  deviceName: string;
  now?: () => Date;
}

const SIGNED_OUT: AuthState = { status: 'signedOut', token: null, staff: null, expiresAt: null };

function parseStored(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof v.token === 'string' && v.token && typeof v.expiresAt === 'string' && v.staff && typeof v.staff.id === 'string') {
      return v as StoredSession;
    }
  } catch {
    // 壊れた保存データは無いものとして扱う
  }
  return null;
}

export function createAuthStore(deps: AuthDeps) {
  const now = deps.now ?? (() => new Date());
  let state: AuthState = { status: 'loading', token: null, staff: null, expiresAt: null };
  const listeners = new Set<() => void>();

  function set(next: AuthState) {
    state = next;
    listeners.forEach((l) => l());
  }

  async function clearStored() {
    try {
      await deps.storage.remove(SESSION_KEY);
    } catch {
      // 削除に失敗しても、メモリ上はログアウトにする
    }
  }

  return {
    getState: () => state,
    getToken: () => state.token,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** 起動時: 保存済みのトークンを読み込む(期限切れなら捨てる) */
    async restore() {
      let stored: StoredSession | null = null;
      try {
        stored = parseStored(await deps.storage.get(SESSION_KEY));
      } catch {
        stored = null;
      }
      if (!stored) {
        set(SIGNED_OUT);
        return;
      }
      const expires = new Date(stored.expiresAt).getTime();
      if (Number.isFinite(expires) && expires <= now().getTime()) {
        await clearStored();
        set(SIGNED_OUT);
        return;
      }
      set({ status: 'signedIn', token: stored.token, staff: stored.staff, expiresAt: stored.expiresAt });
    },

    /** ログイン。失敗したら API のエラーをそのまま投げる(画面側で error.message を表示) */
    async login(email: string, password: string) {
      const result = await deps.login(email.trim(), password, deps.deviceName);
      const session: StoredSession = { token: result.token, expiresAt: result.expiresAt, staff: result.staff };
      await deps.storage.set(SESSION_KEY, JSON.stringify(session));
      set({ status: 'signedIn', token: result.token, staff: result.staff, expiresAt: result.expiresAt });
    },

    /** ログアウト: サーバー側のトークンも取り消す(失敗しても端末側は必ずログアウトする) */
    async logout() {
      try {
        if (state.token) await deps.logout();
      } catch {
        // 通信できなくても端末のトークンは消す
      }
      await clearStored();
      set(SIGNED_OUT);
    },

    /** 401 を受けたとき: サーバーには問い合わせず、端末のトークンを消してログイン画面へ */
    async handleUnauthorized() {
      if (state.status !== 'signedIn') return;
      await clearStored();
      set(SIGNED_OUT);
    },
  };
}

export type AuthStore = ReturnType<typeof createAuthStore>;
