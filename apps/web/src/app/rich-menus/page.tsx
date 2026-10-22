'use client'

import { useDialogs } from '@/components/ui/dialogs'
import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { ApplyToTagModal } from '@/components/rich-menus/apply-to-tag-modal'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Table } from '@cloudflare/kumo/components/table'

type RichMenuGroupListItem = {
  id: string
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  status: 'draft' | 'published'
  isDefaultForAll: boolean
  selected: boolean
  folderId: string | null
  thumbnailR2Key: string | null
  taps: { people: number; taps: number }
  updatedAt: string
}

type Folder = { id: string; name: string; order: number; menuCount: number }

type LineMenu = {
  richMenuId: string
  name: string
  chatBarText: string
  selected: boolean
  size: { width: number; height: number }
  areasCount: number
  isCurrentDefault: boolean
  adminManaged: boolean
  adminInfo: {
    groupId: string
    groupName: string
    pageName: string
    groupStatus: 'draft' | 'published'
  } | null
}

const UNCATEGORIZED = '__none__'
const fld = 'h-9 rounded border border-[#cacace] bg-white px-3 text-sm outline-none focus:border-[#069e04]'

export default function RichMenusListPage() {
  const dialogs = useDialogs()
  const router = useRouter()
  const { selectedAccount } = useAccount()
  const [groups, setGroups] = useState<RichMenuGroupListItem[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [uncategorized, setUncategorized] = useState(0)
  const [folder, setFolder] = useState<string>(UNCATEGORIZED)
  const [search, setSearch] = useState('')
  const [external, setExternal] = useState<{ currentDefault: string | null; lineMenus: LineMenu[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [externalError, setExternalError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applyTo, setApplyTo] = useState<RichMenuGroupListItem | null>(null)
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ kind: 'delete-group'; group: RichMenuGroupListItem } | { kind: 'delete-external' | 'import'; menu: LineMenu } | { kind: 'delete-folder'; folder: Folder } | null>(null)
  const [folderEdit, setFolderEdit] = useState<{ id: string | null; name: string } | null>(null)
  const [moveFor, setMoveFor] = useState<RichMenuGroupListItem | null>(null)

  const reload = useCallback(async () => {
    if (!selectedAccount?.id) return
    setLoading(true)
    setError(null)
    setExternalError(null)
    try {
      const [groupsRes, externalRes, folderRes] = await Promise.allSettled([
        api.richMenuGroups.list(selectedAccount.id),
        api.richMenuGroups.external(selectedAccount.id),
        api.richMenuGroups.folders(selectedAccount.id),
      ])
      if (groupsRes.status === 'fulfilled') {
        if (!groupsRes.value.success) throw new Error(groupsRes.value.error ?? '取得失敗')
        setGroups(groupsRes.value.data)
      } else {
        throw groupsRes.reason
      }
      if (folderRes.status === 'fulfilled' && folderRes.value.success) {
        setFolders(folderRes.value.data.folders)
        setUncategorized(folderRes.value.data.uncategorizedCount)
      }
      if (externalRes.status === 'fulfilled') {
        const v = externalRes.value
        if (v.success) setExternal(v.data)
        else { setExternalError(v.error ?? 'LINE 上の状態取得に失敗'); setExternal(null) }
      } else {
        setExternalError(externalRes.reason instanceof Error ? externalRes.reason.message : String(externalRes.reason))
        setExternal(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccount?.id])

  useEffect(() => { void reload() }, [reload])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return groups.filter((g) => (folder === UNCATEGORIZED ? !g.folderId : g.folderId === folder) && (!q || g.name.toLowerCase().includes(q)))
  }, [groups, folder, search])

  async function createMenu(size: 'large' | 'compact') {
    if (!selectedAccount?.id || creating) return
    setCreating(true)
    setNewMenuOpen(false)
    try {
      const res = await api.richMenuGroups.create({
        accountId: selectedAccount.id,
        name: '新しいリッチメニュー',
        chatBarText: 'メニュー',
        size,
        selected: true,
        pages: [{ name: 'ページ 1', orderIndex: 0, areas: [] }],
      })
      if (!res.success) throw new Error(res.error ?? '作成失敗')
      if (folder !== UNCATEGORIZED) await api.richMenuGroups.update(res.data.id, { folderId: folder })
      router.push(`/rich-menus/edit?id=${res.data.id}`)
    } catch (e) {
      void dialogs.alert(e instanceof Error ? e.message : String(e))
      setCreating(false)
    }
  }

  async function handleDelete(group: RichMenuGroupListItem, confirmed = false) {
    if (group.status === 'published') {
      void dialogs.alert(`「${group.name}」は LINE に登録されています。\n\n編集画面で「LINEから取り下げ」を実行してから、改めて削除してください。`)
      return
    }
    if (!confirmed) { setPendingAction({ kind: 'delete-group', group }); return }
    setPendingAction(null)
    try {
      const res = await api.richMenuGroups.delete(group.id)
      if (!res.success) throw new Error(res.error ?? '削除失敗')
      await reload()
    } catch (e) {
      void dialogs.alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDeleteExternal(menu: LineMenu, confirmed = false) {
    if (!selectedAccount?.id) return
    if (!confirmed) { setPendingAction({ kind: 'delete-external', menu }); return }
    setPendingAction(null)
    try {
      const res = await api.richMenuGroups.deleteExternal(menu.richMenuId, selectedAccount.id)
      if (!res.success) throw new Error(res.error ?? '削除失敗')
      await reload()
    } catch (e) {
      void dialogs.alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleImport(menu: LineMenu, confirmed = false) {
    if (!selectedAccount?.id) return
    if (!confirmed) { setPendingAction({ kind: 'import', menu }); return }
    setPendingAction(null)
    try {
      const res = await api.richMenuGroups.importFromLine(menu.richMenuId, selectedAccount.id)
      if (!res.success) throw new Error(res.error ?? '取り込み失敗')
      void dialogs.alert(`取り込みました: ${res.data?.name ?? menu.name}`)
      await reload()
    } catch (e) {
      void dialogs.alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function saveFolder() {
    if (!selectedAccount?.id || !folderEdit) return
    const name = folderEdit.name.trim()
    if (!name) return
    try {
      const res = folderEdit.id ? await api.richMenuGroups.renameFolder(folderEdit.id, name) : await api.richMenuGroups.createFolder(selectedAccount.id, name)
      if (!res.success) throw new Error(res.error ?? '保存できませんでした')
      setFolderEdit(null)
      await reload()
    } catch (e) {
      void dialogs.alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function removeFolder(f: Folder, confirmed = false) {
    if (!confirmed) { setPendingAction({ kind: 'delete-folder', folder: f }); return }
    setPendingAction(null)
    const res = await api.richMenuGroups.deleteFolder(f.id)
    if (!res.success) { void dialogs.alert(res.error ?? '削除できませんでした'); return }
    if (folder === f.id) setFolder(UNCATEGORIZED)
    await reload()
  }

  async function moveTo(g: RichMenuGroupListItem, folderId: string | null) {
    setMoveFor(null)
    const res = await api.richMenuGroups.move([g.id], folderId)
    if (!res.success) { void dialogs.alert(res.error ?? '移動できませんでした'); return }
    await reload()
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-[#333]">リッチメニュー</h1>

      {!selectedAccount && <div className="mt-4 text-sm text-gray-500">アカウントを選択してください。</div>}
      {selectedAccount && error && <Banner className="my-4" variant="error" title="読み込めませんでした" description={error} />}

      {selectedAccount && (
        <div className="mt-4 flex flex-col gap-4 lg:flex-row">
          {/* 左: フォルダ */}
          <aside className="w-full shrink-0 lg:w-56">
            <button type="button" onClick={() => setFolderEdit({ id: null, name: '' })} className="mb-2 w-full rounded border border-[#cacace] bg-white px-3 py-2 text-left text-sm hover:bg-[#f7f7f9]">+ 新しいフォルダ</button>
            <div className="rounded border border-[#e3e3e6] bg-[#f4f4f6]">
              <FolderRow active={folder === UNCATEGORIZED} name="未分類" count={uncategorized} onClick={() => setFolder(UNCATEGORIZED)} />
              {folders.map((f) => (
                <FolderRow
                  key={f.id}
                  active={folder === f.id}
                  name={f.name}
                  count={f.menuCount}
                  onClick={() => setFolder(f.id)}
                  onRename={() => setFolderEdit({ id: f.id, name: f.name })}
                  onDelete={() => void removeFolder(f)}
                />
              ))}
            </div>
          </aside>

          {/* 右: メニューの表 */}
          <section className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative">
                <button type="button" disabled={creating} onClick={() => setNewMenuOpen((v) => !v)} className="rounded bg-[#069e04] px-4 py-2 text-sm font-bold text-white hover:bg-[#058503] disabled:opacity-60">+ 新しいリッチメニュー ▾</button>
                {newMenuOpen && (
                  <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded border border-[#cacace] bg-white py-1 text-sm shadow-lg">
                    <button type="button" className="block w-full px-3 py-2 text-left hover:bg-[#f1f1f4]" onClick={() => void createMenu('large')}>大(2500×1686)</button>
                    <button type="button" className="block w-full px-3 py-2 text-left hover:bg-[#f1f1f4]" onClick={() => void createMenu('compact')}>小(2500×843)</button>
                  </div>
                )}
              </div>
              <div className="ml-auto flex">
                <input className={`${fld} w-56 rounded-r-none`} placeholder="検索" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="リッチメニューを検索" />
                <span className="flex h-9 w-10 items-center justify-center rounded-r bg-[#757578] text-white" aria-hidden="true">⌕</span>
              </div>
            </div>

            {loading ? (
              <p className="py-8 text-center text-sm text-[#757578]">読み込み中...</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[44rem]">
                  <div className="grid grid-cols-[minmax(12rem,1fr)_8rem_9rem_9rem_2.5rem] items-center bg-[#f1f1f4] px-3 text-xs text-[#757578]" style={{ height: 40 }}>
                    <span>リッチメニュー名</span>
                    <span>メニュー初期状態</span>
                    <span>画像</span>
                    <span>計測</span>
                    <span />
                  </div>
                  {visible.length === 0 ? (
                    <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">リッチメニューが作成されていません</p>
                  ) : (
                    visible.map((g) => (
                      <div key={g.id} className="relative grid grid-cols-[minmax(12rem,1fr)_8rem_9rem_9rem_2.5rem] items-center border-b border-[#e3e3e6] bg-white px-3 py-2 text-sm hover:bg-[#fafafb]">
                        <div className="min-w-0 pr-3">
                          <Link href={`/rich-menus/edit?id=${g.id}`} className="block truncate font-bold text-[#2b7bb9] underline">{g.name}</Link>
                          <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] ${g.status === 'published' ? 'bg-[#e7f8ee] text-[#058503]' : 'bg-[#f1f1f4] text-[#757578]'}`}>{g.status === 'published' ? 'LINE登録済み' : '下書き'}</span>
                        </div>
                        <span>{g.selected ? '表示する' : '表示しない'}</span>
                        <div className="py-1">
                          {g.thumbnailR2Key ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={api.richMenuGroups.imageUrl(g.thumbnailR2Key)} alt={g.name} className="h-12 rounded border border-[#e3e3e6] object-cover" />
                          ) : (
                            <span className="text-xs text-[#9c9ca0]">未設定</span>
                          )}
                        </div>
                        <span className="text-xs text-[#555]">{g.taps.people > 0 ? `${g.taps.people.toLocaleString('ja-JP')}人 / ${g.taps.taps.toLocaleString('ja-JP')}回` : '-'}</span>
                        <div className="relative flex justify-end">
                          <button type="button" aria-label="メニュー" className="px-1.5 text-base font-bold" onClick={() => setRowMenu((v) => (v === g.id ? null : g.id))}>⋮</button>
                          {rowMenu === g.id && (
                            <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded border border-[#cacace] bg-white py-1 text-sm shadow-lg">
                              {g.status === 'published' && <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => { setRowMenu(null); setApplyTo(g) }}>友だちに表示</button>}
                              <Link href={`/rich-menus/edit?id=${g.id}`} className="block px-3 py-1.5 hover:bg-[#f1f1f4]">編集</Link>
                              <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => { setRowMenu(null); setMoveFor(g) }}>フォルダへ移動</button>
                              <button type="button" className="block w-full px-3 py-1.5 text-left text-[#d92d20] hover:bg-[#fef3f2]" onClick={() => { setRowMenu(null); void handleDelete(g) }}>削除</button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* LINE 公式アカウントの現状 (管理画面外のメニューも含む) */}
      {selectedAccount && !loading && external && (
        <details className="mt-10">
          <summary className="cursor-pointer text-sm font-bold text-[#555]">LINE上のメニューの状態</summary>
          <div className="mt-3">
            <ExternalSection
              accountId={selectedAccount.id}
              accountName={selectedAccount.displayName || selectedAccount.name}
              external={external}
              onDeleteExternal={handleDeleteExternal}
              onImport={handleImport}
            />
          </div>
        </details>
      )}
      {selectedAccount && !loading && externalError && (
        <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">LINE 公式アカウントの状態取得に失敗しました: {externalError}</div>
      )}

      {applyTo && <ApplyToTagModal groupId={applyTo.id} groupName={applyTo.name} onClose={() => setApplyTo(null)} />}

      <Dialog.Root open={folderEdit !== null} onOpenChange={(o) => { if (!o) setFolderEdit(null) }}>
        <Dialog className="w-full max-w-sm p-5">
          <Dialog.Title>{folderEdit?.id ? 'フォルダ名を変更' : '新しいフォルダ'}</Dialog.Title>
          <input autoFocus className={`${fld} mt-4 w-full`} value={folderEdit?.name ?? ''} onChange={(e) => setFolderEdit((p) => (p ? { ...p, name: e.target.value } : p))} onKeyDown={(e) => { if (e.key === 'Enter') void saveFolder() }} aria-label="フォルダ名" />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFolderEdit(null)}>キャンセル</Button>
            <Button type="button" variant="primary" disabled={!folderEdit?.name.trim()} onClick={() => void saveFolder()}>保存</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      <Dialog.Root open={moveFor !== null} onOpenChange={(o) => { if (!o) setMoveFor(null) }}>
        <Dialog className="w-full max-w-sm p-5">
          <Dialog.Title>フォルダへ移動</Dialog.Title>
          <div className="mt-4 space-y-1">
            <button type="button" className="block w-full rounded border border-[#e3e3e6] px-3 py-2 text-left text-sm hover:bg-[#f7f7f9]" onClick={() => moveFor && void moveTo(moveFor, null)}>未分類</button>
            {folders.map((f) => <button key={f.id} type="button" className="block w-full rounded border border-[#e3e3e6] px-3 py-2 text-left text-sm hover:bg-[#f7f7f9]" onClick={() => moveFor && void moveTo(moveFor, f.id)}>{f.name}</button>)}
          </div>
        </Dialog>
      </Dialog.Root>

      <Dialog.Root role="alertdialog" open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null) }}>
        <Dialog>
          <Dialog.Title>{pendingAction?.kind === 'import' ? '管理画面に取り込みますか？' : pendingAction?.kind === 'delete-folder' ? 'フォルダを削除しますか？' : 'リッチメニューを削除しますか？'}</Dialog.Title>
          <Dialog.Description className="mt-2">{pendingAction?.kind === 'import' ? '取り込み後は管理画面から編集と再適用ができます。' : pendingAction?.kind === 'delete-folder' ? '中のメニューは「未分類」に戻ります。' : 'この操作は元に戻せません。'}</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPendingAction(null)}>キャンセル</Button>
            <Button type="button" variant={pendingAction?.kind === 'import' ? 'primary' : 'destructive'} onClick={() => { if (pendingAction?.kind === 'delete-group') void handleDelete(pendingAction.group, true); else if (pendingAction?.kind === 'delete-external') void handleDeleteExternal(pendingAction.menu, true); else if (pendingAction?.kind === 'import') void handleImport(pendingAction.menu, true); else if (pendingAction?.kind === 'delete-folder') void removeFolder(pendingAction.folder, true) }}>実行する</Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}

function FolderRow({ active, name, count, onClick, onRename, onDelete }: { active: boolean; name: string; count: number; onClick: () => void; onRename?: () => void; onDelete?: () => void }) {
  return (
    <div className={`group flex items-center border-b border-[#e3e3e6] last:border-b-0 ${active ? 'bg-[#fdf3d6]' : 'hover:bg-[#ececef]'}`}>
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm">
        <span aria-hidden="true">{active ? '📂' : '📁'}</span>
        <span className="truncate">{name}</span>
        <span className="ml-auto text-xs text-[#757578]">{count}</span>
      </button>
      {onRename && (
        <button type="button" aria-label="フォルダ名を変更" onClick={onRename} className="px-1.5 text-xs text-[#757578] opacity-0 hover:text-[#333] group-hover:opacity-100">✎</button>
      )}
      {onDelete && (
        <button type="button" aria-label="フォルダを削除" onClick={onDelete} className="px-1.5 text-xs text-[#757578] opacity-0 hover:text-[#d92d20] group-hover:opacity-100">✕</button>
      )}
    </div>
  )
}

function ExternalSection({
  accountId,
  accountName,
  external,
  onDeleteExternal,
  onImport,
}: {
  accountId: string
  accountName: string
  external: { currentDefault: string | null; lineMenus: LineMenu[] }
  onDeleteExternal: (menu: LineMenu) => void
  onImport: (menu: LineMenu) => void
}) {
  const { currentDefault, lineMenus } = external
  const sortedMenus = [...lineMenus].sort((a, b) => {
    // 現在のデフォルトを先頭、次に admin 管理外、最後に admin 管理
    if (a.isCurrentDefault) return -1
    if (b.isCurrentDefault) return 1
    if (a.adminManaged !== b.adminManaged) return a.adminManaged ? 1 : -1
    return a.name.localeCompare(b.name)
  })
  const currentDefaultMenu = lineMenus.find((m) => m.isCurrentDefault) ?? null
  const unmanagedCount = lineMenus.filter((m) => !m.adminManaged).length

  return (
    <section className="mb-8 bg-white border border-gray-200 rounded-lg shadow-sm p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-900">
          LINE 公式アカウントの現状
        </h2>
        <span className="text-xs text-gray-500 truncate">{accountName}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-700 font-medium mb-0.5">
            現在の「全員のデフォルト」
          </div>
          {currentDefaultMenu ? (
            <div>
              <div className="font-medium text-gray-900 truncate">
                {currentDefaultMenu.name}
              </div>
              {currentDefaultMenu.adminInfo ? (
                <div className="text-xs text-gray-600 truncate">
                  管理画面: {currentDefaultMenu.adminInfo.groupName}
                </div>
              ) : (
                <div className="text-xs text-amber-700">管理画面外で設定</div>
              )}
            </div>
          ) : (
            <div className="text-gray-500 text-xs">設定なし</div>
          )}
          {currentDefault && (
            <div className="text-[10px] text-gray-400 font-mono mt-1 truncate">
              {currentDefault}
            </div>
          )}
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="text-xs text-gray-700 font-medium mb-0.5">
            LINE 上に登録されているメニュー
          </div>
          <div className="font-medium text-gray-900">{lineMenus.length} 個</div>
          {unmanagedCount > 0 && (
            <div className="text-xs text-amber-700">
              うち {unmanagedCount} 個が管理画面外
            </div>
          )}
        </div>
      </div>

      {lineMenus.length === 0 ? (
        <div className="text-xs text-gray-500 py-3">
          LINE 公式アカウントにはまだ rich menu が登録されていません。
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <Table>
            <Table.Header><Table.Row><Table.Head className="w-[88px]">画像</Table.Head><Table.Head>名前</Table.Head><Table.Head>サイズ</Table.Head><Table.Head>管理状態</Table.Head><Table.Head /></Table.Row></Table.Header>
            <Table.Body>
              {sortedMenus.map((m) => (
                <Table.Row key={m.richMenuId}>
                  <Table.Cell>
                    <div
                      className="w-20 bg-gray-100 rounded overflow-hidden"
                      style={{
                        aspectRatio:
                          m.size.width === 2500 && m.size.height === 1686
                            ? '2500 / 1686'
                            : m.size.width === 2500 && m.size.height === 843
                              ? '2500 / 843'
                              : `${m.size.width} / ${m.size.height}`,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={api.richMenuGroups.externalImageUrl(m.richMenuId, accountId)}
                        alt={m.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2 mb-1">
                      {m.isCurrentDefault && (
                        <span
                          className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded"
                          title="LINE 公式アカウントの全員のデフォルト"
                        >
                          DEFAULT
                        </span>
                      )}
                      <span className="font-medium truncate max-w-[180px]">{m.name}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 truncate max-w-[200px]">
                      {m.chatBarText}
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono truncate max-w-[280px]">
                      {m.richMenuId}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-xs text-kumo-subtle whitespace-nowrap">
                    {m.size.width}×{m.size.height}
                    <div className="text-[10px] text-gray-400">{m.areasCount} エリア</div>
                  </Table.Cell>
                  <Table.Cell className="text-xs">
                    {m.adminManaged && m.adminInfo ? (
                      <Link
                        href={`/rich-menus/edit?id=${m.adminInfo.groupId}`}
                        className="text-gray-700 hover:underline"
                      >
                        管理画面 → {m.adminInfo.groupName}
                        <span className="text-gray-400 ml-1">({m.adminInfo.pageName})</span>
                      </Link>
                    ) : (
                      <span
                        className="text-amber-700 font-medium"
                        title="LINE 公式マネージャー、または旧 MCP/CLI から作成された可能性"
                      >
                        管理画面外
                      </span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right whitespace-nowrap">
                    {!m.adminManaged && (
                      <div className="flex flex-col items-end gap-1">
                        <Button type="button" size="xs" variant="primary"
                          onClick={() => onImport(m)}
                        >
                          管理画面に取り込む
                        </Button>
                        <Button type="button" size="xs" variant="destructive"
                          onClick={() => onDeleteExternal(m)}
                        >
                          LINE から削除
                        </Button>
                      </div>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
    </section>
  )
}
