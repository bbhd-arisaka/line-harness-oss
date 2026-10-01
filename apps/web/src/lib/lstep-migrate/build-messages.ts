/**
 * トーク履歴を、beyond line に取り込める形にする(messages-build.cjs の移植)。
 * system は除外 / HTMLはテキストへ / 同じメッセージIDは1回だけ / 日時はJST。
 */
import { beyondOf, type MatchResult } from './match'
import type { DatasetEnvelope, DatasetMessage, LstepPackage } from './types'

// Lステップの生メッセージは形が一定でないので、ここだけ緩く扱う
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
export const htmlToText = (h: unknown): string =>
  decode(String(h).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/\n{3,}/g, '\n\n').trim()

const SOURCE: Record<number, DatasetMessage['source']> = { 0: 'user', 2: 'broadcast', 3: 'manual', 10: 'scenario' }
export const jst = (ts: number): string => new Date((ts + 9 * 3600) * 1000).toISOString().replace('Z', '+09:00')

const MEDIA_LABEL: Record<string, string> = { sticker: 'スタンプ', image: '画像', video: '動画', audio: '音声', file: 'ファイル', location: '位置情報' }

export interface MessageStats {
  friends: number
  raw: number
  system: number
  noFriend: number
  skippedEmpty: number
  badTime: number
  errPages: number
  duplicates: number
  /** 画像・スタンプなど、テキストの目印に置き換えた種類と件数 */
  placeholderTypes: Record<string, number>
}

/** 1件を取り込み用に変換。system・内容が空・向きが不明なものは null。 */
export function convertMessage(m: Raw, unknownTypes?: Record<string, number>): Omit<DatasetMessage, 'beyondFriendId'> | null {
  const direction = m.from === 'me' ? 'outgoing' : m.from === 'you' ? 'incoming' : null
  if (!direction || m.type === 'system') return null
  const sendType = SOURCE[m.send_type as number]
  const source: DatasetMessage['source'] = direction === 'incoming' ? 'user' : sendType === 'user' ? 'manual' : sendType || 'manual'
  let messageType: DatasetMessage['messageType'] = 'text'
  let content = ''
  if (m.type === 'text') content = htmlToText(m.text ?? '')
  else if (m.type === 'flex' && m.contents && typeof m.contents === 'object') { messageType = 'flex'; content = JSON.stringify(m.contents) }
  else if (m.type === 'carousel') {
    const cols: Raw[] = Array.isArray(m.columns) ? m.columns : Object.values(m.columns || {})
    content = `[カルーセルメッセージ] ${m.alt_text ?? ''}\n` + cols.map((c, i) => {
      const labels = ((c.actions || []) as Raw[]).map((a) => a.label).filter(Boolean)
      return `【${i + 1}】${[c.title, c.text].filter(Boolean).map(htmlToText).join(' / ')}${labels.length ? ' ▶ ' + labels.join(' / ') : ''}`
    }).join('\n')
  } else if (m.type === 'buttons') {
    content = `[ボタンメッセージ] ${m.alt_text ?? ''}\n${[m.title, m.text].filter(Boolean).map(htmlToText).join('\n')}${(m.actions || []).length ? '\n▶ ' + (m.actions as Raw[]).map((a) => a.label).filter(Boolean).join(' / ') : ''}`
  } else {
    if (unknownTypes) unknownTypes[m.type] = (unknownTypes[m.type] || 0) + 1
    content = `[${MEDIA_LABEL[m.type] || m.type}]${m.media ? ' ' + m.media : ''}${m.alt_text ? ' ' + m.alt_text : ''}${m.text ? ' ' + htmlToText(m.text) : ''}`
  }
  content = content.trim()
  if (!content) return null
  const ts = Number(m.timestamp)
  if (!Number.isFinite(ts)) return null
  return { id: String(m.id), direction, messageType, content, source, createdAt: jst(ts) }
}

export function buildMessages(pkg: LstepPackage, matches: MatchResult[]): { messages: DatasetMessage[]; stats: MessageStats } {
  const owner = beyondOf(matches)
  const stats: MessageStats = { friends: 0, raw: 0, system: 0, noFriend: 0, skippedEmpty: 0, badTime: 0, errPages: 0, duplicates: 0, placeholderTypes: {} }
  const messages: DatasetMessage[] = []
  const seen = new Set<string>()
  for (const [lid, pages] of Object.entries(pkg.messages || {})) {
    const beyondId = owner.get(lid)
    for (const p of (Array.isArray(pages) ? pages : []) as Raw[]) {
      if (!p || p.err) { stats.errPages++; continue }
      for (const arr of Object.values((p.messages || {}) as Record<string, Raw[]>)) {
        for (const m of Array.isArray(arr) ? arr : []) {
          stats.raw++
          if (m.type === 'system') { stats.system++; continue }
          if (!beyondId) { stats.noFriend++; continue }
          const key = String(m.id)
          if (seen.has(key)) { stats.duplicates++; continue }
          seen.add(key)
          const c = convertMessage(m, stats.placeholderTypes)
          if (!c) { if (Number.isFinite(Number(m.timestamp))) stats.skippedEmpty++; else stats.badTime++; continue }
          messages.push({ ...c, beyondFriendId: beyondId })
        }
      }
    }
  }
  // 日時順(同じ日時は元の順を保つ)
  messages.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  stats.friends = new Set(messages.map((m) => m.beyondFriendId)).size
  return { messages, stats }
}

export function messagesEnvelope(messages: DatasetMessage[], accountId: string, accountName: string, builtAt?: string): DatasetEnvelope {
  return { version: 1, source: 'lstep', accountId, accountName, builtAt: builtAt ?? new Date().toISOString(), folders: [], fields: [], tags: [], friends: [], messages }
}
