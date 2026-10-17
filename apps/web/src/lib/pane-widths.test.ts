import { describe, expect, it } from 'vitest'
import { CENTER_MIN, HANDLE_PX, LIST_MAX, LIST_MIN, SIDE_MAX, SIDE_MIN, clampPaneWidth, parsePaneWidths, serializePaneWidths } from './pane-widths'

describe('clampPaneWidth(列の幅の範囲)', () => {
  const wide = { container: 1800, other: 360, sideVisible: true }
  it('範囲の中ならそのまま(整数にそろえる)', () => {
    expect(clampPaneWidth('list', 400.4, wide)).toBe(400)
    expect(clampPaneWidth('side', 333, wide)).toBe(333)
  })
  it('小さすぎ・大きすぎは、最小・最大におさめる', () => {
    expect(clampPaneWidth('list', 10, wide)).toBe(LIST_MIN)
    expect(clampPaneWidth('list', 9999, wide)).toBe(LIST_MAX)
    expect(clampPaneWidth('side', 10, wide)).toBe(SIDE_MIN)
    expect(clampPaneWidth('side', 9999, wide)).toBe(SIDE_MAX)
  })
  it('中央(やりとり)が最小幅より狭くならない', () => {
    const narrow = { container: 1200, other: 320, sideVisible: true }
    const max = narrow.container - narrow.other - CENTER_MIN - HANDLE_PX * 2
    expect(clampPaneWidth('list', 9999, narrow)).toBe(max)
    // 右の列が出ていないときは、取っ手が1つ分少ない
    const noSide = { container: 1200, other: 0, sideVisible: false }
    expect(clampPaneWidth('list', 9999, noSide)).toBe(LIST_MAX)
  })
  it('画面が狭すぎて、範囲が作れないときは、最小幅にする', () => {
    expect(clampPaneWidth('list', 400, { container: 700, other: 300, sideVisible: true })).toBe(LIST_MIN)
  })
  it('数値でないものは最小幅', () => {
    expect(clampPaneWidth('list', Number.NaN, wide)).toBe(LIST_MIN)
  })
})

describe('保存した幅の読み書き', () => {
  it('書いたものを、そのまま読める', () => {
    expect(parsePaneWidths(serializePaneWidths({ list: 400, side: 300 }))).toEqual({ list: 400, side: 300 })
    expect(parsePaneWidths(serializePaneWidths({ list: null, side: 300 }))).toEqual({ list: null, side: 300 })
  })
  it('空・壊れた文字・範囲の外は、「変えていない」(null)に戻す', () => {
    expect(parsePaneWidths(null)).toEqual({ list: null, side: null })
    expect(parsePaneWidths('{oops')).toEqual({ list: null, side: null })
    expect(parsePaneWidths(JSON.stringify({ list: 5, side: 99999 }))).toEqual({ list: null, side: null })
    expect(parsePaneWidths(JSON.stringify({ list: '400', side: null }))).toEqual({ list: null, side: null })
  })
})
