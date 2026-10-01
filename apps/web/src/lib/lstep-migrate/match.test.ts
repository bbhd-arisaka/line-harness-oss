import { describe, expect, it } from 'vitest'
import { beyondOf, beyondTok, groupByOwner, lstepTok, matchFriends, nameScore, normName } from './match'
import { matchFixture } from './testkit'

describe('画像の識別子', () => {
  it('0h は後ろ4文字(プレフィックス0hの直後の4文字)、0m は先頭14文字で照合する', () => {
    expect(beyondTok('https://profile.example.test/0hABCDefghij')).toBe('ABCD')
    expect(lstepTok('https://obs.example.test/face/v2/0hABCDzzzz/preview')).toBe('ABCD')
    expect(beyondTok('https://profile.example.test/0mQWERTYUIOPASDFxyz')).toBe('0mQWERTYUIOPAS')
    expect(lstepTok('https://obs.example.test/face/v2/0mQWERTYUIOPASxxxxx/preview')).toBe('0mQWERTYUIOPAS')
  })
  it('画像が無い・形が違うときは空', () => {
    expect(beyondTok(null)).toBe('')
    expect(beyondTok('https://example.test/noimage.png')).toBe('')
    expect(lstepTok(null)).toBe('')
    expect(lstepTok('https://example.test/other/0hABCD')).toBe('')
  })
})

describe('normName', () => {
  it('全角半角・空白・大文字小文字をそろえる', () => {
    expect(normName('Ｔａｒｏ　Ｙａｍａ da')).toBe('taroyamada')
    expect(normName(null)).toBe('')
  })
})

describe('matchFriends: 分類', () => {
  const { beyond, pkg } = matchFixture()
  const { results, summary } = matchFriends(pkg, beyond)
  const by = Object.fromEntries(results.map((r) => [r.id, r]))

  it('全分類が移植元(match2.cjs)と同じ判定になる', () => {
    expect(by['1']).toMatchObject({ how: 'pic+name', pick: 'b1', conflict: false })
    expect(by['2']).toMatchObject({ how: 'pic+name', pick: 'b2' }) // 0m
    expect(by['3']).toMatchObject({ how: 'none', pick: null }) // 絵文字が「?」に化けた
    expect(by['4']).toMatchObject({ how: 'name:multi', pick: null, conflict: true })
    expect(by['5']).toMatchObject({ how: 'pic≠name', pick: null, conflict: true })
    expect(by['6']).toMatchObject({ how: 'name', pick: 'b1', blocked: '1', inList: false })
    expect(by['7']).toMatchObject({ how: 'pic(name:none)', pick: 'b9' })
    expect(by['8']).toMatchObject({ how: 'pic(name:other)', pick: 'b9' })
    expect(by['9']).toMatchObject({ how: 'name', pick: 'b10' })
    expect(by['10']).toMatchObject({ how: 'name(pic:multi)', pick: 'b12' })
    expect(by['11']).toMatchObject({ how: 'none', pick: null })
    expect(by['12']).toMatchObject({ how: 'none', blocked: '1' })
  })

  it('集計', () => {
    expect(summary.total).toBe(12)
    expect(summary.byHow).toEqual({
      'pic+name': 2, none: 3, 'name:multi': 1, 'pic≠name': 1, name: 2, 'pic(name:none)': 1, 'pic(name:other)': 1, 'name(pic:multi)': 1,
    })
    expect(summary.matched).toBe(7)
    expect(summary.activeUnmatched).toBe(4)
    expect(summary.blockedUnmatched).toBe(1)
    expect(summary.blockedMatched).toBe(1)
    expect(summary.claimedByMultiple).toBe(2) // b1(L1,L6) と b9(L7,L8)
  })

  it('同じ beyond の友だちに複数当たったときは、ブロックされていない・一覧にいるほうが先頭', () => {
    const g = groupByOwner(results)
    expect(g.get('b1')!.map((r) => r.id)).toEqual(['1', '6'])
    // 両方有効なら一覧順(同順位は元の順)
    expect(g.get('b9')!.map((r) => r.id)).toEqual(['7', '8'])
  })

  it('beyondOf は決まっていて衝突していないものだけ', () => {
    const m = beyondOf(results)
    expect(m.get('1')).toBe('b1')
    expect(m.get('6')).toBe('b1')
    expect(m.has('4')).toBe(false)
    expect(m.has('5')).toBe(false)
  })
})

describe('matchFriends: 要確認リスト', () => {
  const { beyond, pkg } = matchFixture()
  const { review } = matchFriends(pkg, beyond)
  const by = Object.fromEntries(review.map((r) => [r.lstepId, r]))

  it('有効で決まらなかった人だけ(ブロック済みは含めない)', () => {
    expect(review.map((r) => r.lstepId).sort()).toEqual(['11', '3', '4', '5'])
  })
  it('絵文字が化けた名前でも、一覧画面の名前で候補が見つかる', () => {
    expect(by['3'].listName).toBe('🌸さくら🌸')
    expect(by['3'].candidates[0].id).toBe('b3')
  })
  it('「?」で化けた名前だけでも、前後の文字から候補を探せる', () => {
    const p = { ...pkg, list: { ...pkg.list, '3': { ...pkg.list['3'], name: '' } } }
    const r = matchFriends(p, beyond).review.find((x) => x.lstepId === '3')!
    expect(r.candidates.map((c) => c.id)).toEqual(['b3'])
  })
  it('同名が複数いるときは、その全員が候補になる', () => {
    expect(by['4'].candidates.map((c) => c.id).sort()).toEqual(['b4', 'b5'])
  })
  it('画像と名前が食い違うときは、画像で当たった人を先に、名前で当たった人も候補に出す', () => {
    expect(by['5'].candidates.map((c) => c.id)).toEqual(['b8', 'b7'])
  })
  it('似た人がいなければ候補は空。候補は最大5件', () => {
    expect(by['11'].candidates).toEqual([])
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, displayName: `鈴木${i}`, pictureUrl: null, isFollowing: true }))
    const r = matchFriends(pkg, [...beyond, ...many]).review.find((x) => x.lstepId === '4')!
    expect(r.candidates).toHaveLength(5)
    expect(r.candidates.slice(0, 2).map((c) => c.id).sort()).toEqual(['b4', 'b5'])
  })
  it('hasData(友だち情報・タグが入っているか)を返す', () => {
    const p = { ...pkg, members: { '4': { created_at: '', memo: null, uid: null, tags: [{ name: 'VIP' }], vars: [] } } }
    const r = matchFriends(p, beyond).review
    expect(r.find((x) => x.lstepId === '4')!.hasData).toBe(true)
    expect(r.find((x) => x.lstepId === '3')!.hasData).toBe(false)
  })
})

describe('matchFriends: 人が決めた対応づけ', () => {
  const { beyond, pkg } = matchFixture()
  it('manualPicks を反映し、要確認から外れる。存在しない beyond の友だちは無視', () => {
    const { results, summary, review } = matchFriends(pkg, beyond, { manualPicks: { '3': 'b3', '4': 'b4', '5': 'b7', '11': 'ghost' } })
    const by = Object.fromEntries(results.map((r) => [r.id, r]))
    expect(by['3']).toMatchObject({ how: 'manual', pick: 'b3', conflict: false })
    expect(by['4']).toMatchObject({ how: 'manual', pick: 'b4', conflict: false })
    expect(by['5']).toMatchObject({ how: 'manual', pick: 'b7' })
    expect(by['11']).toMatchObject({ how: 'none', pick: null })
    expect(summary.manualApplied).toBe(3)
    expect(review.map((r) => r.lstepId)).toEqual(['11'])
  })
})

describe('nameScore', () => {
  it('完全一致 > 部分一致 > 化けた絵文字を飛ばした一致', () => {
    expect(nameScore('さくら', normName('さくら'))).toBe(90)
    expect(nameScore('さくら', normName('さくらんぼ'))).toBe(50)
    expect(nameScore('?さくら?', normName('🌸さくら🌸'))).toBe(40)
    expect(nameScore('??', normName('🌸'))).toBe(0)
    expect(nameScore('あ', normName('あい'))).toBe(0) // 1文字の部分一致は拾わない
  })
})
