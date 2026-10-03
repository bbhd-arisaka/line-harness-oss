// 公式アカウントの選択ロジック(純粋関数)。保存先は auth.ts の KeyValueStorage と同じ。
import type { KeyValueStorage } from './auth';
import type { LineAccount } from './types';

export const SELECTED_ACCOUNT_KEY = 'beyondline.selectedAccountId';

export const NO_ACCOUNTS_MESSAGE = '見られるアカウントがありません。管理者に権限の設定を依頼してください';

export type AccountResolution =
  /** 0件: 権限の設定前 */
  | { kind: 'none' }
  /** 保存済みの選択が有効、または1件だけなので自動で決まった */
  | { kind: 'selected'; account: LineAccount }
  /** 複数あって未選択(または保存した選択が許可から外れた): 選んでもらう */
  | { kind: 'choose' };

export function resolveAccount(accounts: LineAccount[], savedId: string | null): AccountResolution {
  if (accounts.length === 0) return { kind: 'none' };
  const saved = savedId ? accounts.find((a) => a.id === savedId) : undefined;
  if (saved) return { kind: 'selected', account: saved };
  if (accounts.length === 1) return { kind: 'selected', account: accounts[0] };
  return { kind: 'choose' };
}

export function accountLabel(a: LineAccount): string {
  return a.displayName || a.name;
}

export async function loadSelectedAccountId(storage: KeyValueStorage): Promise<string | null> {
  try {
    return await storage.get(SELECTED_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export async function saveSelectedAccountId(storage: KeyValueStorage, id: string | null): Promise<void> {
  try {
    if (id) await storage.set(SELECTED_ACCOUNT_KEY, id);
    else await storage.remove(SELECTED_ACCOUNT_KEY);
  } catch {
    // 保存に失敗しても、今回の選択は有効
  }
}
