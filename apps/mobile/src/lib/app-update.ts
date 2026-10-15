// 【アプリの強制アップデート】古いアプリを使えなくして、App Store の最新版への更新だけを案内する。
// サーバーが「更新が必要」と答えた(HTTP 426 / 起動時の確認)ら、画面全体を更新の案内に切り替える。
// 画面に依存しない小さな状態の置き場(React Native に依存しない)。

export const DEFAULT_STORE_URL = 'https://apps.apple.com/jp/app/beyond-line/id6820799381';

export interface UpdateState {
  required: boolean;
  storeUrl: string;
}

let state: UpdateState = { required: false, storeUrl: DEFAULT_STORE_URL };
const listeners = new Set<() => void>();

export function getUpdateState(): UpdateState {
  return state;
}

/** 更新が必要になった。storeUrl はサーバーが教えた App Store の URL(https の apps.apple.com だけ受け付ける) */
export function markUpdateRequired(storeUrl?: string | null): void {
  const safe = typeof storeUrl === 'string' && /^https:\/\/apps\.apple\.com\//.test(storeUrl) ? storeUrl : state.storeUrl;
  if (state.required && state.storeUrl === safe) return;
  state = { required: true, storeUrl: safe };
  for (const l of [...listeners]) l();
}

export function subscribeUpdateState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** テスト用: 初期状態に戻す */
export function resetUpdateState(): void {
  state = { required: false, storeUrl: DEFAULT_STORE_URL };
  for (const l of [...listeners]) l();
}

/** サーバーに、アプリの版を伝えるヘッダー(サーバーは、古いアプリかどうかの判定に使う) */
export function appVersionHeaders(version: string | null | undefined, build: string | null | undefined): Record<string, string> {
  const h: Record<string, string> = {};
  if (version) h['X-App-Version'] = version;
  if (build && /^\d{1,6}$/.test(build)) h['X-App-Build'] = build;
  return h;
}
