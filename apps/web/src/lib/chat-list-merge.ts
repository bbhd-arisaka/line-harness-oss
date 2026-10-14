/**
 * トーク一覧の「裏の更新」(新着の自動反映)。最新の1ページ分を取り直したとき、
 * すでに「さらに読み込む」で表示している古い分は消さない。一覧は新しい順で、
 * 取り直した1ページ分より古い行だけを、元の一覧から引き継ぐ。
 */
export function mergeFreshChats<T extends { id: string; lastMessageAt: string | null }>(prev: T[], fresh: T[], pageSize: number, unansweredOnly = false): T[] {
  // 全件が返る絞り込み(未対応のみ)と、1ページに満たないとき = 取り直した結果が全件
  if (unansweredOnly || fresh.length < pageSize) return fresh
  const cutoff = fresh[fresh.length - 1]?.lastMessageAt
  if (!cutoff) return fresh
  const ids = new Set(fresh.map((f) => f.id))
  const older = prev.filter((p) => !ids.has(p.id) && !!p.lastMessageAt && p.lastMessageAt < cutoff)
  return [...fresh, ...older]
}

/** 取り直したら、お客様からの新着が増えたか(サイドバーの未対応バッジを即時更新するかの判断) */
export function hasNewIncoming<T extends { id: string; lastMessageAt: string | null; lastMessageDirection?: string | null }>(prev: T[], fresh: T[]): boolean {
  const before = new Map(prev.map((p) => [p.id, p.lastMessageAt ?? '']))
  return fresh.some((f) => f.lastMessageDirection === 'incoming' && (f.lastMessageAt ?? '') > (before.get(f.id) ?? ''))
}

/** ユーザーが下端付近を見ているか(新着が来たとき、最新まで自動で追従してよいかの判断) */
export function isNearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, threshold = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}
