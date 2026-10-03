import { describe, expect, it } from 'vitest'
import { eventActorSuffix, eventToneClass, mergeTimeline, timelineSignature, type ChatEvent } from './chat-timeline'

const msg = (id: string, createdAt: string) => ({ id, createdAt })
const ev = (id: string, createdAt: string, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  id,
  type: 'tag_added',
  text: 'タグ「SNS流入」を追加しました',
  actor: null,
  createdAt,
  ...extra,
})
const keys = (items: { key: string }[]) => items.map((i) => i.key)

describe('mergeTimeline(メッセージと出来事を時刻順に混ぜる)', () => {
  it('時刻の昇順に混ざる', () => {
    const out = mergeTimeline(
      [msg('m1', '2026-10-03T10:00:00.000+09:00'), msg('m2', '2026-10-03T12:00:00.000+09:00')],
      [ev('e1', '2026-10-03T11:00:00.000+09:00'), ev('e2', '2026-10-03T09:00:00.000+09:00')],
    )
    expect(keys(out)).toEqual(['event-e2', 'm1', 'event-e1', 'm2'])
  })
  it('同時刻ならメッセージが先', () => {
    const t = '2026-10-03T10:00:00.000+09:00'
    expect(keys(mergeTimeline([msg('m1', t)], [ev('e1', t)]))).toEqual(['m1', 'event-e1'])
  })
  it('events が無い(undefined / 空)ときはメッセージだけ', () => {
    const ms = [msg('m1', '2026-10-03T10:00:00+09:00')]
    expect(keys(mergeTimeline(ms, undefined))).toEqual(['m1'])
    expect(keys(mergeTimeline(ms, []))).toEqual(['m1'])
  })
  it('events だけのトークでも出る。どちらも無ければ空', () => {
    expect(keys(mergeTimeline([], [ev('e1', '2026-10-03T10:00:00+09:00')]))).toEqual(['event-e1'])
    expect(mergeTimeline(undefined, undefined)).toEqual([])
  })
  it('タイムゾーン表記が違っても同じ瞬間として比較できる', () => {
    const out = mergeTimeline([msg('m1', '2026-10-03T01:30:00.000Z')], [ev('e1', '2026-10-03T10:00:00.000+09:00')])
    expect(keys(out)).toEqual(['event-e1', 'm1'])
  })
})

describe('出来事の見た目の補助', () => {
  it('種類で色分け・未知の type は既定', () => {
    expect(eventToneClass('blocked')).toContain('red')
    expect(eventToneClass('form_submitted')).toContain('emerald')
    expect(eventToneClass('something_new')).toBe(eventToneClass('tag_added'))
  })
  it('操作した人の付け足し', () => {
    expect(eventActorSuffix('山田')).toBe(' ・ 山田')
    expect(eventActorSuffix(null)).toBe('')
    expect(eventActorSuffix('  ')).toBe('')
  })
  it('署名は events の増減で変わる', () => {
    const m = [{ id: 'a' }]
    expect(timelineSignature(m, undefined)).not.toBe(timelineSignature(m, [{ id: 'e' }]))
  })
})
