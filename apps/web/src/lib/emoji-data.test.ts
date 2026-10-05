import { describe, expect, test } from 'vitest'
import { EMOJI_GROUPS } from './emoji-data'

describe('絵文字ピッカーの候補', () => {
  test('どのグループにも絵文字があり、グループ内で重複しない', () => {
    expect(EMOJI_GROUPS.length).toBeGreaterThanOrEqual(6)
    for (const g of EMOJI_GROUPS) {
      expect(g.emojis.length).toBeGreaterThan(10)
      expect(new Set(g.emojis).size).toBe(g.emojis.length)
      // 空白や、文字化けの原因になる空要素が混ざらない
      for (const e of g.emojis) expect(e.trim()).toBe(e)
      for (const e of g.emojis) expect(e.length).toBeGreaterThan(0)
    }
  })

  test('合成された絵文字(肌色・性別・ZWJ)が1つの候補として分かれずに入っている', () => {
    const all = EMOJI_GROUPS.flatMap((g) => g.emojis)
    expect(all).toContain('🙋‍♀️')
    expect(all).toContain('💆‍♀️')
    expect(all).toContain('❤️')
  })
})
