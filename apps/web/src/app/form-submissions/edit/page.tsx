'use client'

import { useDialogs } from '@/components/ui/dialogs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api, fetchApi } from '@/lib/api'
import { BlockCard } from '@/components/forms/block-card'
import { DesignModal, OptionModal } from '@/components/forms/modals'
import { PreviewPane } from '@/components/forms/preview-pane'
import type { PickerField, PickerFolder } from '@/components/forms/friend-field-picker'
import { Popover } from '@/components/lstep/ui'
import {
  BLOCK_MENU,
  DISPLAY_ONLY_TYPES,
  draftFromApi,
  draftToPayload,
  duplicateBlock,
  emptyDraft,
  newBlock,
  type BlockDraft,
  type FieldType,
  type FormDraft,
} from '@/components/forms/editor-types'

interface Folder { id: string; name: string }
interface Snapshot { blocks: BlockDraft[]; sectionCount: number }

/** 指定した入れ物の「中だけ」をスムーズにスクロールして、要素を見える位置へ動かす(画面全体は動かさない)。 */
function scrollWithin(containerId: string, elementId: string, align: 'center' | 'nearest') {
  const container = document.getElementById(containerId)
  const el = document.getElementById(elementId)
  if (!container || !el) return
  const c = container.getBoundingClientRect()
  const e = el.getBoundingClientRect()
  let top = container.scrollTop + (e.top - c.top)
  if (align === 'center') {
    top -= (c.height - e.height) / 2
  } else if (e.top >= c.top && e.bottom <= c.bottom) {
    return // すでに見えている
  } else if (e.bottom > c.bottom) {
    top = container.scrollTop + (e.bottom - c.bottom) + 12
  } else {
    top = container.scrollTop + (e.top - c.top) - 12
  }
  container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

const toolBtn = 'px-2 py-1 text-xs font-bold text-[#069e04] disabled:text-[#9fd49d] disabled:cursor-not-allowed'

export default function FormEditPage() {
  const dialogs = useDialogs()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [formId, setFormId] = useState<string | null>(null)
  const [formUrl, setFormUrl] = useState<string | null>(null)
  const [draft, setDraft] = useState<FormDraft>(emptyDraft(''))
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([])
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([])
  const [pickerFields, setPickerFields] = useState<PickerField[]>([])
  const [pickerFolders, setPickerFolders] = useState<PickerFolder[]>([])
  const [sheetsEmail, setSheetsEmail] = useState<string | null>(null)

  const [section, setSection] = useState(1) // 0=共通ヘッダ
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sectionMenu, setSectionMenu] = useState<number | null>(null)
  const [modal, setModal] = useState<'design' | 'option' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  // 元に戻す/やり直し(ブロックの増減・並び替え・編集が対象)
  const [past, setPast] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    const group = params.get('group') ?? ''
    setFormId(id)
    ;(async () => {
      try {
        const [fRes, tRes, sRes, dRes, pfRes, gRes] = await Promise.all([
          fetchApi<{ success: boolean; data: Folder[] }>('/api/forms/folders'),
          api.tags.list(),
          api.scenarios.list(),
          fetchApi<{ success: boolean; data: PickerField[] }>('/api/friend-fields/definitions'),
          fetchApi<{ success: boolean; data: PickerFolder[] }>('/api/friend-fields/folders'),
          fetchApi<{ success: boolean; data: { serviceAccountEmail: string | null } }>('/api/forms/integrations/google-sheets').catch(() => null),
        ])
        if (fRes.success) setFolders(fRes.data)
        if (tRes.success) setTags(tRes.data.map((t) => ({ id: t.id, name: t.name })))
        if (sRes.success) setScenarios(sRes.data.map((s) => ({ id: s.id, name: s.name })))
        if (dRes.success) setPickerFields(dRes.data)
        if (pfRes.success) setPickerFolders(pfRes.data)
        if (gRes && gRes.success) setSheetsEmail(gRes.data.serviceAccountEmail)
        if (id) {
          const res = await fetchApi<{ success: boolean; data: Record<string, unknown> }>(`/api/forms/${id}`)
          if (res.success) {
            setDraft(draftFromApi(res.data))
            setFormUrl((res.data.formUrl as string | null) ?? null)
          } else {
            setError('フォームが見つかりませんでした')
          }
        } else {
          setDraft(emptyDraft(group))
        }
      } catch {
        setError('読み込みに失敗しました')
      } finally {
        setReady(true)
      }
    })()
  }, [])

  // 未保存のまま離れようとしたときの確認
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const patch = useCallback((p: Partial<FormDraft>) => { setDraft((d) => ({ ...d, ...p })); setDirty(true) }, [])

  /** ブロック構造を変える操作は、履歴に積んでから反映する。 */
  const commit = useCallback((blocks: BlockDraft[], sectionCount?: number) => {
    setDraft((d) => {
      setPast((p) => [...p.slice(-49), { blocks: d.blocks, sectionCount: d.sectionCount }])
      setFuture([])
      return { ...d, blocks, sectionCount: sectionCount ?? d.sectionCount }
    })
    setDirty(true)
  }, [])

  const undo = () => {
    const prev = past[past.length - 1]
    if (!prev) return
    setFuture((f) => [{ blocks: draft.blocks, sectionCount: draft.sectionCount }, ...f])
    setPast((p) => p.slice(0, -1))
    setDraft((d) => ({ ...d, blocks: prev.blocks, sectionCount: prev.sectionCount }))
    setSection((s) => Math.min(s, prev.sectionCount))
  }
  const redo = () => {
    const next = future[0]
    if (!next) return
    setPast((p) => [...p, { blocks: draft.blocks, sectionCount: draft.sectionCount }])
    setFuture((f) => f.slice(1))
    setDraft((d) => ({ ...d, blocks: next.blocks, sectionCount: next.sectionCount }))
  }

  const sectionBlocks = useMemo(() => draft.blocks.filter((b) => b.section === section), [draft.blocks, section])
  const selectedBlock = draft.blocks.find((b) => b.rowId === selectedRowId) ?? null
  const selectedInSection = selectedBlock?.section === section ? selectedBlock : null

  // プレビューで項目を押したら、その編集カードへスムーズにスクロールする。
  // 共通ヘッダの項目は、どのセクションのプレビューにも出るため、必要なら先に共通ヘッダのタブへ切り替える。
  const [pendingScroll, setPendingScroll] = useState<number | null>(null)
  function selectFromPreview(rowId: number) {
    const b = draft.blocks.find((x) => x.rowId === rowId)
    if (!b) return
    setSelectedRowId(rowId)
    if (b.section !== section) setSection(b.section)
    setPendingScroll(rowId)
  }
  // 編集カードを選んだら、プレビュー側の該当項目も見える位置へ(こちらもスムーズスクロール)
  useEffect(() => {
    if (selectedRowId === null) return
    scrollWithin('preview-scroll', `preview-block-${selectedRowId}`, 'nearest')
  }, [selectedRowId])

  useEffect(() => {
    if (pendingScroll === null) return
    const id = requestAnimationFrame(() => {
      scrollWithin('block-list-scroll', `block-card-${pendingScroll}`, 'center')
      setPendingScroll(null)
    })
    return () => cancelAnimationFrame(id)
  }, [pendingScroll, section])

  function addBlock(type: FieldType) {
    setMenuOpen(false)
    const b = newBlock(type, section)
    // 選択中のブロックの直後に挿入。無ければセクション末尾。
    const idx = selectedInSection ? draft.blocks.findIndex((x) => x.rowId === selectedInSection.rowId) + 1 : -1
    let blocks: BlockDraft[]
    if (idx > 0) {
      blocks = [...draft.blocks.slice(0, idx), b, ...draft.blocks.slice(idx)]
    } else {
      const lastIdx = draft.blocks.map((x) => x.section).lastIndexOf(section)
      blocks = lastIdx >= 0 ? [...draft.blocks.slice(0, lastIdx + 1), b, ...draft.blocks.slice(lastIdx + 1)] : [...draft.blocks, b]
    }
    commit(blocks)
    setSelectedRowId(b.rowId)
  }

  function updateBlock(rowId: number, p: Partial<BlockDraft>) {
    setDraft((d) => ({ ...d, blocks: d.blocks.map((b) => (b.rowId === rowId ? { ...b, ...p } : b)) }))
    setDirty(true)
  }

  function moveSelected(dir: -1 | 1) {
    if (!selectedInSection) return
    const inSec = sectionBlocks
    const i = inSec.findIndex((b) => b.rowId === selectedInSection.rowId)
    const j = i + dir
    if (j < 0 || j >= inSec.length) return
    const swapped = [...inSec]
    ;[swapped[i], swapped[j]] = [swapped[j], swapped[i]]
    // セクション内の並びだけ入れ替え、他セクションの位置は保つ
    let k = 0
    commit(draft.blocks.map((b) => (b.section === section ? swapped[k++] : b)))
  }

  function duplicateSelected() {
    if (!selectedInSection) return
    const copy = duplicateBlock(selectedInSection)
    const idx = draft.blocks.findIndex((b) => b.rowId === selectedInSection.rowId) + 1
    commit([...draft.blocks.slice(0, idx), copy, ...draft.blocks.slice(idx)])
    setSelectedRowId(copy.rowId)
  }

  function deleteSelected() {
    if (!selectedInSection) return
    commit(draft.blocks.filter((b) => b.rowId !== selectedInSection.rowId))
    setSelectedRowId(null)
  }

  function addSection() {
    const n = draft.sectionCount + 1
    commit(draft.blocks, n)
    setSection(n)
    setSelectedRowId(null)
  }

  async function deleteSection(num: number) {
    setSectionMenu(null)
    if (draft.sectionCount <= 1) { void dialogs.alert('セクションは最低1つ必要です'); return }
    if (!await dialogs.confirm(`セクション${num}を削除しますか?\nこのセクションのブロックも削除されます。`)) return
    const blocks = draft.blocks
      .filter((b) => b.section !== num)
      .map((b) => (b.section > num ? { ...b, section: b.section - 1 } : b))
    commit(blocks, draft.sectionCount - 1)
    setSection((s) => Math.max(1, Math.min(s > num ? s - 1 : s, draft.sectionCount - 1)))
    setSelectedRowId(null)
  }

  async function save() {
    setError('')
    if (!draft.name.trim()) { setError('フォーム名を入力してください'); return }
    const emptyIdx = draft.blocks.findIndex((b) => b.type !== 'image' && !b.label.trim())
    if (emptyIdx >= 0) {
      const b = draft.blocks[emptyIdx]
      setSection(b.section)
      setSelectedRowId(b.rowId)
      setError('タイトルが未入力のブロックがあります')
      return
    }
    const bad = draft.blocks.find((b) => !DISPLAY_ONLY_TYPES.includes(b.type) && ['select', 'radio', 'checkbox'].includes(b.type) && b.options.filter((o) => o.trim()).length === 0)
    if (bad) { setSection(bad.section); setSelectedRowId(bad.rowId); setError('選択肢が1つも入力されていないブロックがあります'); return }
    setSaving(true)
    try {
      const payload = draftToPayload(draft)
      const res = formId
        ? await fetchApi<{ success: boolean; error?: string }>(`/api/forms/${formId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await fetchApi<{ success: boolean; error?: string }>('/api/forms', { method: 'POST', body: JSON.stringify(payload) })
      if (!res.success) { setError(res.error || '保存に失敗しました'); return }
      setDirty(false)
      router.push(`/form-submissions?group=${draft.folderId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  function preview() {
    if (formUrl) window.open(formUrl, '_blank', 'noopener')
    else void dialogs.alert('プレビューは、フォームを保存してから開けます。')
  }

  const sectionTabs = [0, ...Array.from({ length: draft.sectionCount }, (_, i) => i + 1)]
  const numberInSection = (b: BlockDraft) => sectionBlocks.findIndex((x) => x.rowId === b.rowId) + 1

  return (
    <div>
      {/* 上部バー */}
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pb-3">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="mb-1 text-xs font-bold">フォーム名</p>
            <input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className="h-9 w-64 rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]"
            />
          </div>
          <div className="border-l border-[#e3e3e6] pl-4">
            <p className="mb-1 text-xs font-bold">フォルダ</p>
            <select
              value={draft.folderId}
              onChange={(e) => patch({ folderId: e.target.value })}
              className="h-9 w-52 rounded border border-[#cacace] bg-white px-2 text-sm"
            >
              <option value="">未分類</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="border-l border-[#e3e3e6] pl-4">
            <p className="mb-1 text-xs font-bold">デザイン</p>
            <button type="button" onClick={() => setModal('design')} className="h-9 rounded border border-[#cacace] bg-white px-3 text-xs hover:bg-[#f7f7f9]">デザイン設定</button>
          </div>
          <div className="border-l border-[#e3e3e6] pl-4">
            <p className="mb-1 text-xs font-bold">オプション</p>
            <button type="button" onClick={() => setModal('option')} className="h-9 rounded border border-[#cacace] bg-white px-3 text-xs hover:bg-[#f7f7f9]">オプション設定</button>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <button type="button" onClick={preview} className="text-xs font-bold text-[#069e04]">プレビュー</button>
          <button
            type="button"
            disabled={saving || !ready}
            onClick={() => void save()}
            className="h-10 rounded bg-[#069e04] px-6 text-sm font-bold text-white hover:bg-[#058503] disabled:opacity-60"
          >
            {saving ? '保存中...' : 'フォームを保存'}
          </button>
        </div>
      </div>
      {error && <p className="mb-2 px-1 text-sm font-bold text-[#e5451f]">{error}</p>}

      {!ready ? (
        <p className="p-6 text-sm text-[#757578]">読み込み中...</p>
      ) : (
        <div className="flex h-[calc(100vh-13rem)] min-h-[28rem] border border-[#e3e3e6] bg-white">
          {/* 右: セクションとブロック */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-end gap-1 border-b-[3px] border-[#069e04] bg-[#dff3df] px-2 pt-2">
              {sectionTabs.map((n) => (
                <div key={n} className="relative">
                  <button
                    type="button"
                    onClick={() => { setSection(n); setSelectedRowId(null) }}
                    className={`flex items-center gap-1.5 rounded-t px-4 py-2 text-sm font-bold ${
                      section === n ? 'bg-[#069e04] text-white' : 'bg-white text-[#414143] hover:bg-[#f3fbf3]'
                    }`}
                  >
                    {n === 0 ? '共通ヘッダ' : `セクション${n}`}
                    {n !== 0 && section === n && (
                      <span
                        role="button"
                        aria-label="セクションメニュー"
                        onClick={(e) => { e.stopPropagation(); setSectionMenu((v) => (v === n ? null : n)) }}
                        className="text-xs"
                      >
                        ▾
                      </span>
                    )}
                  </button>
                  <Popover open={sectionMenu === n} onClose={() => setSectionMenu(null)} align="left">
                      <button type="button" className="block w-full px-3 py-1.5 text-left text-[#e5451f] hover:bg-[#f1f1f4]" onClick={() => deleteSection(n)}>セクションを削除</button>
                    </Popover>
                </div>
              ))}
              <button
                type="button"
                onClick={addSection}
                aria-label="セクションを追加"
                className="mb-2 ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#069e04] text-sm font-bold leading-none text-white"
              >
                +
              </button>
            </div>

            <div className="flex items-center justify-between border-b border-[#e3e3e6] bg-[#f4f4f4] px-4 py-2">
              <span className="text-sm font-bold">ブロック設定</span>
              <div className="flex items-center gap-1">
                <button type="button" className={toolBtn} disabled={past.length === 0} onClick={undo} aria-label="元に戻す">↶</button>
                <button type="button" className={toolBtn} disabled={future.length === 0} onClick={redo} aria-label="やり直す">↷</button>
                <button type="button" className={toolBtn} disabled={!selectedInSection} onClick={() => moveSelected(-1)}>上に移動</button>
                <button type="button" className={toolBtn} disabled={!selectedInSection} onClick={() => moveSelected(1)}>下に移動</button>
                <button type="button" className={toolBtn} disabled={!selectedInSection} onClick={duplicateSelected}>複製</button>
                <button type="button" className={toolBtn} disabled={!selectedInSection} onClick={deleteSelected}>削除</button>
                <div className="relative ml-2">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    className="h-8 rounded bg-[#069e04] px-3 text-xs font-bold text-white hover:bg-[#058503]"
                  >
                    ＋ブロックを追加 ▾
                  </button>
                  <Popover open={menuOpen} onClose={() => setMenuOpen(false)}>
                      {BLOCK_MENU.map((m, i) =>
                        m.type === 'divider' ? (
                          <div key={i} className="my-1 border-t border-[#e3e3e6]" />
                        ) : (
                          <button
                            key={m.type}
                            type="button"
                            className="block w-full whitespace-nowrap px-4 py-1.5 text-left text-sm hover:bg-[#f1f1f4]"
                            onClick={() => addBlock(m.type as FieldType)}
                          >
                            {m.label}
                          </button>
                        ),
                      )}
                    </Popover>
                </div>
              </div>
            </div>

            <div id="block-list-scroll" className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f4f4f4] p-4">
              {section === 0 && (
                <p className="text-[11px] text-[#757578]">共通ヘッダのブロックは、すべてのセクションの先頭に表示されます(画像・見出し・テキスト・ボタンなど)。</p>
              )}
              {sectionBlocks.length === 0 ? (
                <p className="flex h-full min-h-[10rem] items-center justify-center text-base font-bold text-[#757578]">
                  「ブロックを追加」から作成してください
                </p>
              ) : (
                sectionBlocks.map((b) => (
                  <BlockCard
                    key={b.rowId}
                    block={b}
                    number={numberInSection(b)}
                    selected={b.rowId === selectedRowId}
                    pickerFields={pickerFields}
                    pickerFolders={pickerFolders}
                    tags={tags}
                    scenarios={scenarios}
                    onFieldCreated={(f) => setPickerFields((prev) => [...prev, f])}
                    onSelect={() => setSelectedRowId(b.rowId)}
                    onChange={(p) => updateBlock(b.rowId, p)}
                  />
                ))
              )}
            </div>
          </div>
          {/* 右: プレビュー */}
          <div className="w-[21rem] flex-shrink-0 border-l border-[#e3e3e6]">
            <PreviewPane draft={draft} section={section} selectedRowId={selectedRowId} onSelect={selectFromPreview} />
          </div>

        </div>
      )}

      <p className="mt-3 px-1 text-xs">
        <Link
          href={`/form-submissions?group=${draft.folderId}`}
          className="text-[#2b7bb9] underline"
          onClick={(e) => {
            if (!dirty) return
            e.preventDefault()
            void dialogs.confirm('保存されていない変更があります。破棄して戻りますか?', { okLabel: '破棄して戻る', danger: true }).then((ok) => {
              if (ok) { setDirty(false); router.push(`/form-submissions?group=${draft.folderId}`) }
            })
          }}
        >
          戻る
        </Link>
      </p>

      <DesignModal open={modal === 'design'} draft={draft} onClose={() => setModal(null)} onSave={(p) => { patch(p); setModal(null) }} />
      <OptionModal
          open={modal === 'option'}
          draft={draft}
          tags={tags}
          scenarios={scenarios}
          sheetsEmail={sheetsEmail}
          onClose={() => setModal(null)}
          onSave={(p) => { patch(p); setModal(null) }}
        />
    </div>
  )
}
