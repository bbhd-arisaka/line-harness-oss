/**
 * Lステップの友だち ↔ beyond line の友だち の突き合わせ(match2.cjs の移植)。
 * LINEユーザーIDは Lステップから取れないので、
 *   プロフィール画像の識別子(0h始まり=後ろ4文字 / 0m始まり=先頭14文字) と LINE登録名
 * の2つで決める。
 */
import { csvById } from './csv'
import type { BeyondFriend, LstepPackage } from './types'

export type MatchHow =
  | 'pic+name' | 'pic≠name' | 'pic(name:other)' | 'pic(name:none)'
  | 'name' | 'name(pic:multi)' | 'name:multi' | 'none' | 'manual'

export interface MatchResult {
  /** Lステップの友だちID */
  id: string
  /** CSV の LINE登録名(絵文字は「?」に化けていることがある) */
  line: string
  /** 友だちリスト画面の名前(UTF-8のまま。絵文字も正しい) */
  listName: string
  /** Lステップ側の画像の照合キー(候補探しに使う) */
  picTok: string
  how: MatchHow
  /** 対応する beyond line の友だちID(決まらなければ null) */
  pick: string | null
  /** 画像と名前が食い違う、同名が複数いる、など自動で決められなかった */
  conflict: boolean
  /** CSV の「ユーザーブロック」('0' / '1' / '') */
  blocked: string
  /** 有効な友だち一覧(ブロック済みは出ない)に載っているか */
  inList: boolean
  /** 友だち情報・タグが入っているか */
  hasData: boolean
}

export interface ReviewItem {
  lstepId: string
  name: string
  listName: string
  how: MatchHow
  hasData: boolean
  /** 名前・画像から見つけた beyond line 側の候補(最大5件) */
  candidates: BeyondFriend[]
}

export interface MatchSummary {
  total: number
  byHow: Record<string, number>
  matched: number
  /** 有効(一覧にいて、ブロックされていない)なのに決まらなかった数 */
  activeUnmatched: number
  blockedUnmatched: number
  blockedMatched: number
  /** 同じ beyond の友だちに複数の Lステップ記録が当たった、beyond の友だち数 */
  claimedByMultiple: number
  manualApplied: number
}

export interface MatchOptions {
  /** 人が決めた対応づけ: Lステップの友だちID → beyond line の友だちID */
  manualPicks?: Record<string, string>
}

// ── 識別子・名前の正規化 ──────────────────────────────────────────────

/** 0h始まり=プレフィックスの後ろ4文字 / 0m始まり=識別子の先頭14文字 */
export const tokKey = (t: string): string => (!t ? '' : t.startsWith('0h') ? t.slice(2, 6) : t.slice(0, 14))
/** beyond line の picture_url から */
export const beyondTok = (u: string | null | undefined): string => tokKey(((u || '').match(/\/(0[hm][0-9A-Za-z_-]+)/) || [])[1] || '')
/** Lステップの友だちリストの画像URL(…/face/v2/<識別子>/…)から */
export const lstepTok = (u: string | null | undefined): string =>
  tokKey((((u || '').split(/\/face\/v[0-9]+\//)[1] || '').split('/')[0].match(/^(0[hm][0-9A-Za-z_-]+)/) || [])[1] || '')
export const normName = (s: string | null | undefined): string => (s || '').normalize('NFKC').replace(/[\s　]/g, '').toLowerCase()

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]) }

/** 有効な友だち = 一覧にいて、ブロックされていない */
const isActive = (r: MatchResult) => r.inList && r.blocked !== '1'
const unresolved = (r: MatchResult) => !r.pick || r.conflict

// ── 突き合わせ本体 ───────────────────────────────────────────────────

export function matchFriends(
  pkg: LstepPackage,
  beyondFriends: BeyondFriend[],
  opts: MatchOptions = {},
): { results: MatchResult[]; summary: MatchSummary; review: ReviewItem[] } {
  const C = csvById(pkg.csvRows)
  const L = pkg.list || {}
  const M = pkg.members || {}

  const bByName = new Map<string, BeyondFriend[]>()
  const bByTok = new Map<string, BeyondFriend[]>()
  for (const b of beyondFriends) {
    const n = normName(b.displayName)
    if (n) push(bByName, n, b)
    const t = beyondTok(b.pictureUrl)
    if (t) push(bByTok, t, b)
  }
  const beyondIds = new Set(beyondFriends.map((b) => b.id))

  // CSV にいる人 + CSV に無いが一覧にいる人
  const ids = [...Object.keys(C), ...Object.keys(L).filter((id) => !C[id])]
  const results: MatchResult[] = []
  for (const id of ids) {
    const c = C[id]
    const line = c ? c['LINE登録名'] ?? '' : ''
    const tok = lstepTok((L[id] || {}).pic)
    const byName = bByName.get(normName(line)) || []
    const byPic = tok ? bByTok.get(tok) || [] : []
    let pick: BeyondFriend | null = null
    let how: MatchHow = 'none'
    let conflict = false
    const picU = byPic.length === 1 ? byPic[0] : null
    const nameU = byName.length === 1 ? byName[0] : null
    if (picU && nameU && picU.id === nameU.id) { pick = picU; how = 'pic+name' }
    else if (picU && nameU && picU.id !== nameU.id) { conflict = true; how = 'pic≠name' }
    else if (picU) { pick = picU; how = byName.length ? 'pic(name:other)' : 'pic(name:none)' }
    else if (nameU) { pick = nameU; how = byPic.length > 1 ? 'name(pic:multi)' : 'name' }
    else if (byName.length > 1) { conflict = true; how = 'name:multi' }
    const m = M[id]
    results.push({
      id, line, listName: (L[id] || {}).name ?? '', picTok: tok, how, pick: pick ? pick.id : null, conflict,
      blocked: c ? c['ユーザーブロック'] ?? '' : '0',
      inList: !!L[id],
      hasData: !!((m?.vars || []).length || (m?.tags || []).length),
    })
  }

  // 人が決めた対応づけ(存在しない beyond の友だちIDは無視)
  let manualApplied = 0
  const manual = opts.manualPicks || {}
  for (const r of results) {
    const b = manual[r.id]
    if (b && beyondIds.has(b)) { r.pick = b; r.conflict = false; r.how = 'manual'; manualApplied++ }
  }

  return { results, summary: summarize(results, manualApplied), review: buildReview(results, beyondFriends) }
}

/** 決まっていて、衝突していないものだけ: Lステップの友だちID → beyond の友だちID */
export function beyondOf(results: MatchResult[]): Map<string, string> {
  return new Map(results.filter((m) => m.pick && !m.conflict).map((m) => [m.id, m.pick as string]))
}

/**
 * beyond の友だちごとに、当たった Lステップ記録を並べる。
 * 同じ beyond の友だちに複数当たったとき(再追加など)は、有効(ブロックされていない)・一覧にいるほうが先頭(=採用)。
 */
export function groupByOwner(results: MatchResult[]): Map<string, MatchResult[]> {
  const active = new Map<string, MatchResult[]>()
  for (const mt of results) {
    if (!mt.pick || mt.conflict) continue
    push(active, mt.pick, mt)
  }
  for (const cands of active.values()) {
    cands.sort((a, b) => (a.blocked === '0' ? 0 : 1) - (b.blocked === '0' ? 0 : 1) || (b.inList ? 1 : 0) - (a.inList ? 1 : 0))
  }
  return active
}

function summarize(results: MatchResult[], manualApplied: number): MatchSummary {
  const byHow: Record<string, number> = {}
  for (const o of results) byHow[o.how] = (byHow[o.how] || 0) + 1
  return {
    total: results.length,
    byHow,
    matched: results.filter((o) => !unresolved(o)).length,
    activeUnmatched: results.filter((o) => isActive(o) && unresolved(o)).length,
    blockedUnmatched: results.filter((o) => !isActive(o) && unresolved(o)).length,
    blockedMatched: results.filter((o) => !isActive(o) && !unresolved(o)).length,
    claimedByMultiple: [...groupByOwner(results).values()].filter((a) => a.length > 1).length,
    manualApplied,
  }
}

// ── 要確認リスト(自動で決められなかった有効な友だち)と候補 ───────────

const GARBLED = /[?？�]+/

/** 名前の近さ: 完全一致 90 / 部分一致 50 / 「?」(化けた絵文字)を飛ばして順に含む 40 / それ以外 0 */
export function nameScore(lstepName: string, beyondNormalized: string): number {
  if (!beyondNormalized) return 0
  if (!GARBLED.test(lstepName)) {
    const n = normName(lstepName)
    if (!n) return 0
    if (n === beyondNormalized) return 90
    if (n.length >= 2 && beyondNormalized.length >= 2 && (beyondNormalized.includes(n) || n.includes(beyondNormalized))) return 50
    return 0
  }
  const segs = lstepName.split(GARBLED).map(normName).filter(Boolean)
  if (!segs.length) return 0
  let pos = 0
  for (const sg of segs) {
    const i = beyondNormalized.indexOf(sg, pos)
    if (i < 0) return 0
    pos = i + sg.length
  }
  return 40
}

export function buildReview(results: MatchResult[], beyondFriends: BeyondFriend[], limit = 5): ReviewItem[] {
  const targets = results.filter((r) => isActive(r) && unresolved(r))
  if (!targets.length) return []
  const claimed = new Set(results.filter((r) => !unresolved(r)).map((r) => r.pick as string))
  const prepared = beyondFriends.map((b) => ({ b, n: normName(b.displayName), t: beyondTok(b.pictureUrl) }))
  return targets.map((r) => {
    const names = [r.line, r.listName].filter(Boolean)
    const scored: Array<{ b: BeyondFriend; s: number }> = []
    for (const p of prepared) {
      let s = r.picTok && p.t === r.picTok ? 100 : 0
      let best = 0
      for (const nm of names) best = Math.max(best, nameScore(nm, p.n))
      s += best
      if (s <= 0) continue
      if (claimed.has(p.b.id)) s -= 20
      if (p.b.isFollowing) s += 1
      scored.push({ b: p.b, s })
    }
    scored.sort((a, b) => b.s - a.s)
    return {
      lstepId: r.id, name: r.line, listName: r.listName, how: r.how, hasData: r.hasData,
      candidates: scored.slice(0, limit).map((x) => x.b),
    }
  })
}
