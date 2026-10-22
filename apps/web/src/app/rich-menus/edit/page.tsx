'use client'

import { useDialogs } from '@/components/ui/dialogs'
import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { CanvasEditor, type Area } from '@/components/rich-menus/canvas-editor'
import {
  ButtonCard,
  LAYOUTS,
  LayoutThumb,
  MenuPreview,
  RegionDialog,
  defaultFor,
  normalizeArea,
  useActionLookups,
} from '@/components/rich-menus/lstep-parts'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Button } from '@cloudflare/kumo/components/button'

type Page = {
  id: string
  orderIndex: number
  name: string
  aliasId: string
  lineRichmenuId: string | null
  imageR2Key: string | null
  imageContentType: string | null
  areas: Area[]
}

type Group = {
  id: string
  accountId: string
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  defaultPageId: string | null
  isDefaultForAll: boolean
  selected: boolean
  status: 'draft' | 'published'
  publishingAt: string | null
  folderId: string | null
  pages: Page[]
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `area-${Math.random().toString(36).slice(2, 10)}`)

export default function RichMenuEditPage() {
  return (
    <Suspense fallback={<main className="p-6"><p className="text-sm text-gray-500">読み込み中...</p></main>}>
      <RichMenuEditPageInner />
    </Suspense>
  )
}

function RichMenuEditPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const groupId = searchParams.get('id') ?? ''
  if (!groupId) {
    return (
      <main className="p-6">
        <p className="text-sm text-red-600">id クエリパラメータが必要です</p>
        <Link href="/rich-menus" className="mt-2 inline-block text-sm text-[#2b7bb9] underline">一覧へ戻る</Link>
      </main>
    )
  }
  return <Editor groupId={groupId} router={router} />
}

const label = 'w-48 shrink-0 whitespace-nowrap pt-2 text-right text-sm font-bold text-[#069e04]'
const input = 'h-10 w-full rounded border border-[#cacace] bg-white px-3 text-sm outline-none focus:border-[#069e04]'
const required = <span className="ml-1 rounded bg-[#d9534f] px-1.5 py-0.5 text-[10px] font-bold text-white">必須</span>

function Editor({ groupId, router }: { groupId: string; router: ReturnType<typeof useRouter> }) {
  const dialogs = useDialogs()
  const [group, setGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activePageId, setActivePageId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [selected, setSelected] = useState(false)
  const [isDefaultForAll, setIsDefaultForAll] = useState(false)
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])

  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [imageVersion, setImageVersion] = useState(0)
  const [regionOpen, setRegionOpen] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<{ kind: 'remove-page'; pageId: string } | { kind: 'publish' } | { kind: 'unpublish' } | { kind: 'layout'; key: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.get(groupId)
      if (!res.success) throw new Error(res.error ?? '取得失敗')
      const g = res.data as Group
      setGroup(g)
      setName(g.name)
      setChatBarText(g.chatBarText)
      setFolderId(g.folderId ?? null)
      setIsDefaultForAll(g.isDefaultForAll)
      setSelected(g.selected)
      setPages(g.pages.map((p) => ({ ...p, areas: p.areas.map(normalizeArea) })))
      setActivePageId((prev) => (prev && g.pages.some((p) => p.id === prev) ? prev : (g.pages[0]?.id ?? null)))
      setSelectedAreaId(null)
      setDirty(false)
      const f = await api.richMenuGroups.folders(g.accountId).catch(() => null)
      if (f && f.success) setFolders(f.data.folders.map((x) => ({ id: x.id, name: x.name })))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { void reload() }, [reload])

  // 保存していない変更があるまま閉じようとしたら、ブラウザの確認を出す
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const accountId = group?.accountId ?? ''
  const { lookups } = useActionLookups(accountId)

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0] ?? null
  const touch = () => setDirty(true)

  function updatePage(pageId: string, patch: Partial<Page>) {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, ...patch } : p)))
    touch()
  }
  function updateAreas(pageId: string, fn: (areas: Area[]) => Area[]) {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, areas: fn(p.areas) } : p)))
    touch()
  }
  function updateArea(pageId: string, areaId: string, patch: Partial<Area>) {
    updateAreas(pageId, (areas) => areas.map((a) => (a.id === areaId ? { ...a, ...patch } : a)))
  }

  function addButton(pageId: string) {
    const area: Area = { id: newId(), boundsX: 0, boundsY: 0, boundsWidth: group?.size === 'compact' ? 833 : 833, boundsHeight: group?.size === 'compact' ? 843 : 843, ...defaultFor('url') }
    updateAreas(pageId, (areas) => {
      if (areas.length >= 20) { void dialogs.alert('ボタンは1ページに20個までです。'); return areas }
      return [...areas, area]
    })
    setSelectedAreaId(area.id)
  }
  function moveButton(pageId: string, index: number, dir: -1 | 1) {
    updateAreas(pageId, (areas) => {
      const to = index + dir
      if (to < 0 || to >= areas.length) return areas
      const next = [...areas]
      const [x] = next.splice(index, 1)
      next.splice(to, 0, x)
      return next
    })
  }
  function copyButton(pageId: string, index: number) {
    updateAreas(pageId, (areas) => {
      if (areas.length >= 20) { void dialogs.alert('ボタンは1ページに20個までです。'); return areas }
      const src = areas[index]
      const copy: Area = { ...src, id: newId(), boundsX: Math.min(src.boundsX + 40, 2500 - src.boundsWidth), boundsY: Math.min(src.boundsY + 40, (group?.size === 'compact' ? 843 : 1686) - src.boundsHeight) }
      const next = [...areas]
      next.splice(index + 1, 0, copy)
      return next
    })
  }
  function deleteButton(pageId: string, areaId: string) {
    updateAreas(pageId, (areas) => areas.filter((a) => a.id !== areaId))
    setSelectedAreaId(null)
  }

  /** 「テンプレート」(配置のひな形)を選ぶ。いまのボタンの動きは、同じ番号のボタンに引き継ぐ */
  function applyLayout(key: string) {
    const layout = LAYOUTS.find((l) => l.key === key)
    if (!layout || !activePage) return
    updateAreas(activePage.id, (areas) =>
      layout.cells.map((c, i) => {
        const old = areas[i]
        return { id: old?.id ?? newId(), boundsX: Math.round(c.x), boundsY: Math.round(c.y), boundsWidth: Math.round(c.w), boundsHeight: Math.round(c.h), ...(old ? { actionType: old.actionType, actionData: old.actionData } : defaultFor('url')) }
      }),
    )
    setSelectedAreaId(null)
  }

  function addPage() {
    const nextOrder = pages.length
    const newPage: Page = { id: `tmp-${Math.random().toString(36).slice(2, 10)}`, orderIndex: nextOrder, name: `ページ ${nextOrder + 1}`, aliasId: '', lineRichmenuId: null, imageR2Key: null, imageContentType: null, areas: [] }
    setPages([...pages, newPage])
    setActivePageId(newPage.id)
    setSelectedAreaId(null)
    touch()
  }

  function removePage(pageId: string, confirmed = false) {
    if (pages.length <= 1) { void dialogs.alert('最低 1 ページは必要です。'); return }
    const referrers = pages.filter((p) => p.id !== pageId).filter((p) => p.areas.some((a) => a.actionType === 'richmenuswitch' && (a.actionData as { targetPageId?: string }).targetPageId === pageId))
    if (referrers.length > 0) {
      void dialogs.alert(`このページは ${referrers.map((p) => `「${p.name}」`).join(', ')} のボタンから切り替え先に指定されています。先にそのボタンの設定を変えてから削除してください。`)
      return
    }
    if (!confirmed) { setPendingConfirm({ kind: 'remove-page', pageId }); return }
    const remaining = pages.filter((p) => p.id !== pageId).map((p, i) => ({ ...p, orderIndex: i }))
    setPages(remaining)
    if (activePageId === pageId) setActivePageId(remaining[0]?.id ?? null)
    setSelectedAreaId(null)
    touch()
  }

  async function persistDraft(): Promise<void> {
    const res = await api.richMenuGroups.update(groupId, {
      name,
      chatBarText,
      folderId,
      isDefaultForAll,
      selected,
      pages: pages.map((p, i) => ({
        ...(p.id.startsWith('tmp-') ? {} : { id: p.id }),
        name: p.name,
        orderIndex: i,
        areas: p.areas.map((a) => ({
          id: a.id,
          boundsX: a.boundsX,
          boundsY: a.boundsY,
          boundsWidth: a.boundsWidth,
          boundsHeight: a.boundsHeight,
          actionType: a.actionType,
          actionData: a.actionData,
        })),
      })),
    })
    if (!res.success) throw new Error(res.error ?? '保存失敗')
  }

  function validate(): string | null {
    if (!name.trim()) return 'タイトルを入力してください'
    if (!chatBarText.trim()) return 'トークルームメニューを入力してください'
    return null
  }

  async function handleSave() {
    const v = validate()
    if (v) { setError(v); return }
    setSaving(true)
    setError(null)
    try {
      await persistDraft()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish(confirmed = false) {
    const v = validate()
    if (v) { setError(v); return }
    if (!confirmed) { setPendingConfirm({ kind: 'publish' }); return }
    setPendingConfirm(null)
    setPublishing(true)
    setError(null)
    try {
      await persistDraft()
      const res = await api.richMenuGroups.publish(groupId)
      if (!res.success) throw new Error(res.error ?? 'LINE 登録失敗')
      await reload()
      void dialogs.alert('LINEへの登録が完了しました。友だちに表示するには、一覧の「友だちに表示」を実行してください。')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPublishing(false)
    }
  }

  async function handleUnpublish(confirmed = false) {
    if (!confirmed) { setPendingConfirm({ kind: 'unpublish' }); return }
    setPendingConfirm(null)
    setBusy(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.unpublish(groupId)
      if (!res.success) throw new Error(res.error ?? '取り下げ失敗')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!group) return
    if (group.status === 'published') { void dialogs.alert('LINEに登録中のメニューです。先に「LINEから取り下げ」を実行してください。'); return }
    const typed = prompt(`削除を確定するには、リッチメニュー名「${group.name}」を入力してください。`)
    if (typed === null) return
    if (typed !== group.name) { void dialogs.alert('入力が一致しませんでした。削除をキャンセルしました。'); return }
    try {
      const res = await api.richMenuGroups.delete(groupId)
      if (!res.success) throw new Error(res.error ?? '削除失敗')
      router.push('/rich-menus')
    } catch (e) {
      void dialogs.alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleImageUpload(pageId: string, file: File) {
    if (pageId.startsWith('tmp-')) { void dialogs.alert('先に「保存」でページを保存してから、画像を選んでください。'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.uploadImage(groupId, pageId, file)
      updatePage(pageId, { imageR2Key: res.data.imageR2Key, imageContentType: res.data.imageContentType })
      setImageVersion((v) => v + 1)
    } catch (e) {
      void dialogs.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <main className="p-6"><p className="text-sm text-gray-500">読み込み中...</p></main>
  if (!group) {
    return (
      <main className="p-6">
        <p className="text-sm text-red-600">{error ?? 'リッチメニューが見つかりません'}</p>
        <Link href="/rich-menus" className="mt-2 inline-block text-sm text-[#2b7bb9] underline">一覧へ戻る</Link>
      </main>
    )
  }

  const pagesForSelect = pages.filter((p) => !p.id.startsWith('tmp-')).map((p) => ({ id: p.id, name: p.name }))
  const imageUrl = activePage?.imageR2Key ? `${api.richMenuGroups.imageUrl(activePage.imageR2Key)}?v=${imageVersion}` : null
  const layouts = LAYOUTS.filter((l) => l.size === group.size)
  const areas = activePage?.areas ?? []

  return (
    <div className="pb-28">
      <h1 className="mb-6 text-xl font-bold text-[#333]">リッチメニュー編集</h1>

      {error && <Banner className="mb-4" variant="error" title="操作を完了できませんでした" description={error} />}

      {pages.length > 1 || pages.some((p) => p.id.startsWith('tmp-')) ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setActivePageId(p.id); setSelectedAreaId(null) }}
              className={`rounded border px-3 py-1.5 text-sm ${p.id === activePage?.id ? 'border-[#069e04] bg-[#069e04] font-bold text-white' : 'border-[#cacace] bg-white text-[#333] hover:bg-[#f7f7f9]'}`}
            >
              {p.name}{p.id.startsWith('tmp-') ? '(未保存)' : ''}
            </button>
          ))}
          <button type="button" onClick={addPage} className="rounded border border-dashed border-[#cacace] px-3 py-1.5 text-sm text-[#555] hover:bg-[#f7f7f9]">+ ページ追加</button>
        </div>
      ) : null}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          {/* 画像 */}
          <div className="flex items-start gap-4">
            <span className={label}>画像</span>
            <div className="flex items-center gap-3">
              <input ref={fileInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && activePage) void handleImageUpload(activePage.id, f); e.target.value = '' }} />
              <button type="button" disabled={busy || !activePage} onClick={() => fileInput.current?.click()} className="rounded bg-[#5bc0de] px-4 py-2 text-sm font-medium text-white hover:bg-[#46b8da] disabled:opacity-50">メニュー画像選択</button>
              {imageUrl ? <img src={imageUrl} alt="" className="h-12 rounded border border-[#e3e3e6]" /> : null}
            </div>
          </div>

          <div className="flex items-start gap-4">
            <span className={label}>タイトル{required}</span>
            <input className={`${input} max-w-[640px]`} value={name} onChange={(e) => { setName(e.target.value); touch() }} />
          </div>

          <div className="flex items-start gap-4">
            <span className={label}>フォルダ</span>
            <select className={`${input} max-w-[320px]`} value={folderId ?? ''} onChange={(e) => { setFolderId(e.target.value || null); touch() }}>
              <option value="">未分類</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          <div className="flex items-start gap-4">
            <span className={label}>トークルームメニュー{required}</span>
            <input className={`${input} max-w-[640px]`} value={chatBarText} maxLength={14} onChange={(e) => { setChatBarText(e.target.value); touch() }} />
          </div>

          <div className="flex items-start gap-4">
            <span className={label}>メニューの初期状態</span>
            <div className="flex items-center gap-5 pt-2 text-sm">
              <label className="flex items-center gap-1.5"><input type="radio" checked={!selected} onChange={() => { setSelected(false); touch() }} />表示しない</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={selected} onChange={() => { setSelected(true); touch() }} />表示する</label>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <span className={label}>テンプレート</span>
            <div className="flex flex-wrap items-center gap-3">
              {layouts.map((l) => (
                <LayoutThumb
                  key={l.key}
                  cells={l.cells}
                  size={l.size}
                  onClick={() => (areas.some((a) => a.boundsWidth > 0) && areas.length > 0 ? setPendingConfirm({ kind: 'layout', key: l.key }) : applyLayout(l.key))}
                />
              ))}
              <button type="button" onClick={() => { if (activePage) { updateAreas(activePage.id, () => []); setSelectedAreaId(null) } }} className="rounded border border-[#cacace] bg-white px-4 py-2 text-sm hover:bg-[#f7f7f9]">リセット</button>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <span className={label}>コンテンツ設定</span>
            <div className="min-w-0 flex-1 space-y-4">
              {activePage && areas.map((a, i) => (
                <ButtonCard
                  key={a.id}
                  index={i}
                  area={a}
                  pages={pagesForSelect}
                  lookups={lookups}
                  accountId={accountId}
                  selected={selectedAreaId === a.id}
                  canMoveUp={i > 0}
                  canMoveDown={i < areas.length - 1}
                  onChange={(patch) => updateArea(activePage.id, a.id, patch)}
                  onMove={(dir) => moveButton(activePage.id, i, dir)}
                  onCopy={() => copyButton(activePage.id, i)}
                  onDelete={() => deleteButton(activePage.id, a.id)}
                  onEditRegion={() => { setSelectedAreaId(a.id); setRegionOpen(true) }}
                />
              ))}
              {activePage && (
                <button type="button" onClick={() => addButton(activePage.id)} className="w-full rounded border border-dashed border-[#9c9ca0] bg-white py-2 text-sm text-[#333] hover:bg-[#f7f7f9]">+ 追加</button>
              )}
            </div>
          </div>

          {/* ページ・メニューの操作(ふだんは使わない) */}
          <div className="ml-52 flex flex-wrap items-center gap-2 border-t border-[#e3e3e6] pt-4 text-xs">
            {activePage && pages.length > 1 && (
              <>
                <input className="h-8 w-40 rounded border border-[#cacace] px-2 text-xs" value={activePage.name} onChange={(e) => updatePage(activePage.id, { name: e.target.value })} aria-label="ページ名" />
                <button type="button" onClick={() => removePage(activePage.id)} className="rounded border border-[#e5a09b] bg-white px-3 py-1.5 text-[#d92d20] hover:bg-[#fef3f2]">このページを削除</button>
              </>
            )}
            {pages.length === 1 && <button type="button" onClick={addPage} className="rounded border border-[#cacace] bg-white px-3 py-1.5 hover:bg-[#f7f7f9]">+ ページ追加</button>}
            {group.status === 'published' && <button type="button" onClick={() => void handleUnpublish()} disabled={busy} className="rounded border border-[#e5a09b] bg-white px-3 py-1.5 text-[#d92d20] hover:bg-[#fef3f2]">LINEから取り下げ</button>}
            <button type="button" onClick={() => void handleDelete()} className="rounded border border-[#e5a09b] bg-white px-3 py-1.5 text-[#d92d20] hover:bg-[#fef3f2]">このメニューを削除</button>
          </div>
        </div>

        <aside className="min-w-0">
          <div className="sticky top-4">
            <p className="mb-2 text-sm font-bold text-[#069e04]">プレビュー</p>
            <MenuPreview
              areas={areas}
              size={group.size}
              imageUrl={imageUrl}
              chatBarText={chatBarText}
              selectedId={selectedAreaId}
              onSelect={(id) => {
                setSelectedAreaId(id)
                document.getElementById(`rm-button-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
            />
          </div>
        </aside>
      </div>

      {/* 下の固定バー */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#e3e3e6] bg-white py-3 lg:left-60">
        <div className="relative mx-auto flex max-w-5xl items-center justify-center gap-3 px-4">
          <Link href="/rich-menus" className="absolute left-4 text-xs text-[#2b7bb9] underline">一覧へ戻る</Link>
          <button type="button" onClick={() => void handleSave()} disabled={saving || publishing || busy} className="min-w-40 rounded bg-[#5cb85c] px-8 py-2.5 text-sm font-bold text-white hover:bg-[#4cae4c] disabled:opacity-60">{saving ? '保存中...' : '保存'}</button>
          <button type="button" onClick={() => void handlePublish()} disabled={saving || publishing || busy} className="rounded border border-[#069e04] bg-white px-5 py-2.5 text-sm font-bold text-[#069e04] hover:bg-[#f1faf1] disabled:opacity-60">{publishing ? '登録中...' : group.status === 'published' ? 'LINEに再登録' : 'LINEに登録'}</button>
        </div>
      </div>

      <RegionDialog open={regionOpen} onClose={() => setRegionOpen(false)}>
        {activePage && (
          <CanvasEditor
            areas={areas}
            size={group.size}
            imageUrl={imageUrl}
            selectedAreaId={selectedAreaId}
            onSelectArea={setSelectedAreaId}
            onAddArea={(area) => { updateAreas(activePage.id, (list) => [...list, { ...area, ...defaultFor('url') }]); setSelectedAreaId(area.id) }}
            onUpdateArea={(id, patch) => updateArea(activePage.id, id, patch)}
            onDeleteArea={(id) => deleteButton(activePage.id, id)}
          />
        )}
      </RegionDialog>

      <Dialog.Root role="alertdialog" open={pendingConfirm !== null} onOpenChange={(open) => { if (!open) setPendingConfirm(null) }}>
        <Dialog>
          <Dialog.Title>
            {pendingConfirm?.kind === 'publish' ? 'LINEに登録しますか？' : pendingConfirm?.kind === 'unpublish' ? 'LINEから取り下げますか？' : pendingConfirm?.kind === 'layout' ? 'ボタンの配置を変えますか？' : 'このページを削除しますか？'}
          </Dialog.Title>
          <Dialog.Description className="mt-2">
            {pendingConfirm?.kind === 'publish' ? '登録後、友だちに見せるには一覧の「友だちに表示」を実行します。' : pendingConfirm?.kind === 'unpublish' ? '表示中の友だちのトーク画面からもメニューが消えます。' : pendingConfirm?.kind === 'layout' ? 'ボタンの位置が、選んだ配置に変わります。ボタンの動きは、同じ番号のボタンに引き継がれます。' : 'ページと、設定したボタンを削除します。'}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPendingConfirm(null)}>キャンセル</Button>
            <Button
              type="button"
              variant={pendingConfirm?.kind === 'publish' || pendingConfirm?.kind === 'layout' ? 'primary' : 'destructive'}
              onClick={() => {
                if (!pendingConfirm) return
                if (pendingConfirm.kind === 'publish') void handlePublish(true)
                else if (pendingConfirm.kind === 'unpublish') void handleUnpublish(true)
                else if (pendingConfirm.kind === 'layout') { const k = pendingConfirm.key; setPendingConfirm(null); applyLayout(k) }
                else removePage(pendingConfirm.pageId, true)
                if (pendingConfirm.kind === 'remove-page') setPendingConfirm(null)
              }}
            >
              実行する
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}
