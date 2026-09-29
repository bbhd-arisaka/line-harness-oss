'use client'

import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { FolderIcon } from '@/components/lstep/ui'
import { displayFormName } from '@/app/form-submissions/form-list'
import { useForms, type FormOption } from './use-form-names'

const UNFILED = '__unfiled__'
const ALL = '__all__'

/**
 * 回答フォームの選択画面。選ぶと、入力欄に青い枠の「フォーム」が入る(送信時にそのアカウントのリンクへ変換される)。
 * 左にフォルダ、右にフォーム。上の検索欄で全フォルダから絞り込める。
 */
export function FormTagPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (form: FormOption) => void
}) {
  const { forms, folders, loaded } = useForms()
  const [folderId, setFolderId] = useState<string>(ALL)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const byQuery = q
      ? forms.filter((f) => displayFormName(f.name).toLowerCase().includes(q))
      : forms
    if (q || folderId === ALL) return byQuery
    if (folderId === UNFILED) return byQuery.filter((f) => !f.folderId)
    return byQuery.filter((f) => f.folderId === folderId)
  }, [forms, q, folderId])

  const pick = (form: FormOption) => {
    onPick(form)
    setQuery('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-2xl" align="center">
      <div className="p-5">
        <h2 className="text-base font-bold text-[#333]">回答フォームを挿入</h2>
        <p className="mt-1 text-xs text-[#757578]">
          選んだフォームは、送信時にこのトークのアカウント用のリンクに自動で変換されます。
        </p>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="フォーム名で検索"
          className="mt-3 w-full rounded border border-[#cacace] px-3 py-2 text-sm outline-none focus:border-[#069e04]"
        />
        <div className="mt-3 flex h-72 overflow-hidden rounded border border-[#e0e0e3]">
          <div className="w-44 shrink-0 overflow-y-auto border-r border-[#e0e0e3] bg-[#f7f7f9] py-1 text-sm">
            {[{ id: ALL, name: 'すべて' }, ...folders, { id: UNFILED, name: '未分類' }].map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => { setFolderId(folder.id); setQuery('') }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white ${!q && folderId === folder.id ? 'bg-white font-bold text-[#069e04]' : 'text-[#333]'}`}
              >
                <FolderIcon />
                <span className="truncate">{folder.name}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto py-1 text-sm">
            {!loaded ? (
              <p className="p-4 text-[#757578]">読み込み中…</p>
            ) : visible.length === 0 ? (
              <p className="p-4 text-[#757578]">該当するフォームがありません</p>
            ) : (
              visible.map((form) => (
                <button
                  key={form.id}
                  type="button"
                  onClick={() => pick(form)}
                  className="block w-full truncate px-4 py-2 text-left text-[#333] hover:bg-[#eef6ff]"
                >
                  {displayFormName(form.name)}
                </button>
              ))
            )}
          </div>
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
