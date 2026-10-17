/**
 * トーク画面(PC)の3つの列(左=トーク一覧・中央=やりとり・右=友だち詳細)の横幅を、ドラッグで変えるための計算。
 * 左と右の幅だけを持ち、中央は残り全部。保存は、ブラウザの localStorage(この端末だけ)。
 */
export const LIST_MIN = 240
export const LIST_MAX = 560
export const SIDE_MIN = 240
export const SIDE_MAX = 560
/** 中央(やりとり・入力欄)が、これより狭くならないようにする */
export const CENTER_MIN = 380
/** 列の境目(ドラッグの取っ手)の太さ */
export const HANDLE_PX = 8
/** キーボードの矢印1回で動く幅 */
export const KEY_STEP = 16

export const PANE_STORAGE_KEY = 'beyond-line.chats.paneWidths.v1'

export type PaneKind = 'list' | 'side'

export interface PaneWidths {
  /** null = まだ変えていない(画面の大きさに合わせた、もとの幅) */
  list: number | null
  side: number | null
}

export interface PaneLayout {
  /** チャット画面の、全体の横幅 */
  container: number
  /** いま見えている、もう片方の列の幅(右の列が出ていないときは 0) */
  other: number
  /** 右の列が出ているか(境目の取っ手の数が変わる) */
  sideVisible: boolean
}

/** 動かしたい幅を、小さすぎ・大きすぎにならない範囲(中央の最小幅を守る)におさめる */
export function clampPaneWidth(kind: PaneKind, desired: number, layout: PaneLayout): number {
  const min = kind === 'list' ? LIST_MIN : SIDE_MIN
  const hardMax = kind === 'list' ? LIST_MAX : SIDE_MAX
  const handles = (layout.sideVisible ? 2 : 1) * HANDLE_PX
  const room = layout.container - layout.other - CENTER_MIN - handles
  const max = Math.max(min, Math.min(hardMax, room))
  const v = Number.isFinite(desired) ? desired : min
  return Math.round(Math.min(max, Math.max(min, v)))
}

function validWidth(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null
}

/** 保存してある文字列を読む。壊れていたら「変えていない」に戻す */
export function parsePaneWidths(raw: string | null | undefined): PaneWidths {
  if (!raw) return { list: null, side: null }
  try {
    const j = JSON.parse(raw) as { list?: unknown; side?: unknown }
    return { list: validWidth(j.list, LIST_MIN, LIST_MAX), side: validWidth(j.side, SIDE_MIN, SIDE_MAX) }
  } catch {
    return { list: null, side: null }
  }
}

export function serializePaneWidths(w: PaneWidths): string {
  return JSON.stringify({ list: w.list, side: w.side })
}
