import { describe, expect, it } from 'vitest'
import { hasNewIncoming, isNearBottom, mergeFreshChats, upsertChatRow } from './chat-list-merge'

const row = (id: string, at: string | null, dir: string | null = null) => ({ id, lastMessageAt: at, lastMessageDirection: dir })

describe('mergeFreshChats(新着の自動反映)', () => {
  it('取り直した1ページ分は並びも含めて反映し、「さらに読み込む」で出した古い行は残す', () => {
    const prev = [row('a', '2026-10-14T10:00'), row('b', '2026-10-14T09:00'), row('c', '2026-10-14T08:00'), row('d', '2026-10-14T07:00')]
    const fresh = [row('c', '2026-10-14T11:00'), row('a', '2026-10-14T10:00')]
    expect(mergeFreshChats(prev, fresh, 2).map((r) => r.id)).toEqual(['c', 'a', 'b', 'd'])
  })
  it('新着の行が先頭に増えても重複しない', () => {
    const prev = [row('a', '2026-10-14T10:00'), row('b', '2026-10-14T09:00')]
    const fresh = [row('n', '2026-10-14T12:00'), row('a', '2026-10-14T10:00')]
    expect(mergeFreshChats(prev, fresh, 2).map((r) => r.id)).toEqual(['n', 'a', 'b'])
  })
  it('1ページに満たない・未対応のみのときは、取り直した結果が全件', () => {
    const prev = [row('a', '2026-10-14T10:00'), row('b', '2026-10-14T09:00')]
    expect(mergeFreshChats(prev, [row('a', '2026-10-14T10:00')], 5).map((r) => r.id)).toEqual(['a'])
    expect(mergeFreshChats(prev, [row('a', '2026-10-14T10:00')], 1, true).map((r) => r.id)).toEqual(['a'])
  })
})

describe('hasNewIncoming', () => {
  it('お客様からの新しいメッセージがあれば true。スタッフの送信だけなら false', () => {
    const prev = [row('a', '2026-10-14T10:00', 'incoming')]
    expect(hasNewIncoming(prev, [row('a', '2026-10-14T11:00', 'incoming')])).toBe(true)
    expect(hasNewIncoming(prev, [row('a', '2026-10-14T11:00', 'outgoing')])).toBe(false)
    expect(hasNewIncoming(prev, [row('a', '2026-10-14T10:00', 'incoming')])).toBe(false)
    expect(hasNewIncoming(prev, [row('z', '2026-10-14T11:00', 'incoming')])).toBe(true)
  })
})

describe('isNearBottom', () => {
  it('下端から80px以内なら追従してよい', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 450, clientHeight: 500 })).toBe(true)
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 500 })).toBe(false)
  })
})

describe('upsertChatRow(合図が来たトークだけ一覧に反映)', () => {
  const r = (friendId: string, at: string | null) => ({ friendId, lastMessageAt: at })
  it('既存の行は置き換えて、新しい順の位置に動かす', () => {
    const prev = [r('a', '10'), r('b', '09'), r('c', '08')]
    expect(upsertChatRow(prev, r('c', '11')).map((x) => x.friendId)).toEqual(['c', 'a', 'b'])
    expect(upsertChatRow(prev, r('b', '09')).map((x) => x.friendId)).toEqual(['a', 'b', 'c'])
  })
  it('新しいトークは追加する。時刻が無い行は末尾に回る', () => {
    const prev = [r('a', '10'), r('b', '09')]
    expect(upsertChatRow(prev, r('n', '12')).map((x) => x.friendId)).toEqual(['n', 'a', 'b'])
    expect(upsertChatRow(prev, r('z', null)).map((x) => x.friendId)).toEqual(['a', 'b', 'z'])
  })
})
