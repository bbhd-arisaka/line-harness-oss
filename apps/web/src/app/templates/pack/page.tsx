'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { EDITOR_TYPE_LABEL, emptyEditorData, validateTemplate } from '@line-crm/shared'
import type { EditorData, EditorType } from '@line-crm/shared'
import { useActionLookups } from '@/components/friend-add/use-action-lookups'
import Header from '@/components/layout/header'
import { EditorBody, LiveEditorPreview, TypeTabs } from '@/components/templates/editor-body'
import LinePreview from '@/components/templates/line-preview'
import TestSendDialog from '@/components/templates/test-send-dialog'
import { DragHandle, btnGreen, btnWhite } from '@/components/lstep/ui'
import { Modal } from '@/components/ui/modal'
import { useDialogs } from '@/components/ui/dialogs'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { errorText } from '@/lib/error-text'
import { previewMessagesOf } from '@/lib/template-message'
import type { PackDetail, PackItemView, TemplateFolderItem, TemplateSummary } from '@/lib/template-library'

const MAX_ITEMS = 5

/** メッセージ1通の作成・編集ダイアログ(種類のタブ+内容+プレビュー) */
function MessageDialog({
  open,
  accountId,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  accountId: string
  initial: { type: EditorType; data: EditorData } | null
  onClose: () => void
  onSave: (type: EditorType, data: EditorData) => Promise<void>
}) {
  const lookups = useActionLookups(accountId)
  const dialogs = useDialogs()
  const [type, setType] = useState<EditorType>('text')
  const [data, setData] = useState<EditorData>(emptyEditorData('text'))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setType(initial?.type ?? 'text')
    setData(initial?.data ?? emptyEditorData('text'))
    setDirty(false)
    setErrors([])
  }, [open, initial])

  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-6xl" closeOnBackdrop={false}>
      <div className="flex items-center justify-between border-b border-[#e3e3e6] px-5 py-3">
        <h2 className="text-sm font-bold">{initial ? 'メッセージ編集' : 'メッセージ新規追加'}</h2>
        <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl leading-none">×</button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
        {errors.length > 0 ? (
          <ul className="mb-3 space-y-0.5 rounded border border-[#e5451f] bg-[#fff5f3] px-4 py-3 text-sm text-[#e5451f]" role="alert">
            {errors.map((e) => (<li key={e}>{e}</li>))}
          </ul>
        ) : null}
        <TypeTabs
          value={type}
          onSelect={async (t) => {
            if (t === type) return
            if (dirty && !await dialogs.confirm('本当にタブを切り替えますか?\n切り替えると変更内容がリセットされます。', { okLabel: '切り替える', danger: true })) return
            setType(t)
            setData(emptyEditorData(t))
            setDirty(false)
          }}
        />
        <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0">
            <EditorBody type={type} data={data} onChange={(d) => { setData(d); setDirty(true); setErrors([]) }} env={{ accountId, lookups }} />
          </div>
          <aside>
            <h3 className="mb-1 text-xs font-bold">プレビュー</h3>
            <LiveEditorPreview type={type} data={data} senderId={null} />
          </aside>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-[#e3e3e6] px-5 py-3">
        <button type="button" onClick={onClose} className="h-10 w-28 rounded border border-[#cacace] bg-white text-sm hover:bg-[#f7f7f9]">キャンセル</button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            const errs = validateTemplate(type, data)
            if (errs.length > 0) { setErrors(errs); return }
            setBusy(true)
            try {
              await onSave(type, data)
            } catch (err) {
              setErrors([errorText(err, '保存できませんでした')])
            } finally {
              setBusy(false)
            }
          }}
          className="h-10 w-28 rounded bg-[#069e04] text-sm font-bold text-white hover:bg-[#058503] disabled:opacity-60"
        >
          保存
        </button>
      </div>
    </Modal>
  )
}

/** テンプレートから追加(パック以外のテンプレートを選ぶ) */
function TemplatePicker({ open, accountId, onClose, onPick }: { open: boolean; accountId: string; onClose: () => void; onPick: (t: TemplateSummary) => Promise<void> }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<TemplateSummary[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      api.tpl.items({ lineAccountId: accountId, folder: 'all', q, pageSize: 50 }).then((r) => { if (r.success) setItems(r.data.items.filter((i) => i.kind !== 'pack')) }).catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [open, q, accountId])
  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-xl" align="center">
      <div className="flex items-center justify-between border-b border-[#e3e3e6] px-5 py-3">
        <h2 className="text-sm font-bold">テンプレートから追加</h2>
        <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl leading-none">×</button>
      </div>
      <div className="px-5 py-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="検索" className="mb-2 h-9 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]" aria-label="テンプレートを検索" />
        <ul className="max-h-[22rem] divide-y divide-[#e3e3e6] overflow-y-auto">
          {items.map((t) => (
            <li key={t.id}>
              <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onPick(t) } finally { setBusy(false) } }} className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-[#f7f7f9]">
                <span className="min-w-0 flex-1 truncate font-bold">{t.name}</span>
                <span className="flex-shrink-0 rounded bg-[#f1f1f4] px-2 py-0.5 text-[10px] text-[#757578]">{t.typeLabel}</span>
              </button>
            </li>
          ))}
          {items.length === 0 ? <li className="py-6 text-center text-sm text-[#757578]">テンプレートがありません</li> : null}
        </ul>
      </div>
    </Modal>
  )
}

export default function PackPage() {
  const { selectedAccount } = useAccount()
  const accountId = selectedAccount?.id ?? ''
  const dialogs = useDialogs()
  const [id, setId] = useState<string | null>(null)
  const [pack, setPack] = useState<PackDetail | null>(null)
  const [folders, setFolders] = useState<TemplateFolderItem[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ item: PackItemView | null; initial: { type: EditorType; data: EditorData } | null } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [sorting, setSorting] = useState(false)
  const [caution, setCaution] = useState<PackItemView | null>(null)
  const [settingOpen, setSettingOpen] = useState(false)
  const [setName, setSetName] = useState('')
  const [setFolder, setSetFolder] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)

  useEffect(() => { setId(new URLSearchParams(window.location.search).get('id')) }, [])

  const load = useCallback(async () => {
    if (!id) return
    try {
      const r = await api.tpl.pack(id)
      if (r.success) setPack(r.data)
    } catch (err) {
      setError(errorText(err, 'パックを読み込めませんでした'))
    }
  }, [id])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!accountId) return
    api.tpl.folders(accountId).then((r) => { if (r.success) setFolders(r.data.folders) }).catch(() => {})
  }, [accountId])

  const items = pack?.items ?? []
  const previewMessages = useMemo(() => (pack ? previewMessagesOf(pack.messageType, pack.messageContent) : []), [pack])
  const backHref = `/templates${pack?.folderId ? `?folder=${pack.folderId}` : ''}`

  async function remove(it: PackItemView) {
    if (!await dialogs.confirm('このメッセージをパックから外しますか?', { okLabel: '外す', danger: true })) return
    await api.tpl.deletePackItem(it.id)
    await load()
  }

  async function copyAndEdit(it: PackItemView) {
    setCaution(null)
    if (!pack || !it.editorType || !it.editorData) return
    // 参照を、中身のコピーに置き換える(同じ位置のまま)
    const order = items.map((x) => x.id)
    const r = await api.tpl.addPackItem(pack.id, { editorType: it.editorType, editorData: it.editorData })
    if (!r.success) return
    await api.tpl.deletePackItem(it.id)
    order.splice(order.indexOf(it.id), 1, r.data.id)
    await api.tpl.reorderPackItems(pack.id, order)
    await load()
    setEditing({ item: r.data, initial: { type: it.editorType as EditorType, data: it.editorData as EditorData } })
  }

  async function dropOn(targetId: string) {
    const from = dragId.current
    dragId.current = null
    if (!from || !pack || from === targetId) return
    const ids = items.map((x) => x.id)
    ids.splice(ids.indexOf(from), 1)
    ids.splice(ids.indexOf(targetId), 0, from)
    await api.tpl.reorderPackItems(pack.id, ids)
    await load()
  }

  if (!selectedAccount) return <p className="p-6 text-sm text-[#757578]">アカウントを選択してください。</p>
  if (!pack) return <main className="mx-auto max-w-5xl p-6"><p className="text-sm text-[#757578]">{error || '読み込み中...'}</p></main>

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Header
        title={`メッセージパック「${pack.name}」`}
        action={
          <button type="button" className="h-9 rounded bg-[#f2a100] px-4 text-xs font-bold text-white hover:bg-[#d98f00]" onClick={() => { setSetName(pack.name); setSetFolder(pack.folderId); setSettingOpen(true) }}>
            ⚙ 設定
          </button>
        }
      />
      {error ? <p className="mb-3 text-sm text-[#e5451f]">{error}</p> : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" disabled={items.length >= MAX_ITEMS} onClick={() => setEditing({ item: null, initial: null })} className={`${btnGreen} disabled:opacity-50`}>メッセージ新規追加</button>
        <button type="button" disabled={items.length >= MAX_ITEMS} onClick={() => setPickerOpen(true)} className="inline-flex h-9 items-center rounded bg-[#2b7bb9] px-3 text-xs font-bold text-white hover:bg-[#226699] disabled:opacity-50">テンプレートから追加</button>
        <button type="button" disabled={items.length < 2} onClick={() => setSorting((v) => !v)} className={btnWhite}>{sorting ? '並び替えを終わる' : '並び替え'}</button>
        <button type="button" onClick={() => setPreviewOpen(true)} className={btnWhite}>プレビュー</button>
        <button type="button" disabled={items.length === 0} onClick={() => setTestOpen(true)} className={btnWhite}>テスト送信</button>
        <span className="ml-auto self-center text-xs text-[#757578]">{items.length}/{MAX_ITEMS}</span>
      </div>

      <div className="border-t border-[#e3e3e6]">
        {items.length === 0 ? <p className="border-b border-[#e3e3e6] py-8 text-center text-sm text-[#757578]">メッセージがありません</p> : null}
        {items.map((it, i) => (
          <div
            key={it.id}
            draggable={sorting}
            onDragStart={() => { dragId.current = it.id }}
            onDragOver={(e) => { if (sorting) e.preventDefault() }}
            onDrop={() => void dropOn(it.id)}
            className="flex items-center gap-3 border-b border-[#e3e3e6] bg-white px-3 py-3 text-sm"
          >
            {sorting ? <DragHandle /> : null}
            <span className="w-6 flex-shrink-0 text-center font-bold text-[#757578]">{i + 1}</span>
            <span className="flex-shrink-0 rounded bg-[#f1f1f4] px-2 py-0.5 text-[10px] text-[#757578]">{it.typeLabel}</span>
            <span className="min-w-0 flex-1">
              {it.templateId ? (
                <span className="mr-2 inline-block rounded bg-[#fff4de] px-1.5 py-0.5 text-[10px] font-bold text-[#a86b00]">{it.templateMissing ? 'テンプレート削除済み' : `テンプレート: ${it.templateName}`}</span>
              ) : null}
              <span className="break-words text-[#414143]">{it.summary}</span>
            </span>
            <button type="button" onClick={() => (it.templateId ? setCaution(it) : setEditing({ item: it, initial: it.editorType ? { type: it.editorType as EditorType, data: it.editorData as EditorData } : null }))} className="h-8 rounded border border-[#cacace] px-3 text-xs hover:bg-[#f7f7f9]">編集</button>
            <button type="button" onClick={() => void remove(it)} className="h-8 rounded border border-[#e5451f] px-3 text-xs text-[#e5451f] hover:bg-[#fff5f3]">削除</button>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Link href={backHref} className="text-xs text-[#2b7bb9] underline">テンプレート一覧へ戻る</Link>
      </div>

      <MessageDialog
        open={!!editing}
        accountId={accountId}
        initial={editing?.initial ?? null}
        onClose={() => setEditing(null)}
        onSave={async (type, data) => {
          if (editing?.item) {
            const r = await api.tpl.updatePackItem(editing.item.id, { editorType: type, editorData: data })
            if (!r.success) throw new Error('保存できませんでした')
          } else if (pack) {
            const r = await api.tpl.addPackItem(pack.id, { editorType: type, editorData: data })
            if (!r.success) throw new Error('追加できませんでした')
          }
          setEditing(null)
          await load()
        }}
      />

      <TemplatePicker
        open={pickerOpen}
        accountId={accountId}
        onClose={() => setPickerOpen(false)}
        onPick={async (t) => {
          const r = await api.tpl.addPackItem(pack.id, { templateId: t.id })
          if (!r.success) { setError('追加できませんでした'); return }
          setPickerOpen(false)
          await load()
        }}
      />

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidthClass="max-w-sm" align="center">
        <div className="flex items-center justify-between border-b border-[#e3e3e6] px-5 py-3">
          <h2 className="text-sm font-bold">メッセージ詳細</h2>
          <button type="button" onClick={() => setPreviewOpen(false)} aria-label="閉じる" className="text-xl leading-none">×</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4"><LinePreview messages={previewMessages} /></div>
        <div className="flex justify-end border-t border-[#e3e3e6] px-5 py-3">
          <button type="button" onClick={() => setPreviewOpen(false)} className="h-9 w-24 rounded border border-[#cacace] text-xs hover:bg-[#f7f7f9]">閉じる</button>
        </div>
      </Modal>

      <Modal open={!!caution} onClose={() => setCaution(null)} maxWidthClass="max-w-md" align="center">
        <div className="border-b border-[#e3e3e6] px-5 py-3"><h2 className="text-sm font-bold">テンプレート編集時の注意</h2></div>
        <p className="px-5 py-4 text-sm">テンプレートを編集すると、別の挿入箇所にも変更が反映されます。このメッセージのみ編集する場合は、「コピーして編集」をご利用ください。</p>
        <div className="flex justify-end gap-2 border-t border-[#e3e3e6] px-5 py-3 text-xs">
          <button type="button" onClick={() => setCaution(null)} className="h-9 rounded border border-[#cacace] px-4 hover:bg-[#f7f7f9]">閉じる</button>
          {caution?.editorData ? <button type="button" onClick={() => caution && void copyAndEdit(caution)} className="h-9 rounded border border-[#069e04] px-4 font-bold text-[#069e04] hover:bg-[#f3fbf3]">コピーして編集</button> : null}
          <Link href={`/templates/edit?id=${caution?.templateId ?? ''}`} className="inline-flex h-9 items-center rounded bg-[#069e04] px-4 font-bold text-white hover:bg-[#058503]">テンプレートを編集する</Link>
        </div>
      </Modal>

      <Modal open={settingOpen} onClose={() => setSettingOpen(false)} maxWidthClass="max-w-md" align="center">
        <div className="border-b border-[#e3e3e6] px-5 py-3"><h2 className="text-sm font-bold">パック設定</h2></div>
        <div className="space-y-3 px-5 py-4 text-xs">
          <label className="block"><span className="mb-1 block font-bold">テンプレート名</span><input value={setName} maxLength={200} onChange={(e) => setSetName(e.target.value)} className="h-9 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]" aria-label="パック名" /></label>
          <label className="block"><span className="mb-1 block font-bold">フォルダ</span>
            <select value={setFolder ?? ''} onChange={(e) => setSetFolder(e.target.value || null)} className="h-9 w-full rounded border border-[#cacace] bg-white px-2 text-sm" aria-label="フォルダ">
              <option value="">未分類</option>
              {folders.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e3e3e6] px-5 py-3 text-xs">
          <button type="button" onClick={() => setSettingOpen(false)} className="h-9 w-24 rounded border border-[#cacace] hover:bg-[#f7f7f9]">キャンセル</button>
          <button
            type="button"
            disabled={!setName.trim()}
            onClick={async () => {
              const r = await api.tpl.update(pack.id, { name: setName.trim(), folderId: setFolder }).catch(() => null)
              if (r?.success) { setSettingOpen(false); await load() }
            }}
            className="h-9 w-24 rounded bg-[#069e04] font-bold text-white hover:bg-[#058503] disabled:bg-[#cacace]"
          >
            保存
          </button>
        </div>
      </Modal>

      <TestSendDialog
        open={testOpen}
        accountId={accountId}
        onClose={() => setTestOpen(false)}
        onSend={async (friendIds) => {
          const r = await api.tpl.testSend({ lineAccountId: accountId, packId: pack.id, friendIds })
          if (!r.success) throw new Error('送信できませんでした')
          return r.data
        }}
      />
    </main>
  )
}
