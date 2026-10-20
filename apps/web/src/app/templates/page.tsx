'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import Header from '@/components/layout/header'
import { DragHandle, FolderRow, Popover, btnBase, btnGreen, btnWhite } from '@/components/lstep/ui'
import { TaggedText } from '@/components/forms/tagged-text'
import LinePreview from '@/components/templates/line-preview'
import TestSendDialog from '@/components/templates/test-send-dialog'
import { Modal } from '@/components/ui/modal'
import { useDialogs } from '@/components/ui/dialogs'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { errorText } from '@/lib/error-text'
import { previewMessagesOf } from '@/lib/template-message'
import type { PreviewMessage } from '@/lib/template-message'
import type { TemplateFolderItem, TemplateSummary } from '@/lib/template-library'

const UNFILED = 'none'
const PAGE_SIZE = 30
const GRID = 'grid-cols-[1.5rem_2rem_minmax(0,16rem)_7.5rem_minmax(0,1fr)_6.5rem_9rem_2rem]'
const fmtDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '/')

export default function TemplatesPage() {
  const router = useRouter()
  const dialogs = useDialogs()
  const { selectedAccount } = useAccount()
  const accountId = selectedAccount?.id ?? ''

  const [folders, setFolders] = useState<TemplateFolderItem[]>([])
  const [unfiledCount, setUnfiledCount] = useState(0)
  const [folder, setFolder] = useState<string>(UNFILED)
  const [items, setItems] = useState<TemplateSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const [newMenu, setNewMenu] = useState(false)
  const [folderMenu, setFolderMenu] = useState(false)
  const [moveMenu, setMoveMenu] = useState(false)

  const [folderDialog, setFolderDialog] = useState<null | { id: string | null; name: string }>(null)
  const [packDialog, setPackDialog] = useState<null | { name: string }>(null)
  const [renameDialog, setRenameDialog] = useState<null | { id: string; name: string }>(null)
  const [preview, setPreview] = useState<null | { name: string; messages: PreviewMessage[] }>(null)
  const [testTarget, setTestTarget] = useState<TemplateSummary | null>(null)
  const [sortOpen, setSortOpen] = useState(false)
  const [stats, setStats] = useState<null | { name: string; answered: number; panels: Array<{ title: string; choices: Array<{ choice: number; label: string; friends: number; taps: number }> }> }>(null)
  const [sortItems, setSortItems] = useState<TemplateSummary[]>([])
  const [busy, setBusy] = useState(false)
  const dragFolder = useRef<string | null>(null)
  const dragRow = useRef<string | null>(null)

  // 一覧から戻ったとき、直前のフォルダを開く
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('folder')
    if (f) setFolder(f)
  }, [])
  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1) }, 250)
    return () => clearTimeout(t)
  }, [search])

  const loadFolders = useCallback(async () => {
    if (!accountId) return
    const r = await api.tpl.folders(accountId).catch(() => null)
    if (r?.success) { setFolders(r.data.folders); setUnfiledCount(r.data.unfiledCount) }
  }, [accountId])

  const loadItems = useCallback(async () => {
    if (!accountId) return
    try {
      const r = await api.tpl.items({ lineAccountId: accountId, folder: q ? 'all' : folder, q, page, pageSize: PAGE_SIZE })
      if (r.success) { setItems(r.data.items); setTotal(r.data.total); setError('') }
    } catch (err) {
      setError(errorText(err, '読み込みに失敗しました'))
    } finally {
      setLoading(false)
    }
  }, [accountId, folder, q, page])

  useEffect(() => { void loadFolders() }, [loadFolders])
  useEffect(() => { void loadItems() }, [loadItems])
  useEffect(() => { setChecked(new Set()); setPage(1) }, [folder])

  const refresh = useCallback(async () => { await Promise.all([loadFolders(), loadItems()]) }, [loadFolders, loadItems])
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = folders.find((f) => f.id === folder) ?? null
  const allChecked = items.length > 0 && items.every((i) => checked.has(i.id))
  const editHref = (t: TemplateSummary) => (t.kind === 'pack' ? `/templates/pack?id=${t.id}` : `/templates/edit?id=${t.id}`)
  const countOf = useMemo(() => (id: string) => (id === UNFILED ? unfiledCount : folders.find((f) => f.id === id)?.count ?? 0), [folders, unfiledCount])

  // ── フォルダ ─────────────────────────────────────────────
  async function saveFolder() {
    if (!folderDialog || !folderDialog.name.trim()) return
    setBusy(true)
    try {
      if (folderDialog.id) await api.tpl.renameFolder(folderDialog.id, folderDialog.name.trim())
      else {
        const r = await api.tpl.createFolder(accountId, folderDialog.name.trim())
        if (r.success) setFolder(r.data.id)
      }
      setFolderDialog(null)
      await loadFolders()
    } finally {
      setBusy(false)
    }
  }
  async function deleteFolder() {
    if (!current) return
    setFolderMenu(false)
    if (!await dialogs.confirm(`フォルダ「${current.name}」を削除しますか?\n中のテンプレートは「未分類」に移動します。`, { okLabel: '削除', danger: true })) return
    await api.tpl.deleteFolder(current.id)
    setFolder(UNFILED)
    await refresh()
  }
  async function dropFolder(targetId: string) {
    const from = dragFolder.current
    dragFolder.current = null
    if (!from || from === targetId) return
    const ids = folders.map((f) => f.id)
    ids.splice(ids.indexOf(from), 1)
    ids.splice(ids.indexOf(targetId), 0, from)
    setFolders(ids.map((id) => folders.find((f) => f.id === id)!))
    await api.tpl.reorderFolders(accountId, ids)
  }
  async function dropRowOnFolder(folderId: string | null) {
    const id = dragRow.current
    dragRow.current = null
    if (!id) return
    const ids = checked.has(id) ? [...checked] : [id]
    await api.tpl.move(ids, folderId)
    setChecked(new Set())
    await refresh()
  }

  // ── テンプレート ─────────────────────────────────────────
  async function createPack() {
    if (!packDialog || !packDialog.name.trim()) return
    setBusy(true)
    try {
      const r = await api.tpl.create({ lineAccountId: accountId, name: packDialog.name.trim(), folderId: folder === UNFILED ? null : folder, kind: 'pack', editorType: 'pack' })
      if (r.success) router.push(`/templates/pack?id=${r.data.id}`)
    } catch (err) {
      setError(errorText(err, 'パックを作成できませんでした'))
    } finally {
      setBusy(false)
    }
  }
  async function remove(targets: TemplateSummary[]) {
    setRowMenu(null)
    if (targets.length === 0) return
    const msg = targets.length === 1 ? `テンプレート「${targets[0].name}」を削除しますか?` : `選択した${targets.length}件のテンプレートを削除しますか?`
    if (!await dialogs.confirm(`${msg}\nパックに入っているものは、パックからも外れます。`, { okLabel: '削除', danger: true })) return
    await api.tpl.removeMany(targets.map((t) => t.id))
    setChecked(new Set())
    await refresh()
  }
  async function copy(t: TemplateSummary) {
    setRowMenu(null)
    await api.tpl.copy(t.id)
    await refresh()
  }
  async function showPreview(t: TemplateSummary) {
    const r = await api.tpl.item(t.id).catch(() => null)
    if (r?.success) setPreview({ name: t.name, messages: previewMessagesOf(r.data.messageType, r.data.messageContent) })
  }
  async function showStats(t: TemplateSummary) {
    setRowMenu(null)
    const r = await api.tpl.stats(t.id).catch(() => null)
    if (r?.success) setStats({ name: t.name, answered: r.data.answeredFriends, panels: r.data.panels })
  }
  function openWindow(t: TemplateSummary) {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
    window.open(`${base}/templates/preview?id=${t.id}`, '_blank', 'width=420,height=720')
  }
  async function openSort() {
    setSortOpen(true)
    const r = await api.tpl.items({ lineAccountId: accountId, folder: folder === UNFILED ? UNFILED : folder, pageSize: 200 }).catch(() => null)
    if (r?.success) setSortItems(r.data.items)
  }

  if (!selectedAccount) return <p className="p-6 text-sm text-[#757578]">アカウントを選択してください。</p>

  const newFlexHref = `/templates/new?kind=flex${folder !== UNFILED ? `&folder=${folder}` : ''}`
  const newStdHref = `/templates/new?kind=standard${folder !== UNFILED ? `&folder=${folder}` : ''}`

  return (
    <div>
      <Header title="テンプレート" />
      {error ? <p className="mb-3 text-sm text-[#e5451f]">{error}</p> : null}

      <div className="flex gap-5">
        {/* ── 左: フォルダ ── */}
        <div className="w-[15rem] flex-shrink-0">
          <button type="button" className={btnWhite} onClick={() => setFolderDialog({ id: null, name: '' })}>
            <span className="text-base leading-none">＋</span> 新しいフォルダ
          </button>
          <div className="mt-3 max-h-[calc(100vh-15rem)] overflow-y-auto bg-[#f1f1f4] text-sm">
            <div onDragOver={(e) => e.preventDefault()} onDrop={() => void dropRowOnFolder(null)}>
              <FolderRow label="未分類" count={countOf(UNFILED)} selected={folder === UNFILED && !q} onSelect={() => { setSearch(''); setFolder(UNFILED) }} />
            </div>
            {folders.map((f) => (
              <div key={f.id} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragRow.current) void dropRowOnFolder(f.id) }}>
                <FolderRow
                  label={f.name}
                  count={f.count}
                  selected={folder === f.id && !q}
                  draggable
                  onSelect={() => { setSearch(''); setFolder(f.id) }}
                  onDragStart={() => { dragFolder.current = f.id }}
                  onDrop={() => { if (dragFolder.current) void dropFolder(f.id) }}
                  menu={
                    folder === f.id ? (
                      <div className="relative">
                        <button type="button" aria-label="フォルダメニュー" className="px-1.5 text-base font-bold" onClick={(e) => { e.stopPropagation(); setFolderMenu((v) => !v) }}>⋮</button>
                        <Popover open={folderMenu} onClose={() => setFolderMenu(false)}>
                          <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => { setFolderMenu(false); setFolderDialog({ id: f.id, name: f.name }) }}>名前を変更</button>
                          <button type="button" className="block w-full px-3 py-1.5 text-left text-[#e5451f] hover:bg-[#f1f1f4]" onClick={() => void deleteFolder()}>削除</button>
                        </Popover>
                      </div>
                    ) : null
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── 右: 一覧 ── */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button type="button" className={btnGreen} onClick={() => setNewMenu((v) => !v)}>
                  <span className="text-base leading-none">＋</span> 新しいテンプレート ▾
                </button>
                <Popover open={newMenu} onClose={() => setNewMenu(false)} align="left">
                  <Link href={newStdHref} className="block whitespace-nowrap px-3 py-1.5 hover:bg-[#f1f1f4]">標準メッセージ</Link>
                  <Link href={newFlexHref} className="block whitespace-nowrap px-3 py-1.5 hover:bg-[#f1f1f4]">フレックスメッセージ</Link>
                </Popover>
              </div>
              <button type="button" className={btnWhite} onClick={() => setPackDialog({ name: '' })}><span className="text-base leading-none">＋</span> 新しいパック</button>
              <Link href="/templates/drafts" className={btnWhite}>下書きを開く</Link>
              {checked.size > 0 ? (
                <>
                  <div className="relative">
                    <button type="button" className={btnWhite} onClick={() => setMoveMenu((v) => !v)}>選択した{checked.size}件を移動 ▾</button>
                    <Popover open={moveMenu} onClose={() => setMoveMenu(false)} align="left">
                      <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={async () => { setMoveMenu(false); await api.tpl.move([...checked], null); setChecked(new Set()); await refresh() }}>未分類</button>
                      {folders.map((f) => (
                        <button key={f.id} type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={async () => { setMoveMenu(false); await api.tpl.move([...checked], f.id); setChecked(new Set()); await refresh() }}>{f.name}</button>
                      ))}
                    </Popover>
                  </div>
                  <button type="button" className={`${btnBase} border border-[#e5451f] bg-white text-[#e5451f] hover:bg-[#fff3f0]`} onClick={() => void remove(items.filter((i) => checked.has(i.id)))}>
                    選択した{checked.size}件を削除
                  </button>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={btnWhite} disabled={!!q} onClick={() => void openSort()}><span aria-hidden="true">⇅</span> 並び替え</button>
              <div className="flex">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="検索" className="h-9 w-44 rounded-l border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]" aria-label="テンプレートを検索" />
                <span className="flex h-9 w-10 items-center justify-center rounded-r bg-[#757578] text-white" aria-hidden="true">⌕</span>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <div className={`grid ${GRID} items-center gap-x-2 bg-[#f1f1f4] px-2 text-xs text-[#757578]`} style={{ height: 40 }}>
              <span />
              <input type="checkbox" aria-label="すべて選択" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
              <span>テンプレート名</span>
              <span>種類</span>
              <span>内容</span>
              <span>登録日</span>
              <span />
              <span />
            </div>

            {loading ? (
              <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">読み込み中...</p>
            ) : items.length === 0 ? (
              <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">{q ? '該当するテンプレートがありません' : 'テンプレートがありません'}</p>
            ) : (
              items.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={() => { dragRow.current = t.id }}
                  className={`item-enter grid ${GRID} items-center gap-x-2 border-b border-[#e3e3e6] bg-white px-2 text-sm transition-colors duration-150 hover:bg-[#fafafb]`}
                  style={{ height: 47 }}
                >
                  <DragHandle />
                  <input
                    type="checkbox"
                    aria-label={`${t.name}を選択`}
                    checked={checked.has(t.id)}
                    onChange={(e) => setChecked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n })}
                  />
                  <Link href={editHref(t)} className="truncate font-bold text-[#2b7bb9] underline">{t.name}</Link>
                  <span className="truncate"><span className="rounded bg-[#e3e3e6] px-2 py-0.5 text-[10px] text-[#414143]">{t.typeLabel}</span></span>
                  <span className="truncate text-xs text-[#757578]">{t.kind === 'pack' ? `${t.packCount ?? 0}通` : <TaggedText text={t.summary} />}</span>
                  <span className="text-xs text-[#757578]">{fmtDate(t.createdAt)}</span>
                  <span className="flex gap-1 text-xs">
                    <button type="button" onClick={() => void showPreview(t)} className="h-7 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9]">プレビュー</button>
                    <button type="button" onClick={() => openWindow(t)} className="h-7 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9]">別窓</button>
                  </span>
                  <div className="relative">
                    <button type="button" aria-label="メニュー" className="px-1.5 text-base font-bold" onClick={() => setRowMenu((v) => (v === t.id ? null : t.id))}>⋮</button>
                    <Popover open={rowMenu === t.id} onClose={() => setRowMenu(null)}>
                      <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => void copy(t)}>コピー</button>
                      <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => { setRowMenu(null); setTestTarget(t) }}>テスト送信</button>
                      <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => { setRowMenu(null); setRenameDialog({ id: t.id, name: t.name }) }}>名前を変更</button>
                      {['question', 'carousel', 'flex'].includes(t.editorType ?? '') ? (
                        <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => void showStats(t)}>回答率</button>
                      ) : null}
                      <Link href={`/broadcasts?template=${t.id}`} className="block whitespace-nowrap px-3 py-1.5 hover:bg-[#f1f1f4]">一斉配信を作成</Link>
                      <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-[#e5451f] hover:bg-[#f1f1f4]" onClick={() => void remove([t])}>削除</button>
                    </Popover>
                  </div>
                </div>
              ))
            )}
          </div>

          {pageCount > 1 ? (
            <div className="mt-4 flex justify-end gap-1 text-sm">
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="h-8 w-8 rounded border border-[#cacace] disabled:opacity-40">&lt;</button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => setPage(n)} className={`h-8 w-8 rounded border ${n === page ? 'border-[#069e04] bg-[#069e04] font-bold text-white' : 'border-[#cacace]'}`}>{n}</button>
              ))}
              <button type="button" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)} className="h-8 w-8 rounded border border-[#cacace] disabled:opacity-40">&gt;</button>
            </div>
          ) : null}
        </div>
      </div>

      {/* フォルダ作成・名前変更 */}
      <Dialog.Root open={!!folderDialog} onOpenChange={(o) => { if (!o && !busy) setFolderDialog(null) }}>
        <Dialog className="w-full max-w-sm p-5">
          <Dialog.Title>{folderDialog?.id ? 'フォルダ名を変更' : '新しいフォルダ'}</Dialog.Title>
          <Input label="フォルダ名" autoFocus value={folderDialog?.name ?? ''} onValueChange={(name) => setFolderDialog((d) => (d ? { ...d, name } : d))} className="mt-4" />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFolderDialog(null)} disabled={busy}>キャンセル</Button>
            <Button type="button" variant="primary" loading={busy} onClick={() => void saveFolder()} disabled={!folderDialog?.name.trim()}>保存</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      {/* 新しいパック */}
      <Dialog.Root open={!!packDialog} onOpenChange={(o) => { if (!o && !busy) setPackDialog(null) }}>
        <Dialog className="w-full max-w-sm p-5">
          <Dialog.Title>新しいパック</Dialog.Title>
          <Input label="テンプレート名" autoFocus value={packDialog?.name ?? ''} onValueChange={(name) => setPackDialog({ name })} className="mt-4" />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPackDialog(null)} disabled={busy}>キャンセル</Button>
            <Button type="button" variant="primary" loading={busy} onClick={() => void createPack()} disabled={!packDialog?.name.trim()}>登録</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      {/* 名前を変更 */}
      <Dialog.Root open={!!renameDialog} onOpenChange={(o) => { if (!o && !busy) setRenameDialog(null) }}>
        <Dialog className="w-full max-w-sm p-5">
          <Dialog.Title>名前を変更</Dialog.Title>
          <Input label="テンプレート名" autoFocus value={renameDialog?.name ?? ''} onValueChange={(name) => setRenameDialog((d) => (d ? { ...d, name } : d))} className="mt-4" />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRenameDialog(null)} disabled={busy}>キャンセル</Button>
            <Button
              type="button"
              variant="primary"
              loading={busy}
              disabled={!renameDialog?.name.trim()}
              onClick={async () => {
                if (!renameDialog) return
                setBusy(true)
                try { await api.tpl.update(renameDialog.id, { name: renameDialog.name.trim() }); setRenameDialog(null); await loadItems() } finally { setBusy(false) }
              }}
            >
              保存
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>

      {/* プレビュー */}
      <Modal open={!!preview} onClose={() => setPreview(null)} maxWidthClass="max-w-sm" align="center">
        <div className="flex items-center justify-between border-b border-[#e3e3e6] px-5 py-3">
          <h2 className="truncate text-sm font-bold">メッセージ詳細</h2>
          <button type="button" onClick={() => setPreview(null)} aria-label="閉じる" className="text-xl leading-none">×</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4"><LinePreview messages={preview?.messages ?? []} /></div>
        <div className="flex justify-end border-t border-[#e3e3e6] px-5 py-3">
          <button type="button" onClick={() => setPreview(null)} className="h-9 w-24 rounded border border-[#cacace] text-xs hover:bg-[#f7f7f9]">閉じる</button>
        </div>
      </Modal>

      {/* 回答率 */}
      <Modal open={!!stats} onClose={() => setStats(null)} maxWidthClass="max-w-lg" align="center">
        <div className="flex items-center justify-between border-b border-[#e3e3e6] px-5 py-3">
          <h2 className="truncate text-sm font-bold">回答率(回答した人 {stats?.answered ?? 0}人)</h2>
          <button type="button" onClick={() => setStats(null)} aria-label="閉じる" className="text-xl leading-none">×</button>
        </div>
        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
          {(stats?.panels ?? []).map((p, pi) => {
            const sum = p.choices.reduce((a, c) => a + c.friends, 0)
            const colors = ['#069e04', '#2b7bb9', '#f2a100', '#e5451f', '#8e5bd0']
            return (
              <div key={pi}>
                <div className="mb-1 text-xs font-bold">{p.title}</div>
                <div className="flex h-5 overflow-hidden rounded bg-[#f1f1f4]">
                  {p.choices.map((c, ci) => (sum > 0 && c.friends > 0 ? <div key={c.choice} style={{ width: `${(c.friends / sum) * 100}%`, background: colors[ci % colors.length] }} /> : null))}
                </div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {p.choices.map((c, ci) => (
                    <li key={c.choice} className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colors[ci % colors.length] }} />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      <span className="tabular-nums text-[#757578]">{c.friends}人 ({sum > 0 ? Math.round((c.friends / sum) * 100) : 0}%) / {c.taps}回</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          {stats && stats.panels.length === 0 ? <p className="text-sm text-[#757578]">集計できるボタンがありません</p> : null}
        </div>
      </Modal>

      {/* 並び替え */}
      <Modal open={sortOpen} onClose={() => setSortOpen(false)} maxWidthClass="max-w-lg" align="center">
        <div className="flex items-center justify-between border-b border-[#e3e3e6] px-5 py-3">
          <h2 className="text-sm font-bold">並び替え</h2>
          <button type="button" onClick={() => setSortOpen(false)} aria-label="閉じる" className="text-xl leading-none">×</button>
        </div>
        <ul className="max-h-[60vh] divide-y divide-[#e3e3e6] overflow-y-auto">
          {sortItems.map((t, i) => (
            <li
              key={t.id}
              draggable
              onDragStart={() => { dragRow.current = t.id }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const from = dragRow.current
                dragRow.current = null
                if (!from || from === t.id) return
                setSortItems((prev) => {
                  const fromIdx = prev.findIndex((x) => x.id === from)
                  const toIdx = prev.findIndex((x) => x.id === t.id)
                  const next = [...prev]
                  const [moving] = next.splice(fromIdx, 1)
                  next.splice(toIdx, 0, moving)
                  return next
                })
              }}
              className="flex cursor-grab items-center gap-3 bg-white px-5 py-2 text-sm"
            >
              <DragHandle />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <span className="flex-shrink-0 rounded bg-[#f1f1f4] px-2 py-0.5 text-[10px] text-[#757578]">{t.typeLabel}</span>
            </li>
          ))}
          {sortItems.length === 0 ? <li className="py-6 text-center text-sm text-[#757578]">テンプレートがありません</li> : null}
        </ul>
        <div className="flex justify-end gap-2 border-t border-[#e3e3e6] px-5 py-3 text-xs">
          <button type="button" onClick={() => setSortOpen(false)} className="h-9 w-24 rounded border border-[#cacace] hover:bg-[#f7f7f9]">キャンセル</button>
          <button type="button" onClick={async () => { await api.tpl.reorder(sortItems.map((t) => t.id)); setSortOpen(false); await loadItems() }} className="h-9 w-24 rounded bg-[#069e04] font-bold text-white hover:bg-[#058503]">保存</button>
        </div>
      </Modal>

      <TestSendDialog
        open={!!testTarget}
        accountId={accountId}
        onClose={() => setTestTarget(null)}
        onSend={async (friendIds) => {
          if (!testTarget) throw new Error('送信先がありません')
          const r = await api.tpl.testSendSaved(testTarget.id, { lineAccountId: accountId, friendIds })
          if (!r.success) throw new Error('送信できませんでした')
          return r.data
        }}
      />
    </div>
  )
}
