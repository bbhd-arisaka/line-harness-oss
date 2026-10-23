/** 送信を取り消せる時間(ミリ秒) */
export const UNDO_SEND_MS = 10_000;

/** 残り秒数(表示用)。切り上げて、0 にはしない(送る瞬間まで「1」) */
export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(1, Math.ceil((deadline - now) / 1000));
}
