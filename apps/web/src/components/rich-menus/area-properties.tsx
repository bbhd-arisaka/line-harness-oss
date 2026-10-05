'use client'

import { useRef, useState } from 'react'
import type { Area } from './canvas-editor'
import { EmojiPicker } from './emoji-picker'

type PageOption = { id: string; name: string }

type Props = {
  area: Area
  pages: PageOption[]
  onUpdate: (patch: Partial<Area>) => void
  onDelete: () => void
}

function defaultActionData(type: Area['actionType']): Record<string, unknown> {
  switch (type) {
    case 'uri':
      return { uri: '' }
    case 'message':
      return { text: '' }
    case 'postback':
      return { data: '', displayText: '' }
    case 'richmenuswitch':
      return { targetPageId: '' }
  }
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
      />
    </label>
  )
}

/** LINEのメッセージアクションの送信テキストは、300文字まで(改行も1文字)。 */
const MESSAGE_TEXT_LIMIT = 300

export function AreaProperties({ area, pages, onUpdate, onDelete }: Props) {
  const data = (area.actionData ?? {}) as Record<string, unknown>
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const messageText = (data.text as string) ?? ''
  const messageLength = [...messageText].length

  // 絵文字は、カーソルの位置(選択している文字があれば置き換え)に入れる
  const insertEmoji = (emoji: string) => {
    const el = textRef.current
    const start = el?.selectionStart ?? messageText.length
    const end = el?.selectionEnd ?? messageText.length
    const next = messageText.slice(0, start) + emoji + messageText.slice(end)
    onUpdate({ actionData: { ...data, text: next } })
    const pos = start + emoji.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }


  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-700">選択中エリア</h3>
        <button
          onClick={onDelete}
          className="text-xs text-red-600 hover:underline"
        >
          削除
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="x" value={area.boundsX} onChange={(v) => onUpdate({ boundsX: v })} />
        <NumField label="y" value={area.boundsY} onChange={(v) => onUpdate({ boundsY: v })} />
        <NumField
          label="幅"
          value={area.boundsWidth}
          onChange={(v) => onUpdate({ boundsWidth: v })}
        />
        <NumField
          label="高さ"
          value={area.boundsHeight}
          onChange={(v) => onUpdate({ boundsHeight: v })}
        />
      </div>

      <label className="block">
        <span className="text-xs text-gray-500">アクション</span>
        <select
          value={area.actionType}
          onChange={(e) => {
            const next = e.target.value as Area['actionType']
            onUpdate({ actionType: next, actionData: defaultActionData(next) })
          }}
          className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="uri">URL を開く (uri)</option>
          <option value="message">テキスト送信 (message)</option>
          <option value="postback">postback</option>
          <option value="richmenuswitch">タブ切替 (richmenuswitch)</option>
        </select>
      </label>

      {area.actionType === 'uri' && (
        <label className="block">
          <span className="text-xs text-gray-500">URL</span>
          <input
            type="url"
            value={(data.uri as string) ?? ''}
            onChange={(e) => onUpdate({ actionData: { ...data, uri: e.target.value } })}
            placeholder="https://..."
            className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            LINE 配信用 URL は tracked link (短縮 URL) 経由を推奨。
          </p>
        </label>
      )}

      {area.actionType === 'message' && (
        <div className="block">
          <div className="flex items-center justify-between">
            <label htmlFor="area-message-text" className="text-xs text-gray-500">送信テキスト</label>
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              aria-expanded={emojiOpen}
              className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
            >
              <span aria-hidden>😊</span> 絵文字
            </button>
          </div>
          <textarea
            id="area-message-text"
            ref={textRef}
            rows={4}
            value={messageText}
            onChange={(e) => onUpdate({ actionData: { ...data, text: e.target.value } })}
            placeholder={'タップしたときに送信されるテキスト(Enterで改行できます)'}
            className="mt-0.5 block w-full resize-y border border-gray-300 rounded px-2 py-1 text-sm leading-relaxed"
          />
          {emojiOpen && <EmojiPicker onPick={insertEmoji} />}
          <p className={`mt-1 text-[11px] ${messageLength > MESSAGE_TEXT_LIMIT ? 'text-red-600' : 'text-gray-500'}`}>
            {messageLength}/{MESSAGE_TEXT_LIMIT}文字{messageLength > MESSAGE_TEXT_LIMIT ? '(LINEの上限を超えています。公開できません)' : ''}
          </p>
        </div>
      )}

      {area.actionType === 'postback' && (
        <>
          <label className="block">
            <span className="text-xs text-gray-500">postback data</span>
            <input
              value={(data.data as string) ?? ''}
              onChange={(e) => onUpdate({ actionData: { ...data, data: e.target.value } })}
              className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">displayText (任意)</span>
            <input
              value={(data.displayText as string) ?? ''}
              onChange={(e) =>
                onUpdate({ actionData: { ...data, displayText: e.target.value } })
              }
              className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>
        </>
      )}

      {area.actionType === 'richmenuswitch' && (
        <label className="block">
          <span className="text-xs text-gray-500">遷移先ページ</span>
          <select
            value={(data.targetPageId as string) ?? ''}
            onChange={(e) =>
              onUpdate({ actionData: { ...data, targetPageId: e.target.value } })
            }
            className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">選択...</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {pages.length < 2 && (
            <p className="mt-1 text-[11px] text-amber-600">
              タブ切替には複数ページが必要です。先にページを追加してください。
            </p>
          )}
        </label>
      )}
    </div>
  )
}
