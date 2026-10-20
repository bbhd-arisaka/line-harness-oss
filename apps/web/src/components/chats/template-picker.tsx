'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { api } from '@/lib/api'
import { parseRawMessages } from '@line-crm/shared'

export interface ChatTemplate {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
}

type TypeFilter = 'all' | 'text' | 'flex' | 'image'

const TYPE_LABEL: Record<string, string> = { text: 'テキスト', flex: 'Flex', image: '画像' }
const FILTERS: Array<{ key: TypeFilter; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'text', label: 'テキスト' },
  { key: 'flex', label: 'Flex' },
  { key: 'image', label: '画像' },
]

/** 一覧に出す、中身の短い説明(テキストは冒頭。差し込みのタグコードは、文字のまま見せない) */
export function templatePreview(t: Pick<ChatTemplate, 'messageType' | 'messageContent'>): string {
  if (t.messageType === 'image') return '[画像]'
  // テンプレート機能(Lステップ同形)で作ったもの: 中身の LINE メッセージの並びから説明を作る
  const raw = parseRawMessages(t.messageType, t.messageContent)
  if (raw) {
    const names: Record<string, string> = { text: 'テキスト', sticker: 'スタンプ', image: '画像', imagemap: '画像', template: '質問', flex: 'Flex メッセージ', location: '位置情報', audio: '音声', video: '動画' }
    const first = raw[0]
    const head = first.type === 'text' && typeof first.text === 'string' ? first.text.replace(/\s+/g, ' ').trim().slice(0, 60) : `[${names[first.type] ?? first.type}]`
    return raw.length > 1 ? `${head} ほか${raw.length - 1}通` : head
  }
  if (t.messageType === 'flex') return '[Flex メッセージ]'
  return t.messageContent
    .replace(/\{\{\s*form_url:\S+?\s*\}\}/g, '[フォーム]')
    .replace(/\{\{\s*name\s*\}\}/g, '[LINE名]')
    .replace(/\{\{\s*real_name\s*\}\}/g, '[本名]')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * トークから送る「テンプレート」の選択画面。
 * テキストのテンプレートは、選ぶと入力欄に入る(直してから送れる)。画像・Flex は、選ぶと、送る前の確認に進む。
 */
export function TemplatePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (template: ChatTemplate) => void
}) {
  const [items, setItems] = useState<ChatTemplate[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<TypeFilter>('all')

  useEffect(() => {
    if (!open || items) return
    let cancelled = false
    api.templates
      .list()
      .then((res) => {
        if (cancelled) return
        if (res.success) setItems(res.data)
        else setFailed(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, items])

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    return (items ?? []).filter((t) => {
      if (type !== 'all' && t.messageType !== type) return false
      if (!q) return true
      return t.name.toLowerCase().includes(q) || templatePreview(t).toLowerCase().includes(q)
    })
  }, [items, q, type])

  const pick = (t: ChatTemplate) => {
    onPick(t)
    setQuery('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-2xl" align="center">
      <div className="p-5">
        <h2 className="text-base font-bold text-[#333]">テンプレートから送る</h2>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前や内容で検索"
          className="mt-3 w-full rounded border border-[#cacace] px-3 py-2 text-sm outline-none focus:border-[#069e04]"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setType(f.key)}
              className={`rounded-full border px-3 py-0.5 text-xs ${type === f.key ? 'border-[#069e04] bg-[#eaf7ea] font-bold text-[#069e04]' : 'border-[#cacace] text-[#333] hover:bg-[#f1f1f4]'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="mt-3 h-80 overflow-y-auto rounded border border-[#e0e0e3] text-sm">
          {failed ? (
            <p className="p-4 text-red-600">テンプレートを読み込めませんでした。時間をおいて、もう一度開いてください。</p>
          ) : items === null ? (
            <p className="p-4 text-[#757578]">読み込み中…</p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-[#757578]">{items.length === 0 ? 'テンプレートがまだありません(「テンプレート」画面で作れます)' : '該当するテンプレートがありません'}</p>
          ) : (
            visible.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t)}
                className="block w-full border-b border-[#f0f0f2] px-4 py-2.5 text-left last:border-b-0 hover:bg-[#eef6ff]"
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-[#333]">{t.name}</span>
                  <span className="shrink-0 rounded bg-[#f1f1f4] px-1.5 py-0.5 text-[10px] text-[#555]">{TYPE_LABEL[t.messageType] ?? t.messageType}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-[#757578]">{templatePreview(t)}</span>
              </button>
            ))
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded border border-[#cacace] px-4 py-1.5 text-sm text-[#333] hover:bg-[#f1f1f4]">
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** 画像テンプレートの、送る前の確認に出す画像(内容は、LINE が求める JSON の文字列) */
export function TemplateImagePreview({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content) as { originalContentUrl?: string; previewImageUrl?: string }
    const url = parsed.originalContentUrl || parsed.previewImageUrl
    if (url) return <img src={url} alt="テンプレートの画像" className="max-h-60 max-w-full rounded" />
  } catch {
    // 読み取れないときは、下の文言を出す
  }
  return <p className="text-xs text-red-600">画像を読み取れません</p>
}
