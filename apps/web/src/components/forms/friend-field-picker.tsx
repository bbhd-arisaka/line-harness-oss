'use client'

import { useMemo, useState } from 'react'
import { fetchApi } from '@/lib/api'
import { Modal } from '@/components/ui/modal'
import { FolderIcon } from '@/components/lstep/ui'
import { FIELD_TYPE_LABEL, type FriendFieldType } from '@/lib/friend-field-types'

export interface PickerFolder { id: string; name: string }
export interface PickerField {
  id: string
  fieldKey: string
  label: string
  folderId: string | null
  fieldType?: FriendFieldType
}

const UNFILED = '__unfiled__'

/**
 * 友だち情報欄の選択画面(Lステップの「友だち情報欄名を入力」ドロップダウン相当)。
 * 左にフォルダ、右にそのフォルダの項目。上の検索欄に入力すると全フォルダから絞り込み、
 * 見つからなければその名前で新規追加できる。
 */
export function FriendFieldPicker({
  value,
  fields,
  folders,
  onChange,
  onCreated,
  placeholder = '友だち情報欄名を入力',
  disabledKeys = [],
}: {
  value: string
  fields: PickerField[]
  folders: PickerFolder[]
  onChange: (fieldKey: string) => void
  /** 新規追加された項目(親の一覧に反映するため) */
  onCreated: (f: PickerField) => void
  placeholder?: string
  disabledKeys?: string[]
}) {
  const [open, setOpen] = useState(false)
  const [folderId, setFolderId] = useState<string>(UNFILED)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const selected = fields.find((f) => f.fieldKey === value)
  const q = query.trim().toLowerCase()

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of fields) m.set(f.folderId ?? UNFILED, (m.get(f.folderId ?? UNFILED) ?? 0) + 1)
    return m
  }, [fields])

  const visible = useMemo(() => {
    if (q) return fields.filter((f) => f.label.toLowerCase().includes(q))
    return fields.filter((f) => (f.folderId ?? UNFILED) === folderId)
  }, [fields, folderId, q])

  const folderName = (id: string | null) => folders.find((f) => f.id === id)?.name ?? '未分類'
  const canCreate = q !== '' && !fields.some((f) => f.label.toLowerCase() === q)

  function openPicker() {
    setQuery('')
    setError('')
    const cur = fields.find((f) => f.fieldKey === value)
    if (cur) setFolderId(cur.folderId ?? UNFILED)
    setOpen(true)
  }

  async function create() {
    const label = query.trim()
    if (!label) return
    setCreating(true)
    setError('')
    try {
      const res = await fetchApi<{ success: boolean; data: PickerField; error?: string }>('/api/friend-fields/definitions', {
        method: 'POST',
        body: JSON.stringify({ label, fieldType: 'text', folderId: folderId === UNFILED ? null : folderId }),
      })
      if (!res.success) { setError(res.error || '追加に失敗しました'); return }
      onCreated(res.data)
      onChange(res.data.fieldKey)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="flex h-9 min-w-[14rem] items-center justify-between gap-2 rounded border border-[#cacace] bg-white px-3 text-left text-sm hover:border-[#069e04]"
      >
        <span className={selected ? '' : 'text-[#9a9a9e]'}>{selected ? selected.label : placeholder}</span>
        <span className="text-xs text-[#757578]">⌄</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} maxWidthClass="max-w-2xl" align="center">
        <div className="border-b border-[#e3e3e6] px-5 py-3">
          <h2 className="mb-2 text-base font-bold text-[#069e04]">友だち情報欄を選択</h2>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="友だち情報欄名を入力することで新規追加・検索ができます"
            className="h-10 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]"
          />
        </div>

        <div className="flex h-[22rem]">
          <div className="w-52 flex-shrink-0 overflow-y-auto bg-[#f1f1f4] text-sm">
            {[{ id: UNFILED, name: '未分類' }, ...folders].map((f) => {
              const active = !q && folderId === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { setQuery(''); setFolderId(f.id) }}
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-left ${active ? 'bg-[#ffeccb] font-bold' : 'hover:bg-[#e8e8ec]'}`}
                >
                  <FolderIcon open={active} className={active ? 'text-[#f2a100]' : 'text-[#9a9a9e]'} />
                  <span className="min-w-0 flex-1 break-words leading-tight">{f.name}</span>
                  <span className="text-xs text-[#757578]">{counts.get(f.id) ?? 0}</span>
                </button>
              )
            })}
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto">
            {visible.map((f) => {
              const disabled = disabledKeys.includes(f.fieldKey)
              return (
                <button
                  key={f.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => { onChange(f.fieldKey); setOpen(false) }}
                  className={`flex w-full items-center justify-between gap-3 border-b border-[#f0f0f2] px-4 py-2.5 text-left text-sm hover:bg-[#f3fbf3] disabled:cursor-not-allowed disabled:opacity-40 ${
                    f.fieldKey === value ? 'bg-[#e6f5e5] font-bold text-[#069e04]' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {f.label}
                    {q && <span className="ml-2 text-[11px] font-normal text-[#757578]">({folderName(f.folderId)})</span>}
                  </span>
                  <span className="text-[11px] text-[#757578]">{FIELD_TYPE_LABEL[f.fieldType ?? 'text']}</span>
                </button>
              )
            })}
            {visible.length === 0 && !canCreate && (
              <p className="p-6 text-center text-sm text-[#757578]">選択できる友だち情報欄がありません</p>
            )}
            {canCreate && (
              <button
                type="button"
                disabled={creating}
                onClick={() => void create()}
                className="flex w-full items-center gap-2 border-b border-[#f0f0f2] px-4 py-3 text-left text-sm font-bold text-[#069e04] hover:bg-[#f3fbf3] disabled:opacity-50"
              >
                <span className="text-base leading-none">＋</span>
                「{query.trim()}」を新規追加(フォルダ: {folderName(folderId === UNFILED ? null : folderId)})
              </button>
            )}
            {error && <p className="px-4 py-2 text-xs text-[#e5451f]">{error}</p>}
          </div>
        </div>

        <div className="flex justify-between border-t border-[#e3e3e6] px-5 py-3">
          <button type="button" onClick={() => { onChange(''); setOpen(false) }} className="text-xs text-[#2b7bb9] underline">選択を解除</button>
          <button type="button" onClick={() => setOpen(false)} className="h-9 w-24 rounded border border-[#cacace] bg-white text-sm hover:bg-[#f7f7f9]">閉じる</button>
        </div>
      </Modal>
    </>
  )
}
