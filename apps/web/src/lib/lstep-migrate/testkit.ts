/** テスト用の合成データ(架空の名前・識別子のみ。本物の個人情報は使わない) */
import type { BeyondFriend, LstepMember, LstepPackage } from './types'

export const CSV_HEAD = ['ID', '表示名', 'LINE登録名', '本名', 'システム表示名', 'ステータスメッセージ', '個別メモ', '友だち追加日時', '対応マーク', '表示状態', 'ユーザーブロック']

export function csvRow(id: string, line: string, o: { real?: string; sys?: string; added?: string; blocked?: string } = {}): string[] {
  return [id, line, line, o.real ?? '', o.sys ?? '', '', '', o.added ?? '2025/9/30 14:40:17', '', '', o.blocked ?? '0']
}

/** beyond 側の画像URL */
export const bpic = (tok: string) => `https://profile.example.test/${tok}`
/** Lステップ一覧側の画像URL */
export const lpic = (tok: string) => `https://obs.example.test/face/v2/${tok}/preview`

export function bf(id: string, name: string | null, tok: string | null, isFollowing = true): BeyondFriend {
  return { id, displayName: name, pictureUrl: tok ? bpic(tok) : null, isFollowing }
}

export function emptyPkg(over: Partial<LstepPackage> = {}): LstepPackage {
  return {
    version: 1, collectedAt: '2026-10-01T00:00:00.000Z', lstepHost: 'manager.linestep.net', accountName: 'テスト店',
    list: {}, members: {}, csvRows: [['タイトル'], CSV_HEAD], fieldDefs: [], tagDefs: [], forms: [], messages: {}, warnings: [],
    ...over,
  }
}

export const member = (over: Partial<LstepMember> = {}): LstepMember => ({ created_at: '', memo: null, tags: [], uid: null, vars: [], ...over })

/** 突き合わせ用の合成データ(全分類を1つずつ含む) */
export function matchFixture() {
  const beyond: BeyondFriend[] = [
    bf('b1', '山田花子', '0hABCDefghij'),
    bf('b2', '佐藤', '0mQWERTYUIOPASDFxyz'),
    bf('b3', '🌸さくら🌸', null),
    bf('b4', '鈴木', null),
    bf('b5', '鈴木', null),
    bf('b7', '田中', null),
    bf('b8', 'ほかの人', '0hEEEEeeee'),
    bf('b9', '別表示', '0hFFFFffff'),
    bf('b10', 'ユニーク', null),
    bf('b12', 'ユニーク2', '0hZZZZzzzz'),
    bf('b13', '誰か', '0hZZZZyyyy'),
  ]
  const rows = [
    csvRow('1', '山田花子', { real: '(テスト店)山田 花子' }),          // pic+name (0h: 後ろ4文字)
    csvRow('2', '佐藤'),                                              // pic+name (0m: 先頭14文字)
    csvRow('3', '?さくら?'),                                          // 絵文字が化けた: 決まらない
    csvRow('4', '鈴木'),                                              // name:multi
    csvRow('5', '田中'),                                              // pic≠name
    csvRow('6', '山田花子', { blocked: '1' }),                        // L1 と同じ beyond(ブロック済み・一覧に無い)
    csvRow('7', 'Unknown'),                                           // pic(name:none)
    csvRow('8', '鈴木'),                                              // pic(name:other)
    csvRow('9', 'ユニーク'),                                          // name
    csvRow('10', 'ユニーク2'),                                        // name(pic:multi)
    csvRow('11', '誰にも似ていない'),                                 // none
    csvRow('12', '消えた人', { blocked: '1' }),                       // ブロック済みで決まらない
  ]
  const list: LstepPackage['list'] = {
    '1': { name: '山田花子', pic: lpic('0hABCDzzzz'), row: '' },
    '2': { name: '佐藤', pic: lpic('0mQWERTYUIOPASxxxxx'), row: '' },
    '3': { name: '🌸さくら🌸', pic: null, row: '' },
    '4': { name: '鈴木', pic: null, row: '' },
    '5': { name: '田中', pic: lpic('0hEEEEqqqq'), row: '' },
    '7': { name: 'Unknown', pic: lpic('0hFFFFaaaa'), row: '' },
    '8': { name: '鈴木', pic: lpic('0hFFFFbbbb'), row: '' },
    '9': { name: 'ユニーク', pic: null, row: '' },
    '10': { name: 'ユニーク2', pic: lpic('0hZZZZcccc'), row: '' },
    '11': { name: '誰にも似ていない', pic: null, row: '' },
  }
  // 6 は一覧に出ない(ブロック済み)が、画像は山田花子と同じ
  const csvRows = [['タイトル'], CSV_HEAD, ...rows]
  return { beyond, pkg: emptyPkg({ csvRows, list }) }
}
