import { describe, expect, it } from 'vitest'
import { buildAll } from './index'
import { matchFixture, member } from './testkit'
import type { BeyondForm, LstepPackage } from './types'

const TS = Date.UTC(2025, 9, 28, 4, 7, 4) / 1000

function setup() {
  const { beyond, pkg } = matchFixture()
  const head = ['回答ID', '回答日時', '回答者ID', '回答者名', 'お名前', '備考']
  const full: LstepPackage = {
    ...pkg,
    warnings: ['収集中の警告'],
    fieldDefs: [{ folder: '基本情報', gid: '10', rows: ['drag_indicator お名前 標準 - 3人'] }],
    tagDefs: [{ folder: '区分', gid: '20', rows: ['drag_indicator 新規 3人 2025/9/1 10:00'] }],
    members: {
      '1': member({ tags: [{ name: '新規' }], vars: [{ id: 1, name: 'お名前', value: '山田', group: 10, type: 1 }] }),
      '4': member({ tags: [{ name: '新規' }] }),
    },
    forms: [
      { lid: '100', name: 'カウンセリング', folder: null, csvRows: [head, ['A1', '2025-10-28 13:07:04', '1', '山田', '山田', 'なし'], ['A2', '2025-10-28 13:08:04', '4', '鈴木', '鈴木', 'なし']] },
      { lid: '200', name: '存在しないフォーム', folder: null, csvRows: [head] },
    ],
    messages: {
      '1': [{ messages: { a: [{ id: 1, timestamp: TS, from: 'me', send_type: 2, type: 'text', text: 'こんにちは' }, { id: 2, timestamp: TS + 1, from: 'you', type: 'sticker' }] } }],
      '4': [{ messages: { a: [{ id: 3, timestamp: TS, from: 'you', type: 'text', text: '保留の人' }] } }],
    },
  }
  const forms: BeyondForm[] = [{ id: 'bf1', name: 'カウンセリング', fields: [{ name: 'name', type: 'text', label: 'お名前' }, { name: 'note', type: 'text', label: '備考' }] }]
  return { full, ctx: { friends: beyond, forms, accountId: 'acc-1', accountName: 'テスト店' } }
}

describe('buildAll', () => {
  const { full, ctx } = setup()
  const r = buildAll(full, ctx, {}, { builtAt: '2026-10-01T00:00:00.000Z' })

  it('要約: 人数・件数・要確認', () => {
    expect(r.summary.friends).toMatchObject({
      lstepTotal: 12, matched: 7, importable: 5, duplicates: 2, manualApplied: 0, needsReview: 4, needsReviewWithData: 1, blockedUnmatched: 1, withTags: 1, withValues: 1,
    })
    expect(r.summary.definitions).toEqual({ folders: 1, fields: 1, tags: 1 })
    expect(r.summary.forms).toMatchObject({ lstepForms: 2, mapped: 1, unmatched: 1, answers: 2, answersWithFriend: 1, answersWithoutFriend: 1, hiddenFieldsAdded: 0 })
    expect(r.summary.messages).toEqual({ total: 2, friends: 1 })
    expect(r.summary.warnings).toEqual(['収集中の警告'])
  })
  it('要確認リストと未対応フォームを返す', () => {
    expect(r.review.map((x) => x.lstepId).sort()).toEqual(['11', '3', '4', '5'])
    expect(r.unmatchedForms.map((f) => f.lid)).toEqual(['200'])
  })
  it('人の決定(manualPicks / formPicks)を渡すと反映され、データが増える', () => {
    const r2 = buildAll(full, ctx, { manualPicks: { '4': 'b4' }, formPicks: { '200': 'bf1' } }, { builtAt: 'x' })
    expect(r2.summary.friends).toMatchObject({ matched: 8, importable: 6, manualApplied: 1, needsReview: 3, withTags: 2 })
    expect(r2.summary.forms).toMatchObject({ mapped: 2, unmatched: 0, answersWithFriend: 2 })
    expect(r2.summary.messages.total).toBe(3)
  })
  it('取り込みファイル3種(友だち・フォーム・トーク)が、取り込みAPIの検証と同じ形になる', () => {
    const { friends, forms, messages } = r.datasets
    for (const d of [friends, forms, messages]) {
      expect(d).toMatchObject({ version: 1, source: 'lstep', accountId: 'acc-1', accountName: 'テスト店', builtAt: '2026-10-01T00:00:00.000Z' })
    }
    const keys = new Set(friends.fields.map((f) => f.key))
    for (const f of friends.friends) {
      expect(f.beyondFriendId).toBeTruthy()
      if (f.addedAt) expect(f.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
      for (const k of Object.keys(f.values)) expect(keys.has(k)).toBe(true)
    }
    for (const f of friends.fields) expect(f.key).toMatch(/^[A-Za-z0-9_]+$/)
    for (const s of forms.forms!.submissions) {
      expect(s.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/)
      expect(s.data._lstep.key).toMatch(/^lstep:\d+:/)
    }
    for (const m of messages.messages!) {
      expect(m.id).toMatch(/^\d{1,20}$/)
      expect(['text', 'flex']).toContain(m.messageType)
      expect(m.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/)
    }
    expect(messages.messages!.map((m) => m.content)).toEqual(['こんにちは', '[スタンプ]'])
  })
  it('JSON にして戻せる(画面でファイル化・保存できる)', () => {
    const back = JSON.parse(JSON.stringify(r.datasets))
    expect(back.friends.friends).toHaveLength(5)
  })
})
