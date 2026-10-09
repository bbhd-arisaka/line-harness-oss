import { describe, expect, it } from 'vitest'
import { splitTags, variableLabel, variableTone, variableChipClass, variableCode } from './form-tags'

/**
 * 差し込み語の分け方。
 * 間違えると、お客様へ送る文面の一部が枠に飲まれて消える／枠にならず波かっこのまま
 * 見えるので、形ごとに固定する。
 */
describe('splitTags', () => {
  it('ふつうの文字だけなら、そのまま1つ', () => {
    expect(splitTags('こんにちは')).toEqual([{ text: 'こんにちは' }])
  })

  it('名前の差し込みを、前後の文字と分ける', () => {
    expect(splitTags('{{name}}さん、こんにちは')).toEqual([{ variable: 'name' }, { text: 'さん、こんにちは' }])
  })

  it('フォームのタグと差し込み語が混ざっても、順番どおりに分ける', () => {
    expect(splitTags('{{name}}様 {{form_url:abc-1}} へ')).toEqual([
      { variable: 'name' },
      { text: '様 ' },
      { formId: 'abc-1' },
      { text: ' へ' },
    ])
  })

  it('友だち情報・予約の語も拾う', () => {
    expect(splitTags('{{metadata.honmei}}/{{reserve.before.datetime}}')).toEqual([
      { variable: 'metadata.honmei' },
      { text: '/' },
      { variable: 'reserve.before.datetime' },
    ])
  })

  it('知らない語は、文字のまま残す（勝手に枠にしない）', () => {
    expect(splitTags('{{unknown}}です')).toEqual([{ text: '{{unknown}}です' }])
  })

  it('同じ語が続いても、全部分ける', () => {
    expect(splitTags('{{liff_id}}{{liff_id}}')).toEqual([{ variable: 'liff_id' }, { variable: 'liff_id' }])
  })

  it('枠に直して戻すと、元の文字列と一致する', () => {
    const src = 'A{{name}}B{{form_url:x}}C{{reserve.url}}D'
    const back = splitTags(src)
      .map((p) => ('text' in p ? p.text : 'formId' in p ? `{{form_url:${p.formId}}}` : variableCode(p.variable)))
      .join('')
    expect(back).toBe(src)
  })
})

describe('variableLabel', () => {
  it('よく使う語は日本語名にする', () => {
    expect(variableLabel('name')).toBe('名前')
    expect(variableLabel('reserve.datetime')).toBe('予約日時')
  })

  it('友だち情報欄は名前を出し、読めなければキーを出す', () => {
    expect(variableLabel('metadata.honmei', new Map([['honmei', '本名']]))).toBe('友だち情報：本名')
    expect(variableLabel('metadata.honmei')).toBe('友だち情報：honmei')
  })

  it('知らない語はキーのまま', () => {
    expect(variableLabel('x.y')).toBe('x.y')
  })
})

describe('variableTone / variableChipClass', () => {
  it('種類ごとに色の系統を分ける', () => {
    expect(variableTone('name')).toBe('name')
    expect(variableTone('uid')).toBe('id')
    expect(variableTone('metadata.a')).toBe('info')
    expect(variableTone('reserve.url')).toBe('reserve')
    expect(variableTone('form')).toBe('other')
    expect(variableChipClass('name')).toContain('sky')
  })
})
