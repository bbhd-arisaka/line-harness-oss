'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import {
  OPTION_COLORS,
  OPTION_FIELD_TYPES,
  REGISTRABLE_FIELD_TYPES,
  type FriendFieldType,
} from '@/lib/friend-field-types'

interface Folder { id: string; name: string }
interface Definition {
  id: string
  folderId: string | null
  label: string
  fieldType: FriendFieldType
  options: string[]
  optionColors: string[]
  defaultValue: string | null
}
interface OptionRow { rowId: number; label: string; color: string }

const DEFAULT_MAX = 200
let rowSeq = 0

/** 旧種別(数値/ラジオ/チェックボックス)は、画面上は近いカードを選択済みとして見せる。 */
function cardTypeFor(t: FriendFieldType): FriendFieldType {
  if (t === 'number') return 'text'
  if (t === 'radio' || t === 'checkbox') return 'select'
  return t
}

const TYPE_ICON: Record<string, string> = {
  text: 'あa', textarea: '≡', image: '▣', pdf: 'PDF', date: '▦', datetime: '◴', select: '☰',
}

export default function FriendFieldEditPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [initialGroup, setInitialGroup] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [label, setLabel] = useState('')
  const [folderId, setFolderId] = useState('')
  const [fieldType, setFieldType] = useState<FriendFieldType>('text')
  const [defaultValue, setDefaultValue] = useState('')
  const [options, setOptions] = useState<OptionRow[]>([{ rowId: rowSeq++, label: '', color: '' }])
  const [colorPickerRow, setColorPickerRow] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const defaultInputRef = useRef<HTMLInputElement>(null)
  const dragRow = useRef<number | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    const group = params.get('group') ?? ''
    setEditId(id)
    setInitialGroup(group)
    setFolderId(group)
    ;(async () => {
      try {
        const fRes = await fetchApi<{ success: boolean; data: Folder[] }>('/api/friend-fields/folders')
        if (fRes.success) setFolders(fRes.data)
        if (id) {
          const dRes = await fetchApi<{ success: boolean; data: Definition[] }>('/api/friend-fields/definitions')
          const d = dRes.success ? dRes.data.find((x) => x.id === id) : undefined
          if (d) {
            setLabel(d.label)
            setFolderId(d.folderId ?? '')
            setInitialGroup(d.folderId ?? '')
            setFieldType(d.fieldType)
            setDefaultValue(d.defaultValue ?? '')
            if (d.options.length > 0) {
              setOptions(d.options.map((o, i) => ({ rowId: rowSeq++, label: o, color: d.optionColors[i] ?? '' })))
            }
          } else {
            setError('友だち情報欄が見つかりませんでした')
          }
        }
      } catch {
        setError('読み込みに失敗しました')
      } finally {
        setReady(true)
      }
    })()
  }, [])

  const isEdit = editId !== null
  const showOptions = OPTION_FIELD_TYPES.includes(fieldType)
  const backHref = `/friend-fields?group=${initialGroup}`

  function insertNameTag() {
    const el = defaultInputRef.current
    const tag = '[name]'
    if (!el) { setDefaultValue((v) => (v + tag).slice(0, DEFAULT_MAX)); return }
    const start = el.selectionStart ?? defaultValue.length
    const end = el.selectionEnd ?? defaultValue.length
    setDefaultValue((defaultValue.slice(0, start) + tag + defaultValue.slice(end)).slice(0, DEFAULT_MAX))
  }

  function moveOption(targetRowId: number) {
    const from = dragRow.current
    dragRow.current = null
    if (from === null || from === targetRowId) return
    setOptions((prev) => {
      const list = [...prev]
      const fromIdx = list.findIndex((r) => r.rowId === from)
      const toIdx = list.findIndex((r) => r.rowId === targetRowId)
      const [moved] = list.splice(fromIdx, 1)
      list.splice(toIdx, 0, moved)
      return list
    })
  }

  async function save() {
    setError('')
    if (!label.trim()) { setError('友だち情報欄名を入力してください'); return }
    const cleaned = options.filter((o) => o.label.trim())
    if (showOptions && cleaned.length === 0) { setError('選択肢を1つ以上入力してください'); return }
    if (showOptions && new Set(cleaned.map((o) => o.label.trim())).size !== cleaned.length) {
      setError('同じ名前の選択肢があります')
      return
    }
    const body = {
      label: label.trim(),
      folderId: folderId || null,
      defaultValue: defaultValue || null,
      ...(showOptions
        ? { options: cleaned.map((o) => o.label.trim()), optionColors: cleaned.map((o) => o.color) }
        : {}),
    }
    setSaving(true)
    try {
      const res = isEdit
        ? await fetchApi<{ success: boolean; error?: string }>(`/api/friend-fields/definitions/${editId}`, {
            method: 'PUT',
            body: JSON.stringify(body),
          })
        : await fetchApi<{ success: boolean; error?: string }>('/api/friend-fields/definitions', {
            method: 'POST',
            body: JSON.stringify({ ...body, fieldType }),
          })
      if (!res.success) {
        setError(res.error || '保存に失敗しました')
        return
      }
      router.push(`/friend-fields?group=${folderId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const title = isEdit ? '友だち情報欄編集' : '友だち情報欄登録'
  const selectedCard = cardTypeFor(fieldType)

  return (
    <div className="pb-24">
      <p className="mb-4 text-xs text-[#414143]">
        <Link href={backHref} className="text-[#2b7bb9] underline">友だち情報欄一覧</Link>
        <span className="mx-1">&gt;</span>
        {title}
      </p>
      <Header title={title} />

      {!ready ? (
        <p className="text-sm text-[#757578]">読み込み中...</p>
      ) : (
        <div className="max-w-[54rem]">
          <div className="flex flex-wrap gap-5">
            <div className="w-[21rem] max-w-full">
              <label className="mb-1 flex items-center gap-2 text-xs font-bold">
                友だち情報欄名
                <span className="rounded-sm bg-[#e5451f] px-1 text-[10px] font-bold text-white">必須</span>
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={50}
                className="h-10 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]"
              />
            </div>
            <div className="w-[13rem]">
              <label className="mb-1 block text-xs font-bold">フォルダ名</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#f2a100]">
                  <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M0 1.5A1 1 0 011 .5h4l1.5 1.5H13a1 1 0 011 1V10a1 1 0 01-1 1H1a1 1 0 01-1-1V1.5z" fill="currentColor" /></svg>
                </span>
                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="h-10 w-full appearance-none rounded border border-[#cacace] bg-white pl-9 pr-8 text-sm outline-none focus:border-[#069e04]"
                >
                  <option value="">未分類</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs">⌄</span>
              </div>
            </div>
          </div>

          <p className="mb-2 mt-6 text-xs">
            <span className="font-bold">種別</span>
            <span className="ml-1 text-[11px] text-[#757578]">※新規登録後は変更できません。</span>
          </p>
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-2">
            {REGISTRABLE_FIELD_TYPES.map((t) => {
              const selected = selectedCard === t.value
              return (
                <label
                  key={t.value}
                  className={`flex overflow-hidden rounded border bg-white ${
                    selected ? 'border-2 border-[#069e04]' : 'border-[#dcdce0]'
                  } ${isEdit ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-[#8fd08c]'}`}
                >
                  <span className={`flex w-9 items-center justify-center ${selected ? 'bg-[#e6f5e5]' : 'bg-[#f7f7f9]'}`}>
                    <input
                      type="radio"
                      name="fieldType"
                      checked={selected}
                      disabled={isEdit}
                      onChange={() => setFieldType(t.value)}
                      className="accent-[#069e04]"
                    />
                  </span>
                  <span className="flex w-10 items-center justify-center text-xs text-[#757578]">{TYPE_ICON[t.value]}</span>
                  <span className="py-2 pr-3">
                    <span className="block text-sm font-bold">{t.label}</span>
                    <span className="block text-[11px] leading-4 text-[#757578]">{t.description}</span>
                  </span>
                </label>
              )
            })}
          </div>

          <p className="mb-1 mt-6 text-xs font-bold">既定値</p>
          <div className="flex items-start gap-2">
            <div className="w-[21rem] max-w-full">
              <input
                ref={defaultInputRef}
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value.slice(0, DEFAULT_MAX))}
                className="h-10 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]"
              />
              <p className="mt-1 flex justify-between text-[11px] text-[#757578]">
                <span>※友だち情報が空欄の場合に送信されます。</span>
                <span>{defaultValue.length}/{DEFAULT_MAX}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={insertNameTag}
              className="h-10 whitespace-nowrap rounded border border-[#cacace] bg-white px-3 text-xs hover:bg-[#f7f7f9]"
            >
              [name]を使用
            </button>
          </div>

          {showOptions && (
            <div className="mt-6">
              <p className="mb-1 text-xs font-bold">選択肢</p>
              <div className="w-[43rem] max-w-full">
                <div className="grid grid-cols-[3rem_1fr_9rem_2.5rem] items-center bg-[#f1f1f4] px-2 text-xs text-[#757578]" style={{ height: 34 }}>
                  <span className="text-center">#</span>
                  <span>選択肢</span>
                  <span>カラー</span>
                  <span />
                </div>
                {options.map((o, i) => (
                  <div
                    key={o.rowId}
                    draggable
                    onDragStart={() => { dragRow.current = o.rowId }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => moveOption(o.rowId)}
                    className="relative grid grid-cols-[3rem_1fr_9rem_2.5rem] items-center border-b border-[#e3e3e6] bg-white px-2 py-2"
                  >
                    <span className="flex items-center gap-1 text-sm">
                      <span className="cursor-grab text-[#b5b5b9]" aria-hidden="true">⠿</span>
                      {i + 1}
                    </span>
                    <input
                      value={o.label}
                      onChange={(e) => setOptions((prev) => prev.map((r) => (r.rowId === o.rowId ? { ...r, label: e.target.value } : r)))}
                      className="mr-3 h-9 rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]"
                    />
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setColorPickerRow((v) => (v === o.rowId ? null : o.rowId))}
                        className="flex h-9 items-center gap-2 rounded border border-[#cacace] bg-white px-3 text-sm hover:bg-[#f7f7f9]"
                      >
                        <span className="h-4 w-4 rounded-sm border border-[#cacace]" style={{ background: o.color || '#fff' }} />
                        設定
                      </button>
                      {colorPickerRow === o.rowId && (
                        <div className="absolute left-0 top-full z-20 mt-1 grid w-40 grid-cols-6 gap-1.5 rounded border border-[#cacace] bg-white p-2 shadow-lg">
                          {OPTION_COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              aria-label={`色 ${c}`}
                              onClick={() => {
                                setOptions((prev) => prev.map((r) => (r.rowId === o.rowId ? { ...r, color: c } : r)))
                                setColorPickerRow(null)
                              }}
                              className="h-5 w-5 rounded-sm border border-black/10"
                              style={{ background: c }}
                            />
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setOptions((prev) => prev.map((r) => (r.rowId === o.rowId ? { ...r, color: '' } : r)))
                              setColorPickerRow(null)
                            }}
                            className="col-span-6 mt-1 text-left text-[11px] text-[#2b7bb9] underline"
                          >
                            色をなしにする
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="この選択肢を削除"
                      disabled={options.length <= 1}
                      onClick={() => setOptions((prev) => prev.filter((r) => r.rowId !== o.rowId))}
                      className="text-[#b5b5b9] hover:text-[#e5451f] disabled:opacity-40"
                    >
                      🗑
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setOptions((prev) => [...prev, { rowId: rowSeq++, label: '', color: '' }])}
                  className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded border border-[#cacace] bg-white text-xs font-bold hover:bg-[#f7f7f9]"
                >
                  <span className="text-base leading-none">＋</span> 新しい選択肢を追加
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-[#e5451f]">{error}</p>}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e3e3e6] bg-white/95 px-6 py-3 backdrop-blur lg:left-60">
        <div className="relative flex items-center justify-center">
          <Link href={backHref} className="absolute left-0 text-xs text-[#2b7bb9] underline">友だち情報欄一覧へ戻る</Link>
          <button
            type="button"
            disabled={saving || !ready}
            onClick={() => void save()}
            className="h-10 w-32 rounded bg-[#069e04] text-sm font-bold text-white hover:bg-[#058503] disabled:opacity-60"
          >
            {saving ? '保存中...' : isEdit ? '保存' : '登録'}
          </button>
        </div>
      </div>
    </div>
  )
}
