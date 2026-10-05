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

/**
 * 画面で選ぶ「ボタンを押したときの動き」。
 *  - reply: 店舗からメッセージを送る(お客様が送ったことにはならない)。保存上は postback の kind='reply' で、
 *           押されたときに店舗側が本文を返信する。長文(5,000文字まで)・改行・絵文字OK。
 *  - message: お客様が送ったことになるテキスト。LINEの仕様で300文字まで。
 */
type UiAction = 'uri' | 'reply' | 'message' | 'richmenuswitch' | 'postback'

const ACTION_OPTIONS: { value: UiAction; label: string }[] = [
  { value: 'uri', label: 'URLを開く' },
  { value: 'reply', label: '店舗からメッセージを送る(長文・改行・絵文字OK)' },
  { value: 'message', label: 'お客様がテキストを送る(300文字まで)' },
  { value: 'richmenuswitch', label: 'メニューのページを切り替える' },
  { value: 'postback', label: '上級者向け(postback)' },
]

function uiActionOf(area: Area): UiAction {
  const data = (area.actionData ?? {}) as Record<string, unknown>
  if (area.actionType === 'postback' && data.kind === 'reply') return 'reply'
  return area.actionType
}

function defaultActionData(type: UiAction): Record<string, unknown> {
  switch (type) {
    case 'uri':
      return { uri: '' }
    case 'reply':
      // replyId は、押されたボタンと本文を結びつける目印。編集して保存し直しても変わらない
      return { kind: 'reply', replyId: crypto.randomUUID(), replyText: '' }
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

/** 複数行(改行OK)のテキストエリア + 絵文字ボタン + 文字数。送信テキストと、店舗から送るメッセージで共通。 */
function TextAreaWithEmoji({
  id,
  label,
  value,
  onChange,
  limit,
  rows,
  placeholder,
  overLimitNote,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  limit: number
  rows: number
  placeholder: string
  overLimitNote: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const length = [...value].length

  // 絵文字は、カーソルの位置(選択している文字があれば置き換え)に入れる
  const insertEmoji = (emoji: string) => {
    const el = ref.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + emoji + value.slice(end))
    const pos = start + emoji.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="block">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs text-gray-500">{label}</label>
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
        id={id}
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 block w-full resize-y border border-gray-300 rounded px-2 py-1 text-sm leading-relaxed"
      />
      {emojiOpen && <EmojiPicker onPick={insertEmoji} />}
      <p className={`mt-1 text-[11px] ${length > limit ? 'text-red-600' : 'text-gray-500'}`}>
        {length.toLocaleString()}/{limit.toLocaleString()}文字{length > limit ? `(${overLimitNote})` : ''}
      </p>
    </div>
  )
}

/** LINEのメッセージアクションの送信テキストは300文字まで。店舗から送るメッセージ(テキスト)は5,000文字まで。改行も1文字。 */
const MESSAGE_TEXT_LIMIT = 300
const REPLY_TEXT_LIMIT = 5000

export function AreaProperties({ area, pages, onUpdate, onDelete }: Props) {
  const data = (area.actionData ?? {}) as Record<string, unknown>
  const uiAction = uiActionOf(area)

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
        <span className="text-xs text-gray-500">ボタンを押したときの動き</span>
        <select
          value={uiAction}
          onChange={(e) => {
            const next = e.target.value as UiAction
            onUpdate({ actionType: next === 'reply' ? 'postback' : next, actionData: defaultActionData(next) })
          }}
          className="mt-0.5 block w-full border border-gray-300 rounded px-2 py-1 text-sm"
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {uiAction === 'uri' && (
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

      {uiAction === 'reply' && (
        <div className="space-y-1">
          <TextAreaWithEmoji
            id="area-reply-text"
            label="店舗から送るメッセージ"
            value={(data.replyText as string) ?? ''}
            onChange={(v) => onUpdate({ actionData: { ...data, replyText: v } })}
            limit={REPLY_TEXT_LIMIT}
            rows={8}
            placeholder={'ボタンを押したお客様に、店舗から送られる文章(Enterで改行できます)'}
            overLimitNote="上限を超えています。公開できません"
          />
          <p className="text-[11px] text-gray-500">
            ボタンを押すと、お客様の発言としては表示されず、店舗からこの文章が届きます。{'{{name}}'} でお客様の名前を入れられます。
          </p>
        </div>
      )}

      {uiAction === 'message' && (
        <div className="space-y-1">
          <TextAreaWithEmoji
            id="area-message-text"
            label="お客様が送るテキスト"
            value={(data.text as string) ?? ''}
            onChange={(v) => onUpdate({ actionData: { ...data, text: v } })}
            limit={MESSAGE_TEXT_LIMIT}
            rows={4}
            placeholder={'ボタンを押すと、お客様が送ったことになるテキスト(Enterで改行できます)'}
            overLimitNote="LINEの上限を超えています。公開できません"
          />
          <p className="text-[11px] text-gray-500">
            お客様が送ったことになるため、LINEの仕様で300文字までです。長い文章は「店舗からメッセージを送る」を選んでください。
          </p>
        </div>
      )}

      {uiAction === 'postback' && (
        <>
          <p className="text-[11px] text-gray-500">
            自動応答のキーワードに合わせて動かしたいときだけ使う、上級者向けの設定です。
          </p>
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

      {uiAction === 'richmenuswitch' && (
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
