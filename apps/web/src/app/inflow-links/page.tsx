'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { Button } from '@cloudflare/kumo/components/button'
import Header from '@/components/layout/header'
import { useDialogs } from '@/components/ui/dialogs'
import { Popover, DragHandle, FolderRow, btnBase, btnWhite, btnGreen } from '@/components/lstep/ui'
import { useAccount } from '@/contexts/account-context'
import { useActionLookups } from '@/components/friend-add/use-action-lookups'
import { api } from '@/lib/api'
import { errorText } from '@/lib/error-text'
import { describeAction } from '@/lib/friend-add-actions'
import type { InflowFolder, InflowRoute } from '@/lib/inflow-routes'
import RouteQrDialog from './_components/route-qr-dialog'

const UNFILED = 'none'
const PAGE_SIZE = 50

/** Lステップの「流入経路分析」と同じ一覧: 左にフォルダ、右に流入経路(URL・QR、アクション、有効期間、集計) */
export default function InflowRoutesPage() {
  const dialogs = useDialogs()
  const { selectedAccountId } = useAccount()
  const accountId = selectedAccountId ?? ''
  const lookups = useActionLookups(accountId)

  const [folders, setFolders] = useState<InflowFolder[]>([])
  const [unfiledCount, setUnfiledCount] = useState(0)
  const [routes, setRoutes] = useState<InflowRoute[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [folder, setFolder] = useState<string>(UNFILED)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const [folderMenuOpen, setFolderMenuOpen] = useState(false)
  const [qrRoute, setQrRoute] = useState<InflowRoute | null>(null)

  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [draftFolderName, setDraftFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const dragFolderId = useRef<string | null>(null)
  const dragRouteId = useRef<string | null>(null)

  const loadFolders = useCallback(async () => {
    if (!accountId) return
    const res = await api.inflow.folders(accountId)
    if (res.success) {
      setFolders(res.data.folders)
      setUnfiledCount(res.data.unfiledCount)
    }
  }, [accountId])

  const loadRoutes = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.inflow.routes({ lineAccountId: accountId, folder: query ? 'all' : folder, q: query, page, pageSize: PAGE_SIZE })
      if (res.success) {
        setRoutes(res.data.items)
        setTotal(res.data.total)
      }
    } catch (err) {
      setError(errorText(err, '読み込めませんでした。時間をおいてもう一度お試しください'))
    } finally {
      setLoading(false)
    }
  }, [accountId, folder, query, page])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])
  useEffect(() => {
    void loadRoutes()
  }, [loadRoutes])
  // アカウントを切り替えたら、未分類に戻る
  useEffect(() => {
    setFolder(UNFILED)
    setSearch('')
    setQuery('')
    setPage(1)
  }, [accountId])
  useEffect(() => {
    setPage(1)
  }, [folder, query])
  // 登録画面から戻ったときに、直前に開いていたフォルダを復元する
  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get('group')
    if (g) setFolder(g)
  }, [])

  const selectedFolder = folders.find((f) => f.id === folder) ?? null
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const dragEnabled = !query && total <= PAGE_SIZE
  const newHref = `/inflow-links/edit?group=${folder === UNFILED ? '' : folder}`

  // ── フォルダ操作 ──
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
    if (!name || !accountId) return
    setSavingFolder(true)
    try {
      if (editingFolderId) {
        await api.inflow.renameFolder(editingFolderId, name)
      } else {
        const res = await api.inflow.createFolder(accountId, name)
        if (res.success) setFolder(res.data.id)
      }
      setFolderDialogOpen(false)
      await loadFolders()
    } catch (err) {
      setError(errorText(err, 'フォルダを保存できませんでした'))
    } finally {
      setSavingFolder(false)
    }
  }
  async function deleteFolder() {
    if (!selectedFolder) return
    setFolderMenuOpen(false)
    if (!(await dialogs.confirm(`フォルダ「${selectedFolder.name}」を削除しますか?\n中の流入経路は「未分類」に移動します。`))) return
    try {
      await api.inflow.deleteFolder(selectedFolder.id)
      setFolder(UNFILED)
      await Promise.all([loadFolders(), loadRoutes()])
    } catch (err) {
      setError(errorText(err, 'フォルダを削除できませんでした'))
    }
  }
  async function dropFolder(targetId: string) {
    const from = dragFolderId.current
    dragFolderId.current = null
    if (!from || from === targetId) return
    const ids = folders.map((f) => f.id)
    ids.splice(ids.indexOf(from), 1)
    ids.splice(ids.indexOf(targetId), 0, from)
    setFolders(ids.map((id) => folders.find((f) => f.id === id)!))
    await api.inflow.reorderFolders(ids)
  }

  // ── 流入経路の操作 ──
  async function dropRoute(targetId: string) {
    const from = dragRouteId.current
    dragRouteId.current = null
    if (!from || from === targetId || !dragEnabled) return
    const ids = routes.map((r) => r.id)
    ids.splice(ids.indexOf(from), 1)
    ids.splice(ids.indexOf(targetId), 0, from)
    setRoutes(ids.map((id) => routes.find((r) => r.id === id)!))
    await api.inflow.reorderRoutes(ids)
  }
  async function copyRoute(r: InflowRoute) {
    setRowMenuId(null)
    try {
      await api.inflow.copyRoute(r.id)
      await Promise.all([loadFolders(), loadRoutes()])
    } catch (err) {
      setError(errorText(err, 'コピーを作成できませんでした'))
    }
  }
  async function moveRoute(r: InflowRoute, folderId: string | null) {
    setRowMenuId(null)
    try {
      await api.inflow.moveRoute(r.id, folderId)
      await Promise.all([loadFolders(), loadRoutes()])
    } catch (err) {
      setError(errorText(err, '移動できませんでした'))
    }
  }
  async function deleteRoute(r: InflowRoute) {
    setRowMenuId(null)
    if (!(await dialogs.confirm(`流入経路「${r.name}」を削除しますか?\nこの流入経路のURLは使えなくなります。`))) return
    try {
      await api.inflow.deleteRoute(r.id)
      await Promise.all([loadFolders(), loadRoutes()])
    } catch (err) {
      setError(errorText(err, '削除できませんでした'))
    }
  }

  const actionLines = useMemo(
    () => (r: InflowRoute) => {
      const lines = r.actions.map((a) => describeAction(a, lookups))
      if (r.scenarioId) lines.unshift(`シナリオ[${lookups.scenarios.find((s) => s.id === r.scenarioId)?.name ?? '未選択'}]を開始`)
      return lines
    },
    [lookups],
  )

  const COLS = 'grid-cols-[2rem_minmax(10rem,1.3fr)_8.5rem_minmax(12rem,2fr)_7rem_11rem_7.5rem_6.5rem_2.5rem]'

  return (
    <div>
      <Header title="流入経路分析" />
      {error && <p className="mb-3 text-sm text-[#e5451f]">{error}</p>}

      <div className="flex gap-5">
        {/* ── 左: フォルダ ── */}
        <div className="w-[15rem] flex-shrink-0">
          <button type="button" className={btnWhite} onClick={openNewFolder}>
            <span className="text-base leading-none">＋</span> 新しいフォルダ
          </button>
          <div className="mt-3 max-h-[calc(100vh-15rem)] overflow-y-auto bg-[#f1f1f4] text-sm">
            <FolderRow label="未分類" count={unfiledCount} selected={!query && folder === UNFILED} onSelect={() => { setQuery(''); setSearch(''); setFolder(UNFILED) }} />
            {folders.map((f) => (
              <FolderRow
                key={f.id}
                label={f.name}
                count={f.count}
                selected={!query && folder === f.id}
                draggable
                onSelect={() => { setQuery(''); setSearch(''); setFolder(f.id) }}
                onDragStart={() => { dragFolderId.current = f.id }}
                onDrop={() => void dropFolder(f.id)}
                menu={
                  folder === f.id ? (
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

        {/* ── 右: 流入経路 ── */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <Link href={newHref} className={btnGreen}>
              <span className="text-base leading-none">＋</span> 新しい流入経路
            </Link>
            <form
              className="flex"
              onSubmit={(e) => {
                e.preventDefault()
                setQuery(search.trim())
              }}
            >
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  if (!e.target.value.trim()) setQuery('')
                }}
                placeholder="検索"
                aria-label="流入経路を検索"
                className="h-9 w-56 rounded-l border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]"
              />
              <button type="submit" aria-label="検索" className="flex h-9 w-10 items-center justify-center rounded-r bg-[#757578] text-white hover:bg-[#65656a]">⌕</button>
            </form>
          </div>

          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[68rem]">
              <div className={`grid ${COLS} items-center bg-[#f1f1f4] px-2 text-xs text-[#757578]`} style={{ height: 40 }}>
                <span />
                <span>流入経路名</span>
                <span>URL・QRコード</span>
                <span>アクション</span>
                <span>友だち追加時設定</span>
                <span>有効期間</span>
                <span className="text-right">集計</span>
                <span className="pl-3">登録日</span>
                <span />
              </div>

              {loading ? (
                <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">読み込み中...</p>
              ) : routes.length === 0 ? (
                <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">
                  {query ? '該当する流入経路がありません' : '流入経路が登録されていません'}
                </p>
              ) : (
                routes.map((r) => {
                  const lines = actionLines(r)
                  return (
                    <div
                      key={r.id}
                      draggable={dragEnabled}
                      onDragStart={() => { dragRouteId.current = r.id }}
                      onDragOver={(e) => { if (dragEnabled) e.preventDefault() }}
                      onDrop={() => void dropRoute(r.id)}
                      className={`item-enter grid ${COLS} items-center border-b border-[#e3e3e6] bg-white px-2 py-2 text-sm transition-colors duration-150 hover:bg-[#fafafb]`}
                      style={{ minHeight: 56 }}
                    >
                      <span className="pl-1">{dragEnabled ? <DragHandle /> : null}</span>
                      <div className="min-w-0 pr-3">
                        <Link href={r.legacy ? `/inflow-links/detail?id=${r.id}` : `/inflow-links/edit?id=${r.id}&group=${folder === UNFILED ? '' : folder}`} className="break-words font-bold text-[#2b7bb9] underline">
                          {r.name}
                        </Link>
                        <span className="ml-2 rounded-sm bg-[#e8e8ec] px-1 py-0.5 align-middle text-[10px] text-[#595959]">登録用</span>
                      </div>
                      <div>
                        <button type="button" className={`${btnBase} border border-[#cacace] bg-white text-[#414143] hover:bg-[#f7f7f9]`} onClick={() => setQrRoute(r)}>
                          URLコピー・QR
                        </button>
                      </div>
                      <div className="min-w-0 pr-3 text-xs leading-5">
                        {lines.length === 0 ? <span className="text-[#757578]">-</span> : lines.map((t, i) => <p key={i} className="break-words">{t}</p>)}
                      </div>
                      <span className="text-xs">{lines.length === 0 ? '-' : r.ignoreFriendAddSettings ? '無視する' : '無視しない'}</span>
                      <span className="pr-2 text-xs leading-5">
                        {r.validFrom || r.validTo ? (
                          <>
                            <span className="block">{(r.validFrom ?? '').replace('T', ' ') || '　'}</span>
                            <span className="block">〜 {(r.validTo ?? '').replace('T', ' ')}</span>
                          </>
                        ) : (
                          '-'
                        )}
                      </span>
                      <Link href={`/inflow-links/stats?id=${r.id}&group=${folder === UNFILED ? '' : folder}`} className="text-right text-[#2b7bb9] underline">
                        {(r.people ?? 0).toLocaleString('ja-JP')}人({(r.times ?? 0).toLocaleString('ja-JP')}回)
                      </Link>
                      <span className="pl-3 text-xs">{r.createdAt.slice(0, 10)}</span>
                      <div className="relative flex justify-end">
                        <button type="button" aria-label="メニュー" className="px-1.5 text-base font-bold" onClick={() => setRowMenuId((v) => (v === r.id ? null : r.id))}>⋮</button>
                        <Popover open={rowMenuId === r.id} onClose={() => setRowMenuId(null)}>
                          {!r.legacy && (
                            <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => void copyRoute(r)}>コピーを作成</button>
                          )}
                          {r.folderId && (
                            <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => void moveRoute(r, null)}>未分類に移動</button>
                          )}
                          {folders.filter((f) => f.id !== r.folderId).map((f) => (
                            <button key={f.id} type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => void moveRoute(r, f.id)}>
                              「{f.name}」に移動
                            </button>
                          ))}
                          <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-[#e5451f] hover:bg-[#f1f1f4]" onClick={() => void deleteRoute(r)}>削除</button>
                        </Popover>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
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

      {qrRoute ? <RouteQrDialog route={qrRoute} onClose={() => setQrRoute(null)} /> : null}

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
