import { describe, expect, it } from 'vitest'
import { buildFriendsDataset, fieldKeyOf, stripHtml } from './build-friends'
import { matchFriends } from './match'
import { matchFixture, member } from './testkit'
import type { LstepPackage } from './types'

function fixture() {
  const { beyond, pkg } = matchFixture()
  const full: LstepPackage = {
    ...pkg,
    fieldDefs: [
      { folder: '基本情報', gid: '10', rows: [
        'drag_indicator お名前 標準 - 85人 star more_vert',
        'drag_indicator 電話番号 標準 - 3人',
        'drag_indicator 来店理由 settings 選択肢 - 57人 star',
        'drag_indicator 壊れた行',
      ] },
      { folder: '⭐️メモ', gid: '11', rows: ['drag_indicator 備考 長文 初期値 2人'] },
    ],
    tagDefs: [{ folder: '区分', gid: '20', rows: [
      'drag_indicator 新規 12人 2025/9/1 10:00',
      'drag_indicator VIP 【追加時】テンプレ送信 3人 2025/9/2 11:00',
    ] }],
    members: {
      '1': member({
        tags: [{ name: '新規' }, { name: '新規' }, { name: 'VIP' }],
        vars: [
          { id: 1, name: 'お名前', value: '山田 花', group: 10, type: 1 },
          { id: 2, name: '電話番号', value: '090-0000-0000', group: 10, type: 1 },
          { id: 3, name: '来店理由', value: 'x', encoded_choice_label: '<b>紹介&amp;口コミ</b>', group: 10, type: 2 },
          { id: 4, name: '備考', value: '', group: 11, type: 1 },
          { id: 5, name: '未定義の項目', value: 'z', group: 99, type: 1 },
        ],
      }),
      '6': member({ vars: [{ id: 1, name: 'お名前', value: '古い人', group: 10, type: 1 }], tags: [{ name: '旧' }] }),
      '4': member({ tags: [{ name: 'VIP' }] }),
    },
  }
  // L1 の CSV 行に本名・システム表示名を入れる
  full.csvRows = full.csvRows.map((r) => (r[0] === '1' ? [...r.slice(0, 3), '(テスト店)山田 花子', 'システム名', ...r.slice(5)] : r))
  const { results } = matchFriends(full, beyond)
  return { full, results }
}

describe('fieldKeyOf', () => {
  it('電話番号・住所は既存キー、それ以外は ls_ + SHA-1(フォルダ/名前) の先頭8桁(過去の取り込みと同じ)', () => {
    expect(fieldKeyOf('基本情報', '電話番号')).toBe('phone')
    expect(fieldKeyOf('基本情報', '住所')).toBe('address')
    expect(fieldKeyOf('基本情報', 'お名前')).toBe('ls_3c1aaa8c')
    expect(fieldKeyOf('constructor', 'toString')).toMatch(/^ls_[0-9a-f]{8}$/)
  })
})

describe('stripHtml', () => {
  it('タグを除き、主な実体参照を戻す', () => {
    expect(stripHtml('<b>A&amp;B</b> &lt;x&gt; &quot;q&quot; &#39;s ')).toBe('A&B <x> "q" \'s')
    expect(stripHtml(null)).toBe('')
  })
})

describe('buildFriendsDataset: 定義', () => {
  const { full, results } = fixture()
  const { dataset, report } = buildFriendsDataset(full, results, 'acc-1', 'テスト店', { builtAt: '2026-10-01T00:00:00.000Z' })

  it('外枠', () => {
    expect(dataset).toMatchObject({ version: 1, source: 'lstep', accountId: 'acc-1', accountName: 'テスト店', builtAt: '2026-10-01T00:00:00.000Z' })
  })
  it('フォルダは順番つき、項目の種別・既定値・キーを読む', () => {
    expect(dataset.folders).toEqual([{ name: '基本情報', order: 0 }, { name: '⭐️メモ', order: 1 }])
    const f = Object.fromEntries(dataset.fields.map((x) => [x.label, x]))
    expect(Object.keys(f)).toEqual(['お名前', '電話番号', '来店理由', '備考'])
    expect(f['お名前']).toMatchObject({ key: 'ls_3c1aaa8c', type: 'text', folder: '基本情報', order: 0, defaultValue: null, lstepType: '標準' })
    expect(f['電話番号'].key).toBe('phone')
    expect(f['来店理由']).toMatchObject({ type: 'select', options: ['紹介&口コミ'] })
    expect(f['備考']).toMatchObject({ type: 'textarea', folder: '⭐️メモ', defaultValue: '初期値', order: 0 })
  })
  it('読めない行は警告にする', () => {
    expect(report.warnings.some((w) => w.includes('壊れた行'))).toBe(true)
  })
  it('タグ名は「…人」「【追加時】」の前まで', () => {
    expect(dataset.tags).toEqual([{ name: '新規', folder: '区分' }, { name: 'VIP', folder: '区分' }])
  })
})

describe('buildFriendsDataset: 友だち', () => {
  const { full, results } = fixture()
  const { dataset, report } = buildFriendsDataset(full, results, 'acc-1', 'テスト店')
  const byId = Object.fromEntries(dataset.friends.map((f) => [f.beyondFriendId, f]))

  it('beyond の友だち単位に1人ずつ(決まらない人は出ない)', () => {
    expect(Object.keys(byId).sort()).toEqual(['b1', 'b10', 'b12', 'b2', 'b9'])
  })
  it('本名・システム表示名・追加日時(ゼロ埋め)・タグ(重複なし)・値', () => {
    expect(byId['b1']).toMatchObject({
      lstepId: '1', how: 'pic+name', realName: '(テスト店)山田 花子', systemDisplayName: 'システム名', addedAt: '2025-09-30T14:40:17',
      tags: ['新規', 'VIP'],
      values: { ls_3c1aaa8c: '山田 花', phone: '090-0000-0000', [fieldKeyOf('基本情報', '来店理由')]: '紹介&口コミ' },
    })
    expect(byId['b2'].realName).toBeNull()
    expect(byId['b2'].tags).toEqual([])
    expect(byId['b2'].values).toEqual({})
  })
  it('定義に無い項目の値・空の値は入れない', () => {
    expect(Object.keys(byId['b1'].values)).toHaveLength(3)
  })
  it('重複(再追加など)は有効なほうを採用し、レポートに出す', () => {
    expect(report.duplicates).toContainEqual({ beyondId: 'b1', chosen: '1', others: ['6'], names: ['山田花子', '山田花子'] })
    expect(byId['b1'].tags).not.toContain('旧')
  })
  it('決まらなかった人のレポート(ブロック済み・データ有無つき)', () => {
    const u = Object.fromEntries(report.unmatched.map((x) => [x.lstepId, x]))
    expect(Object.keys(u).sort()).toEqual(['11', '12', '3', '4', '5'])
    expect(u['4']).toMatchObject({ why: 'name:multi', hasData: true, blocked: false })
    expect(u['12']).toMatchObject({ blocked: true, why: 'none', hasData: false })
    expect(u['5'].why).toBe('pic≠name')
  })
})
