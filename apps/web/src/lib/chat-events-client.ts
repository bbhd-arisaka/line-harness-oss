/** トークの新着の合図(WebSocket)を、管理画面が受け取るための、画面に依存しない部分 */
export type ChatEventKind = 'message' | 'friend_added' | 'form_answered' | 'sent'

export interface ChatEventMessage {
  kind: ChatEventKind
  friendId: string
  accountId: string | null
  at: string
}

const KINDS: ChatEventKind[] = ['message', 'friend_added', 'form_answered', 'sent']

/** API の URL から、WebSocket の接続先を作る(https → wss、http → ws) */
export function chatEventsUrl(apiBase: string): string {
  const base = apiBase.replace(/\/+$/, '')
  return `${base.replace(/^http/i, 'ws')}/api/chat-events`
}

/** サーバーから届いた文字列を、合図として読む。形が違うものは捨てる */
export function parseChatEvent(raw: unknown): ChatEventMessage | null {
  if (typeof raw !== 'string') return null
  try {
    const v = JSON.parse(raw) as Partial<ChatEventMessage> | null
    if (!v || typeof v !== 'object') return null
    if (!KINDS.includes(v.kind as ChatEventKind)) return null
    if (typeof v.friendId !== 'string' || !v.friendId) return null
    return {
      kind: v.kind as ChatEventKind,
      friendId: v.friendId,
      accountId: typeof v.accountId === 'string' ? v.accountId : null,
      at: typeof v.at === 'string' ? v.at : '',
    }
  } catch {
    return null
  }
}

/** つなぎ直すまでの待ち時間(ms): 1秒から倍々で、最大30秒 */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, Math.min(attempt, 10)))
}

/** 合図を受けたとき、この画面(選んでいる公式アカウント)に関係するか */
export function isEventForAccount(selectedAccountId: string | null | undefined, eventAccountId: string | null): boolean {
  if (!selectedAccountId || !eventAccountId) return true
  return selectedAccountId === eventAccountId
}

/** 合図の数を間引く: 同じキーの合図は、待ち時間のあいだ1回にまとめる(連続する新着で取り直しが重ならないように) */
export function createCoalescer(delayMs: number, run: (key: string) => void, setTimer: typeof setTimeout = setTimeout, clearTimer: typeof clearTimeout = clearTimeout) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  return {
    push(key: string) {
      if (pending.has(key)) return
      pending.set(key, setTimer(() => {
        pending.delete(key)
        run(key)
      }, delayMs))
    },
    clear() {
      for (const t of pending.values()) clearTimer(t)
      pending.clear()
    },
  }
}
