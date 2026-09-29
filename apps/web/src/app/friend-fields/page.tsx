'use client'

import { useDialogs } from '@/components/ui/dialogs'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { Button } from '@cloudflare/kumo/components/button'
import { FIELD_TYPE_LABEL, type FriendFieldType } from '@/lib/friend-field-types'
import { Popover, DragHandle, Star, FolderRow, btnBase, btnWhite, btnGreen } from '@/components/lstep/ui'

interface Folder {
  id: string
  name: string
  displayOrder: number
}

interface Definition {
  id: string
  folderId: string | null
  fieldKey: string
  label: string
  fieldType: FriendFieldType
  options: string[]
  defaultValue: string | null
  displayOrder: number
  isFavorite: boolean
  friendCount?: number
}

const UNFILED = '__unfiled__'
const PAGE_SIZE = 30

type SortMode = 'manual' | 'name' | 'count'
const SORT_LABEL: Record<SortMode, string> = {
  manual: '手動(ドラッグで変更)',
  name: '名前順',
  count: '友だち人数が多い順',
}

export default function FriendFieldsPage() {
  const dialogs = useDialogs()
  const [folders, setFolders] = useState<Folder[]>([])
  const [definitions, setDefinitions] = useState<Definition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string>(UNFILED)
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('manual')
  const [sortOpen, setSortOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const [folderMenuOpen, setFolderMenuOpen] = useState(false)

  // フォルダ作成/名前変更ダイアログ
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [draftFolderName, setDraftFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)

  // ドラッグ&ドロップ
  const dragFolderId = useRef<string | null>(null)
  const dragDefId = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [fRes, dRes] = await Promise.all([
        fetchApi<{ success: boolean; data: Folder[] }>('/api/friend-fields/folders'),
        fetchApi<{ success: boolean; data: Definition[] }>('/api/friend-fields/definitions?withCounts=true'),
      ])
      if (fRes.success) setFolders(fRes.data)
      if (dRes.success) setDefinitions(dRes.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setPage(1); setChecked(new Set()) }, [selectedFolderId, search, sortMode])

  // 登録画面から戻ったときに、直前に開いていたフォルダを復元する
  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get('group')
    if (g) setSelectedFolderId(g)
  }, [])

  const countByFolder = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of definitions) {
      const key = d.folderId ?? UNFILED
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }, [definitions])

  const visible = useMemo(() => {
    let list = definitions.filter((d) => (d.folderId ?? UNFILED) === selectedFolderId)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((d) => d.label.toLowerCase().includes(q))
    if (sortMode === 'name') list = [...list].sort((a, b) => a.label.localeCompare(b.label, 'ja'))
    if (sortMode === 'count') list = [...list].sort((a, b) => (b.friendCount ?? 0) - (a.friendCount ?? 0))
    return list
  }, [definitions, selectedFolderId, search, sortMode])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null
  const dragEnabled = sortMode === 'manual' && !search.trim()

  // ── フォルダ操作 ─────────────────────────────────────────
  function openNewFolder() {
    setEditingFolderId(null)
    setDraftFolderName('')
    setFolderDialogOpen(true)
  }
  function openRenameFolder() {
    if (!selectedFolder) return
    setEditingFolderId(selectedFolder.id)
    setDraftFolderName(selectedFolder.name)
    setFolderMenuOpen(false)
    setFolderDialogOpen(true)
  }
  async function saveFolder() {
    const name = draftFolderName.trim()
    if (!name) return
    setSavingFolder(true)
    try {
      if (editingFolderId) {
        await fetchApi(`/api/friend-fields/folders/${editingFolderId}`, { method: 'PUT', body: JSON.stringify({ name }) })
      } else {
        const res = await fetchApi<{ success: boolean; data: Folder }>('/api/friend-fields/folders', {
          method: 'POST',
          body: JSON.stringify({ name, displayOrder: folders.length }),
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
    if (!await dialogs.confirm(`フォルダ「${selectedFolder.name}」を削除しますか?\n中の友だち情報欄は「未分類」に移動します。`)) return
    await fetchApi(`/api/friend-fields/folders/${selectedFolder.id}`, { method: 'DELETE' })
    setSelectedFolderId(UNFILED)
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
    await fetchApi('/api/friend-fields/folders/reorder', { method: 'POST', body: JSON.stringify({ ids }) })
  }

  // ── 項目操作 ─────────────────────────────────────────────
  async function toggleFavorite(d: Definition) {
    setDefinitions((prev) => prev.map((x) => (x.id === d.id ? { ...x, isFavorite: !x.isFavorite } : x)))
    await fetchApi(`/api/friend-fields/definitions/${d.id}`, { method: 'PUT', body: JSON.stringify({ isFavorite: !d.isFavorite }) })
  }
  async function copyDefinition(d: Definition) {
    setRowMenuId(null)
    await fetchApi(`/api/friend-fields/definitions/${d.id}/copy`, { method: 'POST' })
    await load()
  }
  async function deleteDefinitions(targets: Definition[]) {
    setRowMenuId(null)
    if (targets.length === 0) return
    const msg =
      targets.length === 1
        ? `友だち情報欄「${targets[0].label}」を削除しますか?`
        : `選択した${targets.length}件の友だち情報欄を削除しますか?`
    if (!await dialogs.confirm(`${msg}\n(友だちに登録済みの値はそのまま残ります)`)) return
    for (const t of targets) {
      await fetchApi(`/api/friend-fields/definitions/${t.id}`, { method: 'DELETE' })
    }
    setChecked(new Set())
    await load()
  }
  async function dropDefinition(targetId: string) {
    const from = dragDefId.current
    dragDefId.current = null
    if (!from || from === targetId || !dragEnabled) return
    const ids = visible.map((d) => d.id)
    ids.splice(ids.indexOf(from), 1)
    ids.splice(ids.indexOf(targetId), 0, from)
    // 同じフォルダ内の並び順だけを更新する(他フォルダの順序には触れない)
    setDefinitions((prev) => {
      const others = prev.filter((d) => (d.folderId ?? UNFILED) !== selectedFolderId)
      const reordered = ids.map((id, i) => ({ ...prev.find((d) => d.id === id)!, displayOrder: i }))
      return [...others, ...reordered].sort((a, b) => a.displayOrder - b.displayOrder)
    })
    await fetchApi('/api/friend-fields/definitions/reorder', { method: 'POST', body: JSON.stringify({ ids }) })
  }

  const newHref = `/friend-fields/edit?group=${selectedFolderId === UNFILED ? '' : selectedFolderId}`
  const allChecked = pageItems.length > 0 && pageItems.every((d) => checked.has(d.id))

  return (
    <div>
      <Header title="友だち情報欄" description="「メールアドレス」など、友だちごとに個別で登録したい情報を管理できます。" />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="flex gap-5">
        {/* ── 左: フォルダ ── */}
        <div className="w-[15rem] flex-shrink-0">
          <button type="button" className={btnWhite} onClick={openNewFolder}>
            <span className="text-base leading-none">＋</span> 新しいフォルダ
          </button>
          <div className="mt-3 max-h-[calc(100vh-15rem)] overflow-y-auto bg-[#f1f1f4] text-sm">
            <FolderRow
              label="未分類"
              count={countByFolder.get(UNFILED) ?? 0}
              selected={selectedFolderId === UNFILED}
              onSelect={() => setSelectedFolderId(UNFILED)}
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
                          <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={openRenameFolder}>名前を変更</button>
                          <button type="button" className="block w-full px-3 py-1.5 text-left text-[#e5451f] hover:bg-[#f1f1f4]" onClick={() => void deleteFolder()}>削除</button>
                        </Popover>
                    </div>
                  ) : null
                }
              />
            ))}
          </div>
        </div>

        {/* ── 右: 一覧 ── */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link href={newHref} className={btnGreen}>
                <span className="text-base leading-none">＋</span> 新しい友だち情報欄
              </Link>
              {checked.size > 0 && (
                <button
                  type="button"
                  className={`${btnBase} border border-[#e5451f] bg-white text-[#e5451f] hover:bg-[#fff3f0]`}
                  onClick={() => void deleteDefinitions(definitions.filter((d) => checked.has(d.id)))}
                >
                  選択した{checked.size}件を削除
                </button>
              )}
            </div>
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
            <div className="grid grid-cols-[2.5rem_2rem_1fr_7rem_10rem_7rem_5.5rem] items-center bg-[#f1f1f4] px-2 text-xs text-[#757578]" style={{ height: 40 }}>
              <span />
              <input
                type="checkbox"
                aria-label="すべて選択"
                checked={allChecked}
                onChange={(e) => setChecked(e.target.checked ? new Set(pageItems.map((d) => d.id)) : new Set())}
              />
              <span>友だち情報欄名</span>
              <span>種別</span>
              <span>既定値</span>
              <span className="text-right">友だち人数</span>
              <span />
            </div>

            {loading ? (
              <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">読み込み中...</p>
            ) : pageItems.length === 0 ? (
              <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">
                {search.trim() ? '該当する友だち情報欄がありません' : '友だち情報欄が作成されていません'}
              </p>
            ) : (
              pageItems.map((d) => (
                <div
                  key={d.id}
                  draggable={dragEnabled}
                  onDragStart={() => { dragDefId.current = d.id }}
                  onDragOver={(e) => { if (dragEnabled) e.preventDefault() }}
                  onDrop={() => void dropDefinition(d.id)}
                  className="grid grid-cols-[2.5rem_2rem_1fr_7rem_10rem_7rem_5.5rem] items-center border-b border-[#e3e3e6] bg-white px-2 text-sm hover:bg-[#fafafb]"
                  style={{ height: 47 }}
                >
                  <span className="pl-1">{dragEnabled ? <DragHandle /> : null}</span>
                  <input
                    type="checkbox"
                    aria-label={`${d.label}を選択`}
                    checked={checked.has(d.id)}
                    onChange={(e) => {
                      setChecked((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(d.id)
                        else next.delete(d.id)
                        return next
                      })
                    }}
                  />
                  <Link href={`/friend-fields/edit?id=${d.id}`} className="truncate pr-3 font-bold text-[#2b7bb9] underline">
                    {d.label}
                  </Link>
                  <span>{FIELD_TYPE_LABEL[d.fieldType] ?? '標準'}</span>
                  <span className="truncate pr-3">{d.defaultValue || '-'}</span>
                  <span className="text-right text-[#2b7bb9] underline">{(d.friendCount ?? 0).toLocaleString('ja-JP')}人</span>
                  <div className="relative flex items-center justify-end gap-1">
                    <button type="button" aria-label="お気に入り" onClick={() => void toggleFavorite(d)} className="p-1">
                      <Star filled={d.isFavorite} />
                    </button>
                    <button type="button" aria-label="メニュー" className="px-1.5 text-base font-bold" onClick={() => setRowMenuId((v) => (v === d.id ? null : d.id))}>⋮</button>
                    <Popover open={rowMenuId === d.id} onClose={() => setRowMenuId(null)}>
                        <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => void copyDefinition(d)}>コピー</button>
                        <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => void deleteDefinitions([d])}>削除</button>
                      </Popover>
                  </div>
                </div>
              ))
            )}
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex justify-end gap-1 text-sm">
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="h-8 w-8 rounded border border-[#cacace] disabled:opacity-40">&lt;</button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  className={`h-8 w-8 rounded border ${n === page ? 'border-[#069e04] bg-[#069e04] font-bold text-white' : 'border-[#cacace]'}`}
                >
                  {n}
                </button>
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
