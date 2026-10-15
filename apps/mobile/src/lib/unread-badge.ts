// 下バー「トーク」の数字(未対応のトーク数)に使う、画面に依存しない小さな関数。

/** 数字が大きいとき(99超)は「99+」にする。0 や未取得は、表示しない(undefined) */
export function formatUnreadBadge(count: number | null | undefined): string | undefined {
  if (!count || count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}

/** 新着の確認(軽い)を何回かに1回は、変化が無くても数え直す(別の端末・Webで対応済みにされた分を拾う) */
export const FORCE_RELOAD_EVERY = 6;

/**
 * 未対応数を取り直すか。
 * - まだ一度も取っていない(lastLatest が null)→ 取る
 * - 新着の時刻が変わった → 取る
 * - 変化が無くても、確認 FORCE_RELOAD_EVERY 回に1回は取る
 */
export function shouldReloadUnread(lastLatest: string | null, latest: string | null, tick: number): boolean {
  if (lastLatest === null) return true;
  if (latest !== lastLatest) return true;
  return tick > 0 && tick % FORCE_RELOAD_EVERY === 0;
}
