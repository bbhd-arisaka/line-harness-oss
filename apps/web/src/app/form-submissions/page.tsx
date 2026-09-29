'use client'

import { formTagCode } from '@/lib/form-tags'
import { useDialogs } from '@/components/ui/dialogs'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { Button } from '@cloudflare/kumo/components/button'
import { Popover, FolderRow, btnBase, btnWhite, btnGreen } from '@/components/lstep/ui'
import { displayFormName } from './form-list'

interface FormFolder { id: string; name: string; displayOrder: number }

interface Form {
  id: string
  name: string
  folderId: string | null
  formUrl?: string | null
  isActive: boolean
  submitCount?: number
  createdAt: string
  lastSubmittedAt: string | null
  usedByAccounts: Array<{ id: string; count: number }>
  googleSheetsEnabled?: boolean
}

const UNASSIGNED = '__unassigned__'
const PAGE_SIZE = 30

type SortMode = 'newest' | 'name' | 'answers'
const SORT_LABEL: Record<SortMode, string> = {
  newest: '登録日の新しい順',
  name: 'フォーム名順',
  answers: '回答数が多い順',
}

function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-[#069e04]' : 'bg-[#b5b5b9]'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

export default function FormListPage() {
  const dialogs = useDialogs()
  const [forms, setForms] = useState<Form[]>([])
  const [folders, setFolders] = useState<FormFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string>(UNASSIGNED)
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [sortOpen, setSortOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [copiedTagId, setCopiedTagId] = useState<string | null>(null)
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const [folderMenuOpen, setFolderMenuOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [draftFolderName, setDraftFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const dragFolderId = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [fRes, folderRes] = await Promise.all([
        fetchApi<{ success: boolean; data: Form[] }>('/api/forms'),
        fetchApi<{ success: boolean; data: FormFolder[] }>('/api/forms/folders'),
      ])
      if (fRes.success) setForms(fRes.data)
      if (folderRes.success) setFolders(folderRes.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setPage(1) }, [selectedFolderId, search, sortMode])
  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get('group')
    if (g) setSelectedFolderId(g)
  }, [])

  const countByFolder = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of forms) m.set(f.folderId ?? UNASSIGNED, (m.get(f.folderId ?? UNASSIGNED) ?? 0) + 1)
    return m
  }, [forms])

  const visible = useMemo(() => {
    let list = forms.filter((f) => (f.folderId ?? UNASSIGNED) === selectedFolderId)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((f) => displayFormName(f.name).toLowerCase().includes(q))
    const count = (f: Form) => f.submitCount ?? f.usedByAccounts.reduce((s, a) => s + a.count, 0)
    if (sortMode === 'name') list = [...list].sort((a, b) => displayFormName(a.name).localeCompare(displayFormName(b.name), 'ja'))
    else if (sortMode === 'answers') list = [...list].sort((a, b) => count(b) - count(a))
    else list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return list
  }, [forms, selectedFolderId, search, sortMode])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null

  // ── フォルダ ─────────────────────────────────────────────
  async function saveFolder() {
    const name = draftFolderName.trim()
    if (!name) return
    setSavingFolder(true)
    try {
      if (editingFolderId) {
        await fetchApi(`/api/forms/folders/${editingFolderId}`, { method: 'PUT', body: JSON.stringify({ name }) })
      } else {
        const res = await fetchApi<{ success: boolean; data: FormFolder }>('/api/forms/folders', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
        if (res.success) setSelectedFolderId(res.data.id)
      }
      setFolderDialogOpen(false)
      await load()
    } finally {
      setSavingFolder(false)
    }
  }
  async function deleteFolder() {
    if (!selectedFolder) return
    setFolderMenuOpen(false)
    if (!await dialogs.confirm(`フォルダ「${selectedFolder.name}」を削除しますか?\n中の回答フォームは「未分類」に移動します。`)) return
    await fetchApi(`/api/forms/folders/${selectedFolder.id}`, { method: 'DELETE' })
    setSelectedFolderId(UNASSIGNED)
    await load()
  }
  async function dropFolder(targetId: string) {
    const from = dragFolderId.current
    dragFolderId.current = null
    if (!from || from === targetId) return
    const ids = folders.map((f) => f.id)
    ids.splice(ids.indexOf(from), 1)
    ids.splice(ids.indexOf(targetId), 0, from)
    setFolders(ids.map((id, i) => ({ ...folders.find((f) => f.id === id)!, displayOrder: i })))
    for (let i = 0; i < ids.length; i++) {
      await fetchApi(`/api/forms/folders/${ids[i]}`, { method: 'PUT', body: JSON.stringify({ displayOrder: i }) })
    }
  }

  // ── フォーム ─────────────────────────────────────────────
  async function toggleActive(f: Form) {
    setBusyId(f.id)
    try {
      await fetchApi(`/api/forms/${f.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !f.isActive }) })
      await load()
    } finally {
      setBusyId(null)
    }
  }
  async function duplicate(f: Form) {
    setRowMenuId(null)
    await fetchApi(`/api/forms/${f.id}/duplicate`, { method: 'POST' })
    await load()
  }
  async function remove(f: Form) {
    setRowMenuId(null)
    if (!await dialogs.confirm(`回答フォーム「${displayFormName(f.name)}」を削除しますか?\n回答データも一緒に削除されます。`)) return
    await fetchApi(`/api/forms/${f.id}`, { method: 'DELETE' })
    await load()
  }

  const newHref = `/form-submissions/edit?group=${selectedFolderId === UNASSIGNED ? '' : selectedFolderId}`
  const cols = 'grid-cols-[1fr_9rem_10rem_8rem_6rem_3rem]'

  return (
    <div>
      <Header title="回答フォーム" description="さまざまな質問形式のフォームを作成できます。" />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex gap-5">
        <div className="w-[15rem] flex-shrink-0">
          <button
            type="button"
            className={btnWhite}
            onClick={() => { setEditingFolderId(null); setDraftFolderName(''); setFolderDialogOpen(true) }}
          >
            <span className="text-base leading-none">＋</span> 新しいフォルダ
          </button>
          <div className="mt-3 max-h-[calc(100vh-15rem)] overflow-y-auto bg-[#f1f1f4] text-sm">
            <FolderRow
              label="未分類"
              count={countByFolder.get(UNASSIGNED) ?? 0}
              selected={selectedFolderId === UNASSIGNED}
              onSelect={() => setSelectedFolderId(UNASSIGNED)}
            />
            {folders.map((f) => (
              <FolderRow
                key={f.id}
                label={f.name}
                count={countByFolder.get(f.id) ?? 0}
                selected={selectedFolderId === f.id}
                draggable
                onSelect={() => setSelectedFolderId(f.id)}
                onDragStart={() => { dragFolderId.current = f.id }}
                onDrop={() => void dropFolder(f.id)}
                menu={
                  selectedFolderId === f.id ? (
                    <div className="relative">
                      <button type="button" aria-label="フォルダメニュー" className="px-1.5 text-base font-bold" onClick={(e) => { e.stopPropagation(); setFolderMenuOpen((v) => !v) }}>⋮</button>
                      <Popover open={folderMenuOpen} onClose={() => setFolderMenuOpen(false)}>
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f1f4]"
                            onClick={() => { setEditingFolderId(f.id); setDraftFolderName(f.name); setFolderMenuOpen(false); setFolderDialogOpen(true) }}
                          >
                            名前を変更
                          </button>
                          <button type="button" className="block w-full px-3 py-1.5 text-left text-[#e5451f] hover:bg-[#f1f1f4]" onClick={() => void deleteFolder()}>削除</button>
                        </Popover>
                    </div>
                  ) : null
                }
              />
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <Link href={newHref} className={btnGreen}>
              <span className="text-base leading-none">＋</span> 新しい回答フォーム
            </Link>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button type="button" className={btnWhite} onClick={() => setSortOpen((v) => !v)}>
                  <span aria-hidden="true">⇅</span> 並び替え
                </button>
                <Popover open={sortOpen} onClose={() => setSortOpen(false)}>
                    {(Object.keys(SORT_LABEL) as SortMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4] ${sortMode === m ? 'font-bold text-[#069e04]' : ''}`}
                        onClick={() => { setSortMode(m); setSortOpen(false) }}
                      >
                        {SORT_LABEL[m]}
                      </button>
                    ))}
                  </Popover>
              </div>
              <div className="flex">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="検索"
                  className="h-9 w-44 rounded-l border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]"
                />
                <span className="flex h-9 w-10 items-center justify-center rounded-r bg-[#757578] text-white" aria-hidden="true">⌕</span>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <div className={`grid ${cols} items-center bg-[#f1f1f4] px-4 text-xs text-[#757578]`} style={{ height: 40 }}>
              <span>フォーム名</span>
              <span className="leading-tight">スプレッドシート<br />連携</span>
              <span>回答状態</span>
              <span>登録日</span>
              <span>公開状態</span>
              <span />
            </div>
            {loading ? (
              <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">読み込み中...</p>
            ) : pageItems.length === 0 ? (
              <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">
                {search.trim() ? '該当する回答フォームがありません' : '回答フォームが作成されていません'}
              </p>
            ) : (
              pageItems.map((f) => {
                const total = f.submitCount ?? f.usedByAccounts.reduce((s, a) => s + a.count, 0)
                return (
                  <div key={f.id} className={`item-enter grid ${cols} items-center border-b border-[#e3e3e6] bg-white px-4 text-sm transition-colors duration-150 hover:bg-[#fafafb]`} style={{ minHeight: 54 }}>
                    <Link href={`/form-submissions/edit?id=${f.id}`} className="py-2 pr-3 font-bold text-[#2b7bb9] underline">
                      {displayFormName(f.name)}
                    </Link>
                    <span className="text-xs">{f.googleSheetsEnabled ? '連携中' : '-'}</span>
                    <span className="text-xs">
                      {total > 0 ? (
                        <Link href={`/form-submissions/answers?id=${f.id}`} className="text-[#2b7bb9] underline">{total}件</Link>
                      ) : (
                        <span className="text-[#757578]">回答なし</span>
                      )}
                    </span>
                    <span className="text-xs">{new Date(f.createdAt).toLocaleDateString('ja-JP')}</span>
                    <span><Toggle on={f.isActive} disabled={busyId === f.id} onChange={() => void toggleActive(f)} label={`${displayFormName(f.name)}を${f.isActive ? '停止' : '公開'}`} /></span>
                    <div className="relative flex justify-end">
                      <button type="button" aria-label="メニュー" className="px-1.5 text-base font-bold" onClick={() => setRowMenuId((v) => (v === f.id ? null : f.id))}>⋮</button>
                      <Popover open={rowMenuId === f.id} onClose={() => setRowMenuId(null)}>
                          {f.formUrl && (
                            <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => { setRowMenuId(null); window.open(f.formUrl!, '_blank', 'noopener') }}>プレビュー</button>
                          )}
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f1f4]"
                            onClick={() => {
                              void navigator.clipboard.writeText(formTagCode(f.id)).then(() => {
                                setCopiedTagId(f.id)
                                setTimeout(() => setCopiedTagId((v) => (v === f.id ? null : v)), 2000)
                              })
                            }}
                          >
                            {copiedTagId === f.id ? 'コピーしました' : 'タグコードをコピー'}
                          </button>
                          <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => void duplicate(f)}>コピー</button>
                          <button type="button" className="block w-full px-3 py-1.5 text-left text-[#e5451f] hover:bg-[#f1f1f4]" onClick={() => void remove(f)}>削除</button>
                        </Popover>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex justify-end gap-1 text-sm">
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="h-8 w-8 rounded border border-[#cacace] disabled:opacity-40">&lt;</button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => setPage(n)} className={`h-8 w-8 rounded border ${n === page ? 'border-[#069e04] bg-[#069e04] font-bold text-white' : 'border-[#cacace]'}`}>{n}</button>
              ))}
              <button type="button" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)} className="h-8 w-8 rounded border border-[#cacace] disabled:opacity-40">&gt;</button>
            </div>
          )}
        </div>
      </div>

      <Dialog.Root open={folderDialogOpen} onOpenChange={(open) => { if (!open && !savingFolder) setFolderDialogOpen(false) }}>
        <Dialog className="w-full max-w-sm p-5">
          <Dialog.Title>{editingFolderId ? 'フォルダ名を変更' : '新しいフォルダ'}</Dialog.Title>
          <Input label="フォルダ名" autoFocus value={draftFolderName} onValueChange={setDraftFolderName} className="mt-4" />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFolderDialogOpen(false)} disabled={savingFolder}>キャンセル</Button>
            <Button type="button" variant="primary" loading={savingFolder} onClick={() => void saveFolder()} disabled={!draftFolderName.trim()}>保存</Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}
