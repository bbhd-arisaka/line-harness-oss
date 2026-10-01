import { describe, expect, it } from 'vitest'
import { buildMessages, convertMessage, htmlToText, jst } from './build-messages'
import { matchFriends } from './match'
import { matchFixture } from './testkit'

// 2025-10-28 13:07:04 JST = 2025-10-28 04:07:04 UTC
const TS = Date.UTC(2025, 9, 28, 4, 7, 4) / 1000

describe('jst / htmlToText', () => {
  it('UNIX秒を +09:00 の ISO にする', () => {
    expect(jst(TS)).toBe('2025-10-28T13:07:04.000+09:00')
  })
  it('br・段落を改行に、タグを除き、実体参照を戻し、空行を詰める', () => {
    expect(htmlToText('こんにちは<br>&lt;予約&gt;&nbsp;です</p><p>2行目</p><div>3</div><br><br><br><br>終')).toBe('こんにちは\n<予約> です\n2行目\n3\n\n終')
  })
})

describe('convertMessage', () => {
  const base = { id: 100, timestamp: TS, from: 'me', send_type: 3 }
  it('text: HTML をテキストに', () => {
    expect(convertMessage({ ...base, type: 'text', text: 'こんにちは<br>花子さん' })).toEqual({
      id: '100', direction: 'outgoing', messageType: 'text', content: 'こんにちは\n花子さん', source: 'manual', createdAt: '2025-10-28T13:07:04.000+09:00',
    })
  })
  it('flex: contents を JSON 文字列のまま。contents が無い flex は種類名の目印になる', () => {
    const c = convertMessage({ ...base, type: 'flex', contents: { type: 'bubble', body: { type: 'box' } } })!
    expect(c.messageType).toBe('flex')
    expect(JSON.parse(c.content)).toEqual({ type: 'bubble', body: { type: 'box' } })
    expect(convertMessage({ ...base, type: 'flex' })!).toMatchObject({ messageType: 'text', content: '[flex]' })
  })
  it('carousel: 配列でもオブジェクトでも。タイトル/本文/ボタン名', () => {
    const cols = [{ title: 'メニューA', text: '説明<br>A', actions: [{ label: '予約' }, { label: '詳細' }] }, { text: '説明のみ' }]
    const expected = '[カルーセルメッセージ] 代替テキスト\n【1】メニューA / 説明\nA ▶ 予約 / 詳細\n【2】説明のみ'
    expect(convertMessage({ ...base, type: 'carousel', alt_text: '代替テキスト', columns: cols })!.content).toBe(expected)
    expect(convertMessage({ ...base, type: 'carousel', alt_text: '代替テキスト', columns: { a: cols[0], b: cols[1] } })!.content).toBe(expected)
  })
  it('buttons: タイトル・本文・ボタン名', () => {
    expect(convertMessage({ ...base, type: 'buttons', alt_text: '確認', title: 'ご予約', text: '日時は?', actions: [{ label: 'はい' }, { label: 'いいえ' }] })!.content)
      .toBe('[ボタンメッセージ] 確認\nご予約\n日時は?\n▶ はい / いいえ')
    expect(convertMessage({ ...base, type: 'buttons', text: '本文だけ' })!.content).toBe('[ボタンメッセージ] \n本文だけ')
  })
  it('sticker / image / video / audio / file / location / 未知の種類は目印のテキスト', () => {
    const types: Record<string, number> = {}
    expect(convertMessage({ ...base, type: 'sticker' }, types)!.content).toBe('[スタンプ]')
    expect(convertMessage({ ...base, type: 'image', media: 'https://m.example.test/a.jpg' })!.content).toBe('[画像] https://m.example.test/a.jpg')
    expect(convertMessage({ ...base, type: 'video', media: 'v1' })!.content).toBe('[動画] v1')
    expect(convertMessage({ ...base, type: 'audio' })!.content).toBe('[音声]')
    expect(convertMessage({ ...base, type: 'file', alt_text: 'メニュー.pdf' })!.content).toBe('[ファイル] メニュー.pdf')
    expect(convertMessage({ ...base, type: 'location', alt_text: '店舗', text: '住所<br>1-2-3' })!.content).toBe('[位置情報] 店舗 住所\n1-2-3')
    expect(convertMessage({ ...base, type: 'imagemap' })!.content).toBe('[imagemap]')
    expect(types).toEqual({ sticker: 1 })
  })
  it('system・向き不明・内容が空・日時不正は除く', () => {
    expect(convertMessage({ ...base, type: 'system', text: 'x' })).toBeNull()
    expect(convertMessage({ ...base, from: 'other', type: 'text', text: 'x' })).toBeNull()
    expect(convertMessage({ ...base, type: 'text', text: '<br> ' })).toBeNull()
    expect(convertMessage({ ...base, timestamp: 'x', type: 'text', text: 'あ' })).toBeNull()
  })
  it('source の対応: 受信=user / 0=手動 / 2=一斉配信 / 3=手動 / 10=シナリオ / 不明=手動', () => {
    const src = (o: Record<string, unknown>) => convertMessage({ id: 1, timestamp: TS, type: 'text', text: 'a', ...o })!.source
    expect(src({ from: 'you', send_type: 10 })).toBe('user')
    expect(src({ from: 'me', send_type: 0 })).toBe('manual')
    expect(src({ from: 'me', send_type: 2 })).toBe('broadcast')
    expect(src({ from: 'me', send_type: 3 })).toBe('manual')
    expect(src({ from: 'me', send_type: 10 })).toBe('scenario')
    expect(src({ from: 'me', send_type: 99 })).toBe('manual')
    expect(convertMessage({ id: 1, timestamp: TS, type: 'text', text: 'a', from: 'you' })!.direction).toBe('incoming')
  })
})

describe('buildMessages', () => {
  const { beyond, pkg } = matchFixture()
  const { results } = matchFriends(pkg, beyond)
  const msg = (id: number, ts: number, o: Record<string, unknown> = {}) => ({ id, timestamp: ts, from: 'me', send_type: 2, type: 'text', text: `m${id}`, ...o })

  it('友だちごと・ページごとにまとめ、system除外・重複ID除去・日時順・持ち主なし除外', () => {
    const p = {
      ...pkg,
      messages: {
        '1': [
          { messages: { a: [msg(3, TS + 20), msg(1, TS)], b: [msg(2, TS + 10, { type: 'system' })] } },
          { messages: { a: [msg(1, TS), msg(4, TS + 5, { from: 'you' })] } }, // 1 は別ページに重複
          { err: 500 },
        ],
        '6': [{ messages: { a: [msg(5, TS + 1)] } }], // L6 も b1 に当たる(同じ友だち)
        '4': [{ messages: { a: [msg(9, TS)] } }], // 決まらない友だち
        '2': [{ messages: { a: [msg(10, TS, { type: 'text', text: '' }), msg(11, TS, { timestamp: 'bad' })] } }],
      },
    }
    const { messages, stats } = buildMessages(p, results)
    expect(messages.map((m) => m.id)).toEqual(['1', '5', '4', '3'])
    expect(messages.find((m) => m.id === '4')).toMatchObject({ direction: 'incoming', source: 'user' })
    expect(stats).toMatchObject({ raw: 9, system: 1, noFriend: 1, duplicates: 1, errPages: 1, skippedEmpty: 1, badTime: 1, friends: 1 })
  })

  it('日時が同じメッセージは元の順を保つ', () => {
    const p = { ...pkg, messages: { '1': [{ messages: { a: [msg(7, TS), msg(6, TS), msg(8, TS)] } }] } }
    expect(buildMessages(p, results).messages.map((m) => m.id)).toEqual(['7', '6', '8'])
  })

  it('形が崩れた入力でも落ちない', () => {
    const p = { ...pkg, messages: { '1': [null, { messages: null }, { messages: { a: 'x' } }] as unknown[], '2': 'oops' as unknown as unknown[] } }
    expect(buildMessages(p, results).messages).toEqual([])
  })
})
