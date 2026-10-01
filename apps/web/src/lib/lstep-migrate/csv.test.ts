import { describe, expect, it } from 'vitest'
import { csvById, parseCsv } from './csv'

describe('parseCsv', () => {
  it('引用符・引用符内の改行・""・CRLF を読める', () => {
    const t = 'a,b,c\r\n1,"x,y","line1\nline2"\r\n"he said ""hi""",,last'
    expect(parseCsv(t)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x,y', 'line1\nline2'],
      ['he said "hi"', '', 'last'],
    ])
  })
  it('末尾に改行が無くても最後の行を落とさない / 空文字は空配列', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('')).toEqual([])
  })
})

describe('csvById', () => {
  it('0行目タイトル・1行目見出しで、ID → 見出しごとの値 にする。IDが空の行は捨てる', () => {
    const rows = [['タイトル'], ['ID', '本名', '短い'], ['10', '架空 太郎'], ['', 'IDなし', 'x'], ['11', '架空 花子', 'y']]
    expect(csvById(rows)).toEqual({
      '10': { ID: '10', 本名: '架空 太郎', 短い: '' },
      '11': { ID: '11', 本名: '架空 花子', 短い: 'y' },
    })
  })
  it('見出し行が無ければ空', () => {
    expect(csvById([['タイトル']])).toEqual({})
  })
})
