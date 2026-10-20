import { parseRawMessages } from '@line-crm/shared'

export type PreviewMessage = Record<string, unknown> & { type: string }

/**
 * 保存されているテンプレートの内容(message_type / message_content)を、画面のプレビュー用の「LINEのメッセージの並び」にする。
 * Worker が送るときの取り出し(buildMessages)と同じ決まり: 'flex' に {"lineMessages":[…]} の目印があれば、そのまま送る LINE メッセージ。
 */
export function previewMessagesOf(messageType: string, messageContent: string): PreviewMessage[] {
  const raw = parseRawMessages(messageType, messageContent)
  if (raw) return raw as PreviewMessage[]
  if (messageType === 'text') return [{ type: 'text', text: messageContent }]
  if (messageType === 'image') {
    try {
      const p = JSON.parse(messageContent) as { originalContentUrl?: string; previewImageUrl?: string }
      return [{ type: 'image', originalContentUrl: p.originalContentUrl ?? '', previewImageUrl: p.previewImageUrl ?? '' }]
    } catch {
      return [{ type: 'text', text: messageContent }]
    }
  }
  // flex / carousel(旧来)
  return [{ type: 'flex', contents: messageContent }]
}
