// トーク画面の「メッセージ + 出来事のログ(events)」を時刻順に混ぜる純粋な関数。
// events は GET /api/chats/:id の data.events(古いサーバーでは無いので undefined も許す)。

export interface ChatEvent {
  id: string
  /** tag_added / blocked / form_submitted など。未知の type も同じ見た目で出す */
  type: string
  /** 表示用に完成した日本語(例: 「タグ「SNS流入」を追加しました」) */
  text: string
  /** 操作した人(スタッフ名・システム・フォーム・自動・LINE)。無ければ null */
  actor: string | null
  createdAt: string
}

export type TimelineItem<M extends { id: string; createdAt: string }> =
  | { kind: 'message'; key: string; createdAt: string; message: M }
  | { kind: 'event'; key: string; createdAt: string; event: ChatEvent }

function toMs(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * メッセージと events を時刻の昇順に混ぜる。同時刻のときはメッセージを先に出す
 * (それぞれの元の並びは保つ)。events が undefined / 空ならメッセージだけ。
 */
export function mergeTimeline<M extends { id: string; createdAt: string }>(
  messages: M[] | undefined,
  events: ChatEvent[] | undefined,
): TimelineItem<M>[] {
  const items: TimelineItem<M>[] = []
  for (const message of messages ?? []) {
    items.push({ kind: 'message', key: message.id, createdAt: message.createdAt, message })
  }
  const evs = events ?? []
  if (evs.length === 0) return items
  for (const event of evs) {
    items.push({ kind: 'event', key: `event-${event.id}`, createdAt: event.createdAt, event })
  }
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const d = toMs(a.item.createdAt) - toMs(b.item.createdAt)
      if (d !== 0) return d
      if (a.item.kind !== b.item.kind) return a.item.kind === 'message' ? -1 : 1
      return a.i - b.i
    })
    .map((x) => x.item)
}

/** 出来事の種類ごとの控えめな色分け(Tailwind のクラス)。未知の type は既定の薄いグレー */
export function eventToneClass(type: string): string {
  switch (type) {
    case 'blocked':
      return 'text-red-50 bg-red-900/30'
    case 'form_submitted':
      return 'text-emerald-50 bg-emerald-900/30'
    default:
      return 'text-white/70 bg-black/15'
  }
}

/** 操作した人があれば「 ・ actor」を返す */
export function eventActorSuffix(actor: string | null | undefined): string {
  const a = actor?.trim()
  return a ? ` ・ ${a}` : ''
}

/** 一覧が変わったか(ポーリング後のスクロール追従用): 件数と末尾の id */
export function timelineSignature(
  messages: { id: string }[] | undefined,
  events: { id: string }[] | undefined,
): string {
  const m = messages ?? []
  const e = events ?? []
  return `${m.length}:${m[m.length - 1]?.id ?? ''}|${e.length}:${e[e.length - 1]?.id ?? ''}`
}
