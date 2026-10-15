'use client'

import { useEffect, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Select } from '@cloudflare/kumo/components/select'
import { Tabs } from '@cloudflare/kumo/components/tabs'
import { eventsApi, type ApiBroadcast, type EventListItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import FlexPreviewComponent from '@/components/flex-preview'
import ImageUploader from '@/components/shared/image-uploader'
import { MessageBodyField } from '@/components/ui/message-body-field'
import { TaggedText } from '@/components/forms/tagged-text'

type MessageType = ApiBroadcast['messageType']

/** 配信するメッセージ1通。key は、並べ替えても入力欄の状態が混ざらないための印(送信しない) */
export interface DraftMessage {
  key: string
  type: MessageType
  content: string
}

/** LINE の1回の配信に載せられる上限 */
export const MAX_MESSAGES = 5

const typeLabels: Record<MessageType, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flexメッセージ',
}

export function newDraftMessage(): DraftMessage {
  return { key: crypto.randomUUID(), type: 'text', content: '' }
}

/** 入力の問題(送る前の確認)。問題が無ければ null */
export function draftMessagesProblem(messages: DraftMessage[]): string | null {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const label = `${i + 1}通目`
    if (!m.content.trim()) return `${label}のメッセージ内容を入力してください`
    if (m.type === 'flex') {
      try { JSON.parse(m.content) } catch { return `${label}: FlexメッセージのJSONが無効です` }
    }
  }
  return null
}

/**
 * 一斉配信のメッセージを、最大5通まで並べて編集する。上から順に配信される。
 * 1通ごとに、種類(テキスト・画像・Flex)・内容を入れ、↑↓で順番を入れ替え、削除できる。
 * テキストには、名前の差し込み(「名前」の枠)と、回答フォームのリンクを入れられる。
 */
export default function MessageListEditor({
  messages,
  onChange,
}: {
  messages: DraftMessage[]
  onChange: (messages: DraftMessage[]) => void
}) {
  const { selectedAccountId } = useAccount()
  // 「リンクするイベント」セレクタ用: 公開中の events を取得して、選んだ event の LIFF URL(テンプレ)を本文へ入れる
  const [linkableEvents, setLinkableEvents] = useState<EventListItem[]>([])
  useEffect(() => {
    if (!selectedAccountId) return
    let cancelled = false
    eventsApi.listEvents(selectedAccountId)
      .then((r) => { if (!cancelled) setLinkableEvents(r.items.filter((e) => e.is_published === 1)) })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [selectedAccountId])

  const patch = (key: string, change: Partial<DraftMessage>) =>
    onChange(messages.map((m) => (m.key === key ? { ...m, ...change } : m)))
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta
    if (to < 0 || to >= messages.length) return
    const next = [...messages]
    ;[next[index], next[to]] = [next[to], next[index]]
    onChange(next)
  }
  const remove = (key: string) => onChange(messages.filter((m) => m.key !== key))

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-kumo-subtle">配信するメッセージ(上から順に届きます)</p>
        <p className="text-xs text-kumo-subtle">{messages.length} / {MAX_MESSAGES}通</p>
      </div>

      {messages.map((m, index) => (
        <div key={m.key} className="rounded-lg border border-kumo-line p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-kumo-strong">{index + 1}通目</p>
            <div className="flex items-center gap-1">
              <Button type="button" size="xs" variant="ghost" icon={ArrowUpIcon} aria-label={`${index + 1}通目を上へ`} disabled={index === 0} onClick={() => move(index, -1)} />
              <Button type="button" size="xs" variant="ghost" icon={ArrowDownIcon} aria-label={`${index + 1}通目を下へ`} disabled={index === messages.length - 1} onClick={() => move(index, 1)} />
              <Button type="button" size="xs" variant="ghost" icon={TrashIcon} aria-label={`${index + 1}通目を削除`} disabled={messages.length <= 1} onClick={() => remove(m.key)} />
            </div>
          </div>

          <div className="mb-2">
            <Tabs
              size="sm"
              value={m.type}
              onValueChange={(value) => patch(m.key, { type: value as MessageType, content: value === m.type ? m.content : '' })}
              tabs={(Object.keys(typeLabels) as MessageType[]).map((type) => ({ value: type, label: typeLabels[type] }))}
            />
          </div>

          {m.type === 'image' && (
            <div className="mb-2">
              <ImageUploader
                mode="line-image"
                value={(() => {
                  try {
                    const parsed = JSON.parse(m.content) as { originalContentUrl?: string; previewImageUrl?: string }
                    if (parsed.originalContentUrl) {
                      return { mode: 'line-image' as const, originalContentUrl: parsed.originalContentUrl, previewImageUrl: parsed.previewImageUrl ?? parsed.originalContentUrl }
                    }
                  } catch { /* ignore */ }
                  return null
                })()}
                onChange={(v) => {
                  if (v?.mode === 'line-image') {
                    patch(m.key, { content: JSON.stringify({ originalContentUrl: v.originalContentUrl, previewImageUrl: v.previewImageUrl }) })
                  } else {
                    patch(m.key, { content: '' })
                  }
                }}
                label="送信する画像"
              />
            </div>
          )}

          {linkableEvents.length > 0 && m.type === 'text' && (
            <div className="mb-2">
              <Select
                label="リンクするイベント"
                required={false}
                value=""
                onValueChange={(value) => {
                  const id = value ?? ''
                  if (!id) return
                  const url = `https://liff.line.me/{{liff_id}}/?page=event&id=${id}&liffId={{liff_id}}`
                  patch(m.key, { content: m.content ? `${m.content}\n${url}` : url })
                }}
                placeholder="選択しない"
                items={linkableEvents.map((event) => ({ value: event.id, label: `${event.name} (${event.target_type === 'multi-account-dedup' ? 'multi' : 'single'})` }))}
              />
              <p className="mt-1 text-xs text-kumo-subtle">
                選ぶと本文末尾にテンプレ URL を挿入。<TaggedText text="{{liff_id}}" /> は配信時に各友だちのアカに対応した値に自動置換されます。
              </p>
            </div>
          )}

          <MessageBodyField
            label="メッセージ内容"
            required
            messageType={m.type}
            allowNameTag
            description={m.type === 'text' ? undefined : 'JSON形式で指定します。'}
            rows={m.type === 'flex' ? 8 : m.type === 'image' ? 3 : 4}
            placeholder={
              m.type === 'text'
                ? '配信するメッセージを入力...'
                : m.type === 'image'
                ? '{"originalContentUrl":"...","previewImageUrl":"..."}'
                : '{"type":"bubble","body":{...}}'
            }
            value={m.content}
            onChange={(value) => patch(m.key, { content: value })}
          />
          {m.type === 'image' && (
            <p className="mt-1 text-xs text-kumo-subtle">上の画像アップロードか、直接JSONを編集できます</p>
          )}
          {m.type === 'flex' && m.content && (() => {
            try { JSON.parse(m.content); return true } catch { return false }
          })() && (
            <div className="mt-3">
              <p className="mb-2 text-xs font-medium text-gray-500">プレビュー</p>
              <FlexPreviewComponent content={m.content} maxWidth={300} />
            </div>
          )}
        </div>
      ))}

      {messages.length < MAX_MESSAGES ? (
        <Button type="button" variant="secondary" icon={PlusIcon} onClick={() => onChange([...messages, newDraftMessage()])}>
          メッセージを追加({messages.length}/{MAX_MESSAGES})
        </Button>
      ) : (
        <p className="text-xs text-kumo-subtle">メッセージは5通までです(LINEの1回の配信の上限)</p>
      )}
    </div>
  )
}
