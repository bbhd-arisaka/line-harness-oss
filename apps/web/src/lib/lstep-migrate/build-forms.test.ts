import { describe, expect, it } from 'vitest'
import { buildFormsDataset, findBeyondForm, mapColumns, parseFormFields } from './build-forms'
import { matchFriends } from './match'
import { matchFixture } from './testkit'
import type { BeyondForm, BeyondFormField, LstepPackage } from './types'

const FIELDS: BeyondFormField[] = [
  { name: 'intro', type: 'heading', label: 'ご記入ください' },
  { name: 'name', type: 'text', label: 'お名前' },
  { name: 'q1', type: 'radio', label: '1.経験', options: ['はい', 'いいえ'] },
  { name: 'q1_detail', type: 'textarea', label: '追加質問' },
  { name: 'hobby', type: 'checkbox', label: '趣味', options: ['読書', 'ゲーム'] },
  { name: 'div', type: 'divider' },
  { name: 'agree', type: 'checkbox', label: '同意文(長い文章がここに入る)', options: ['同意する'] },
]
const HEAD = ['回答ID', '回答日時', '回答者ID', '回答者名', 'お名前', '1.経験', '1.経験', '趣味', '趣味(記述)', '同意', 'その他の回答', '謎の列']
const answerable = FIELDS.filter((f) => !['heading', 'divider'].includes(f.type))

const bform = (id: string, name: string, fields: BeyondFormField[] = FIELDS): BeyondForm => ({ id, name, fields: JSON.stringify(fields) })

describe('mapColumns: 列と質問の割り当て(各 kind)', () => {
  const { colMap, unusedFields } = mapColumns(HEAD, answerable)
  const k = (i: number) => colMap[i - 4]
  it('ラベル一致 → field', () => {
    expect(k(4)).toMatchObject({ kind: 'field', fieldName: 'name' })
    expect(k(5)).toMatchObject({ kind: 'field', fieldName: 'q1' })
    expect(k(7)).toMatchObject({ kind: 'field', fieldName: 'hobby' })
  })
  it('同じ見出しの2回目は、見出しに無い「追加質問」へ(field)', () => {
    expect(k(6)).toMatchObject({ kind: 'field', fieldName: 'q1_detail' })
  })
  it('「(記述)」は直前の質問の other', () => {
    expect(k(8)).toMatchObject({ kind: 'other', fieldName: 'hobby' })
  })
  it('見出しと違うラベルの質問は位置で対応(positional)', () => {
    expect(k(9)).toMatchObject({ kind: 'positional', fieldName: 'agree' })
  })
  it('「その他の回答」は catchall、質問が尽きた後の列は unmapped', () => {
    expect(k(10)).toMatchObject({ kind: 'catchall', fieldName: null })
    expect(k(11)).toMatchObject({ kind: 'unmapped', fieldName: null })
    expect(unusedFields).toEqual([])
  })
  it('全角半角・括弧・空白の違いはラベル一致とみなす', () => {
    const r = mapColumns(['a', 'b', 'c', 'd', 'お 名前(漢字)'], [{ name: 'n', type: 'text', label: 'お名前（漢字）' }])
    expect(r.colMap[0]).toMatchObject({ kind: 'field', fieldName: 'n' })
  })
  it('使われなかった質問を返す', () => {
    const r = mapColumns(['a', 'b', 'c', 'd', 'お名前'], [{ name: 'n', type: 'text', label: 'お名前' }, { name: 'z', type: 'text', label: '未使用' }])
    expect(r.unusedFields).toEqual(['z'])
  })
})

describe('findBeyondForm: 名前での探し方', () => {
  const forms = [bform('f1', 'アイブロウカウンセリング'), bform('f2', 'ラッシュリフト 初回'), bform('f3', 'セットメニュー'), bform('f4', 'セットメニュー(新)')]
  it('完全一致', () => {
    expect(findBeyondForm('セットメニュー', forms)).toMatchObject({ how: 'exact', form: { id: 'f3' } })
  })
  it('正規化一致(全角半角・空白・括弧)', () => {
    expect(findBeyondForm('ラッシュリフト　初回', forms)).toMatchObject({ how: 'normalized', form: { id: 'f2' } })
    expect(findBeyondForm('セットメニュー（新）', forms)).toMatchObject({ how: 'normalized', form: { id: 'f4' } })
  })
  it('前方一致(Lステップ側が短い / 長い どちらでも)', () => {
    expect(findBeyondForm('アイブロウ', forms)).toMatchObject({ how: 'prefix', form: { id: 'f1' } })
    expect(findBeyondForm('ラッシュリフト 初回アンケート', forms)).toMatchObject({ how: 'prefix', form: { id: 'f2' } })
  })
  it('部分一致', () => {
    expect(findBeyondForm('カウンセリング', forms)).toMatchObject({ how: 'partial', form: { id: 'f1' } })
  })
  it('複数に当たるときは決めない(候補つき)・無ければ none', () => {
    const r = findBeyondForm('セット', forms)
    expect(r.form).toBeNull()
    expect(r.how).toBe('ambiguous')
    expect(r.ambiguous.map((f) => f.id)).toEqual(['f3', 'f4'])
    expect(findBeyondForm('全く違う', forms)).toMatchObject({ form: null, how: 'none' })
    expect(findBeyondForm('あ', forms).form).toBeNull() // 1文字では部分一致しない
  })
})

describe('parseFormFields', () => {
  it('JSON文字列でもパース済みでも。壊れていれば空', () => {
    expect(parseFormFields(bform('x', 'x'))).toHaveLength(FIELDS.length)
    expect(parseFormFields({ id: 'x', name: 'x', fields: FIELDS })).toHaveLength(FIELDS.length)
    expect(parseFormFields({ id: 'x', name: 'x', fields: '{broken' })).toEqual([])
    expect(parseFormFields({ id: 'x', name: 'x', fields: '{}' })).toEqual([])
  })
})

function pkgWithForms(forms: LstepPackage['forms']) {
  const { beyond, pkg } = matchFixture()
  const p: LstepPackage = { ...pkg, forms }
  const { results } = matchFriends(p, beyond)
  return { p, results }
}

describe('buildFormsDataset', () => {
  const rows = [
    HEAD,
    ['A100', '2025-10-28 13:07:04', '1', '山田 花子', '山田 花', 'はい', '具体的には…', '読書\nゲーム', 'その他の趣味', '同意する', '他の回答テキスト', '謎値'],
    ['A101', '2025/10/29 9:05', '999', '知らない人', 'X', 'いいえ', '', '', '', '', '', ''],
    ['', '', '', '', '(IDなしの行は捨てる)'],
  ]
  const { p, results } = pkgWithForms([{ lid: '944452', name: 'ラッシュ', folder: null, csvRows: rows }])
  const forms = [bform('bf1', 'ラッシュリフト 初回'), bform('bf2', 'アイブロウ')]
  const out = buildFormsDataset(p, results, forms, { accountId: 'acc', accountName: '店', builtAt: '2026-10-01T00:00:00.000Z' })

  it('名前で対応づけ、隠し項目(lstep_extra_N)だけを configs に入れる(代入先は書き換えない)', () => {
    expect(out.configs).toEqual([{
      formId: 'bf1', formName: 'ラッシュリフト 初回', saveToMetadata: false, fields: {},
      addFields: [{ name: 'lstep_extra_7', label: '謎の列(Lステップの追加項目)', type: 'text', hidden: true }],
    }])
    expect(out.forms[0]).toMatchObject({ status: 'mapped', how: 'prefix', beyondFormId: 'bf1', answers: 2, answersWithoutFriend: 1, unmappedColumns: ['謎の列'] })
  })
  it('回答: 列を質問に入れ、checkbox は改行で配列、「記述」は「見出し: 内容」で足す、その他の回答は _lstep に', () => {
    const [a] = out.submissions
    expect(a).toMatchObject({ formId: 'bf1', beyondFriendId: 'b1', createdAt: '2025-10-28T13:07:04.000+09:00' })
    expect(a.data).toEqual({
      name: '山田 花', q1: 'はい', q1_detail: '具体的には…',
      hobby: ['読書', 'ゲーム', '趣味: その他の趣味'],
      agree: ['同意する'] as unknown, lstep_extra_7: '謎値',
      _lstep: { key: 'lstep:944452:A100', answerId: 'A100', respondentId: '1', respondentName: '山田 花子', otherAnswers: '他の回答テキスト' },
    })
  })
  it('友だちが決まらない回答は持ち主なし(null)。日時はゼロ埋め。空欄の列は入れない', () => {
    const b = out.submissions[1]
    expect(b.beyondFriendId).toBeNull()
    expect(b.createdAt).toBe('2025-10-29T09:05:00.000+09:00')
    expect(b.data).toEqual({ name: 'X', q1: 'いいえ', _lstep: { key: 'lstep:944452:A101', answerId: 'A101', respondentId: '999', respondentName: '知らない人' } })
    expect(out.submissions).toHaveLength(2)
  })
  it('取り込み用データの外枠', () => {
    expect(out.dataset).toMatchObject({ version: 1, source: 'lstep', accountId: 'acc', accountName: '店', friends: [], forms: { configs: out.configs, submissions: out.submissions } })
  })

  it('beyond に無いフォームは未対応としてレポート(候補つき)。回答は作らない', () => {
    const { p: p2, results: r2 } = pkgWithForms([
      { lid: '1', name: 'アイブロウ(旧)アンケート', folder: null, csvRows: rows },
      { lid: '2', name: '全く別', folder: null, csvRows: rows },
    ])
    const o = buildFormsDataset(p2, r2, [bform('bf2', 'アイブロウ'), bform('bf3', 'ほかのフォーム')])
    expect(o.forms.map((f) => f.status)).toEqual(['mapped', 'unmatched'])
    expect(o.unmatchedForms.map((f) => f.lid)).toEqual(['2'])
    expect(o.unmatchedForms[0].candidates).toEqual([])
    expect(o.submissions.every((s) => s.formId === 'bf2')).toBe(true)
  })
  it('決まらないフォームの候補は名前の近い順。人が選ぶ(formPicks)と反映される', () => {
    const { p: p2, results: r2 } = pkgWithForms([{ lid: '9', name: 'セット', folder: null, csvRows: rows }])
    const cands = [bform('c1', 'セットメニュー'), bform('c2', 'セットメニュー(新)'), bform('c3', '無関係')]
    const o = buildFormsDataset(p2, r2, cands)
    expect(o.unmatchedForms[0]).toMatchObject({ how: 'ambiguous' })
    expect(o.unmatchedForms[0].candidates.map((c) => c.id)).toEqual(['c1', 'c2'])
    const o2 = buildFormsDataset(p2, r2, cands, { formPicks: { '9': 'c2' } })
    expect(o2.unmatchedForms).toEqual([])
    expect(o2.forms[0]).toMatchObject({ status: 'mapped', how: 'manual', beyondFormId: 'c2' })
    expect(o2.submissions.every((s) => s.formId === 'c2')).toBe(true)
  })
  it('同じ beyond のフォームに2つのフォームが対応しても、隠し項目の名前はぶつからず config は1つ', () => {
    const { p: p2, results: r2 } = pkgWithForms([
      { lid: '11', name: 'ラッシュリフト 初回', folder: null, csvRows: rows },
      { lid: '12', name: 'ラッシュリフト 初回', folder: null, csvRows: rows },
    ])
    const o = buildFormsDataset(p2, r2, [bform('bf1', 'ラッシュリフト 初回')])
    expect(o.configs).toHaveLength(1)
    expect(o.configs[0].addFields!.map((f) => f.name)).toEqual(['lstep_extra_7', 'lstep_extra_12_7'])
    expect(o.submissions.filter((s) => s.data._lstep.key.startsWith('lstep:12:')).every((s) => 'lstep_extra_12_7' in s.data || s.data._lstep.answerId === 'A101')).toBe(true)
  })
  it('日時が読めない回答は除いて警告。空のCSVも警告', () => {
    const bad = [HEAD, ['B1', '昨日', '1', '山田', 'x', 'はい', '', '', '', '', '', '']]
    const { p: p2, results: r2 } = pkgWithForms([
      { lid: '21', name: 'ラッシュリフト 初回', folder: null, csvRows: bad },
      { lid: '22', name: 'アイブロウ', folder: null, csvRows: [] },
    ])
    const o = buildFormsDataset(p2, r2, forms)
    expect(o.submissions).toEqual([])
    expect(o.warnings.length).toBe(2)
    expect(o.forms[1].status).toBe('empty')
  })
  it('どの列とも対応しなかった質問を返す', () => {
    const short = [['回答ID', '回答日時', '回答者ID', '回答者名', 'お名前'], ['C1', '2025-10-28 13:07:04', '1', '山田', '花']]
    const { p: p2, results: r2 } = pkgWithForms([{ lid: '31', name: 'ラッシュリフト 初回', folder: null, csvRows: short }])
    const o = buildFormsDataset(p2, r2, forms)
    expect(o.forms[0].neverFilledFields).toEqual(['q1', 'q1_detail', 'hobby', 'agree'])
  })
})
