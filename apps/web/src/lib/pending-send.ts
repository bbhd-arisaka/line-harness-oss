/**
 * 「送信の取り消し」がオンのとき、送信ボタンを押してから10秒のあいだ、送信を待たせておく置き場。
 * 画面(トークのページ)とは別に持つので、待っている間に別のページへ移っても、10秒たてば送られる。
 * ページを閉じる・裏に回るときは、待たずにすぐ送る。
 */

/** 送信を取り消せる時間(ミリ秒) */
export const UNDO_SEND_MS = 10_000

export interface PendingSend {
  chatId: string
  text: string
  /** 添付している画像(送信画面の部品の値。ここでは中身を見ない) */
  image: unknown
  /** 送る時刻(ミリ秒) */
  deadline: number
}

export type PendingEvent = { kind: 'queued' | 'cancelled' | 'flushed' | 'sent'; chatId: string } | { kind: 'failed'; chatId: string; message: string }

interface Entry {
  info: PendingSend
  timer: ReturnType<typeof setTimeout>
  /** 実際に送る処理。失敗したときの後始末(入力欄に戻す)も、この中で行う */
  run: () => Promise<void>
}

const entries = new Map<string, Entry>()
const listeners = new Set<(e: PendingEvent) => void>()

function emit(e: PendingEvent) {
  for (const l of listeners) l(e)
}

export function subscribePending(fn: (e: PendingEvent) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getPending(chatId: string): PendingSend | null {
  return entries.get(chatId)?.info ?? null
}

/** 待っている送信を、いますぐ送る */
export function flushPending(chatId: string): Promise<void> {
  const entry = entries.get(chatId)
  if (!entry) return Promise.resolve()
  clearTimeout(entry.timer)
  entries.delete(chatId)
  emit({ kind: 'flushed', chatId })
  return entry.run()
}

export function flushAllPending(): void {
  for (const chatId of [...entries.keys()]) void flushPending(chatId)
}

/** 取り消す。待っていた送信の内容を返す(入力欄に戻すため)。待っていなければ null */
export function cancelPending(chatId: string): PendingSend | null {
  const entry = entries.get(chatId)
  if (!entry) return null
  clearTimeout(entry.timer)
  entries.delete(chatId)
  emit({ kind: 'cancelled', chatId })
  return entry.info
}

/** 10秒待ってから送る。同じトークで続けて送ったときは、前のものをすぐ送ってから、新しく待たせる */
export function startPending(info: Omit<PendingSend, 'deadline'>, run: () => Promise<void>, delayMs = UNDO_SEND_MS): PendingSend {
  void flushPending(info.chatId)
  const full: PendingSend = { ...info, deadline: Date.now() + delayMs }
  const timer = setTimeout(() => void flushPending(info.chatId), delayMs)
  entries.set(info.chatId, { info: full, timer, run })
  emit({ kind: 'queued', chatId: info.chatId })
  return full
}

export function notifyPending(e: PendingEvent): void {
  emit(e)
}

/** 残り秒数(表示用)。切り上げて、0 にはしない */
export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(1, Math.ceil((deadline - now) / 1000))
}

let hooked = false
/** ページを閉じる・移る・裏に回るときの扱い(1回だけ登録)。閉じようとしたときは、ブラウザの確認を出して、待っている送信を失わせない */
export function hookPageLifecycle(): void {
  if (hooked || typeof window === 'undefined') return
  hooked = true
  window.addEventListener('beforeunload', (e) => {
    if (entries.size === 0) return
    e.preventDefault()
    e.returnValue = ''
  })
  window.addEventListener('pagehide', () => flushAllPending())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllPending()
  })
}
