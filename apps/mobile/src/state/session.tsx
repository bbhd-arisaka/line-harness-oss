import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api, authStore, storage } from './services';
import {
  loadSelectedAccountId,
  resolveAccount,
  saveSelectedAccountId,
} from '../lib/accounts';
import type { AuthState } from '../lib/auth';
import type { LineAccount } from '../lib/types';
import { describeError } from '../lib/errors';

/** ログイン状態(保存済みのトークンの復元を起動時に1回行う) */
export function useAuth(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.getState, authStore.getState);
}

let restoreStarted = false;
export function useRestoreSession() {
  useEffect(() => {
    if (restoreStarted) return;
    restoreStarted = true;
    void authStore.restore();
  }, []);
}

export { authStore };

// ── 公式アカウント ──

interface AccountContextValue {
  /** 取得の状態。error のときは message に API のエラー文言 */
  status: 'loading' | 'ready' | 'error';
  errorMessage: string | null;
  accounts: LineAccount[];
  /** 選択中のアカウント(未選択なら null) */
  selected: LineAccount | null;
  /** 切り替え画面を開いている間 true */
  choosing: boolean;
  startChoosing: () => void;
  cancelChoosing: () => void;
  choose: (id: string) => void;
  reload: () => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountContextValue['status']>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<LineAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const [list, savedId] = await Promise.all([api.listLineAccounts(), loadSelectedAccountId(storage)]);
        if (cancelled) return;
        const resolution = resolveAccount(list, savedId);
        setAccounts(list);
        setSelectedId(resolution.kind === 'selected' ? resolution.account.id : null);
        setChoosing(resolution.kind === 'choose');
        setErrorMessage(null);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setErrorMessage(describeError(e, '読み込めませんでした'));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const choose = useCallback((id: string) => {
    setSelectedId(id);
    setChoosing(false);
    void saveSelectedAccountId(storage, id);
  }, []);

  const value = useMemo<AccountContextValue>(
    () => ({
      status,
      errorMessage,
      accounts,
      selected: accounts.find((a) => a.id === selectedId) ?? null,
      choosing,
      startChoosing: () => setChoosing(true),
      cancelChoosing: () => setChoosing(false),
      choose,
      reload: () => setNonce((n) => n + 1),
    }),
    [status, errorMessage, accounts, selectedId, choosing, choose],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccounts(): AccountContextValue {
  const v = useContext(AccountContext);
  if (!v) throw new Error('AccountProvider の外で useAccounts を使っています');
  return v;
}
