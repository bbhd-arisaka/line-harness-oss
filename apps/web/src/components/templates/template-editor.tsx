'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EDITOR_TYPE_LABEL, emptyEditorData, validateTemplate } from '@line-crm/shared'
import type { EditorData, EditorType, TemplateKind } from '@line-crm/shared'
import { useActionLookups } from '@/components/friend-add/use-action-lookups'
import Header from '@/components/layout/header'
import { useDialogs } from '@/components/ui/dialogs'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { errorText } from '@/lib/error-text'
import type { TemplateDetail, TemplateFolderItem } from '@/lib/template-library'
import { EditorBody, LiveEditorPreview, TypeTabs } from './editor-body'
import SenderField from './sender-field'
import TestSendDialog from './test-send-dialog'

const NAME_MAX = 200

/**
 * テンプレートの作成・編集(Lステップと同じ画面)。
 * 新規: テンプレート名・フォルダ・種類のタブ・内容・プレビュー。[登録][下書き保存][テスト送信]。
 * 編集: 同じ画面で [保存]。旧来のフレックス(JSON)は、JSON をそのまま編集する。
 */
export default function TemplateEditor({
  mode,
  id,
  kind,
  initialFolder,
  draftId: initialDraftId,
}: {
  mode: 'new' | 'edit'
  id?: string
  kind: TemplateKind
  initialFolder?: string | null
  draftId?: string | null
}) {
  const router = useRouter()
  const dialogs = useDialogs()
  const { selectedAccount } = useAccount()
  const accountId = selectedAccount?.id ?? ''
  const lookups = useActionLookups(accountId)

  const [loading, setLoading] = useState(mode === 'edit' || !!initialDraftId)
  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState<string | null>(initialFolder ?? null)
  const [folders, setFolders] = useState<TemplateFolderItem[]>([])
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [type, setType] = useState<EditorType>(kind === 'flex' ? 'flex' : 'text')
  const [data, setData] = useState<EditorData>(() => emptyEditorData(kind === 'flex' ? 'flex' : 'text'))
  const [senderId, setSenderId] = useState<string | null>(null)
  const [allowOverride, setAllowOverride] = useState(false)
  const [legacy, setLegacy] = useState<string | null>(null)
  const [detail, setDetail] = useState<TemplateDetail | null>(null)
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null)
  // 既存テンプレートの編集中に作った下書きを開いたときは、保存で作り直さず元のテンプレートを更新する
  const [targetId, setTargetId] = useState<string | null>(id ?? null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [testOpen, setTestOpen] = useState(false)
  const saved = useRef(false)

  const backHref = `/templates${folderId ? `?folder=${folderId}` : ''}`

  // フォルダ
  const loadFolders = useCallback(async () => {
    if (!accountId) return
    const r = await api.tpl.folders(accountId).catch(() => null)
    if (r?.success) setFolders(r.data.folders)
  }, [accountId])
  useEffect(() => { void loadFolders() }, [loadFolders])

  // 編集・下書きの読み込み
  useEffect(() => {
    if (mode === 'edit' && id) {
      api.tpl
        .item(id)
        .then((r) => {
          if (!r.success) return
          const d = r.data
          setDetail(d)
          setName(d.name)
          setFolderId(d.folderId)
          setSenderId(d.senderId)
          setAllowOverride(d.allowSenderOverride)
          if (d.editorType === 'legacy_flex') setLegacy(d.messageContent)
          else if (d.editorType !== 'pack') {
            setType(d.editorType)
            setData(d.editorData as EditorData)
          }
        })
        .catch(() => setNotice('テンプレートを読み込めませんでした'))
        .finally(() => setLoading(false))
    } else if (initialDraftId) {
      api.tpl
        .draft(initialDraftId)
        .then((r) => {
          if (!r.success) return
          const d = r.data
          setName(d.name)
          setFolderId(d.folderId)
          setType(d.editorType)
          setData(d.editorData)
          setSenderId(d.senderId)
          setAllowOverride(d.allowSenderOverride)
          if (d.templateId) setTargetId(d.templateId)
        })
        .catch(() => setNotice('下書きを読み込めませんでした'))
        .finally(() => setLoading(false))
    }
  }, [mode, id, initialDraftId])

  // 変更があるまま離れようとしたとき
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty && !saved.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const touch = () => { setDirty(true); setNotice(''); setErrors([]) }
  const env = useMemo(() => ({ accountId, lookups }), [accountId, lookups])

  async function changeType(next: EditorType) {
    if (next === type) return
    if (dirty && !await dialogs.confirm('本当にタブを切り替えますか?\n切り替えると変更内容がリセットされます。', { okLabel: '切り替える', danger: true })) return
    setType(next)
    setData(emptyEditorData(next))
    setDirty(false)
    setErrors([])
  }

  async function leave() {
    if (dirty && !saved.current && !await dialogs.confirm('編集内容が保存されていません。ページを離れますか?', { okLabel: '離れる', danger: true })) return
    saved.current = true
    router.push(backHref)
  }

  async function createFolder() {
    const n = (newFolder ?? '').trim()
    if (!n || !accountId) return
    const r = await api.tpl.createFolder(accountId, n).catch(() => null)
    if (r?.success) {
      await loadFolders()
      setFolderId(r.data.id)
      setNewFolder(null)
      touch()
    }
  }

  function validate(): string[] {
    const errs: string[] = []
    if (!name.trim()) errs.push('テンプレート名を入力してください')
    if (name.length > NAME_MAX) errs.push(`テンプレート名は${NAME_MAX}文字までです`)
    if (legacy === null) errs.push(...validateTemplate(type, data))
    else {
      try { JSON.parse(legacy) } catch { errs.push('内容がJSONとして正しくありません') }
    }
    return errs
  }

  async function save() {
    const errs = validate()
    if (errs.length > 0) { setErrors(errs); return }
    setBusy(true)
    setErrors([])
    try {
      if (targetId) {
        const r = await api.tpl.update(
          targetId,
          legacy !== null
            ? { name: name.trim(), folderId, legacyContent: legacy }
            : { lineAccountId: accountId, name: name.trim(), folderId, editorType: type, editorData: data, kind, senderId, allowSenderOverride: allowOverride },
        )
        if (!r.success) throw new Error('保存できませんでした')
        if (draftId) await api.tpl.deleteDrafts([draftId]).catch(() => {})
      } else {
        const r = await api.tpl.create({ lineAccountId: accountId, name: name.trim(), folderId, kind, editorType: type, editorData: data, senderId, allowSenderOverride: allowOverride, draftId })
        if (!r.success) throw new Error('登録できませんでした')
      }
      saved.current = true
      router.push(backHref)
    } catch (err) {
      setErrors([errorText(err, '保存できませんでした')])
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft() {
    setBusy(true)
    try {
      const r = await api.tpl.saveDraft(
        { lineAccountId: accountId, templateId: targetId, kind, editorType: type, name: name.trim(), folderId, editorData: data, senderId, allowSenderOverride: allowOverride },
        draftId,
      )
      if (r.success) {
        setDraftId(r.data.id)
        setDirty(false)
        setNotice('下書きを保存しました')
      }
    } catch (err) {
      setErrors([errorText(err, '下書きを保存できませんでした')])
    } finally {
      setBusy(false)
    }
  }

  if (!selectedAccount) return <p className="text-sm text-[#757578]">アカウントを選択してください。</p>
  if (loading) return <p className="text-sm text-[#757578]">読み込み中...</p>

  const title = mode === 'edit' ? 'テンプレート編集' : kind === 'flex' ? 'フレックスメッセージ作成' : 'テンプレート作成'

  return (
    <div className="pb-24">
      <Header title={title} />

      {errors.length > 0 ? (
        <ul className="mb-4 space-y-0.5 rounded border border-[#e5451f] bg-[#fff5f3] px-4 py-3 text-sm text-[#e5451f]" role="alert">
          {errors.map((e) => (<li key={e}>{e}</li>))}
        </ul>
      ) : null}
      {notice ? <p className="mb-4 rounded bg-[#e3f1e3] px-4 py-2 text-sm text-[#04770a]" role="status">{notice}</p> : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <label className="block text-xs">
          <span className="mb-1 flex items-center gap-1.5 font-bold">
            テンプレート名 <span className="rounded-sm bg-[#e5451f] px-1 py-0.5 text-[10px] text-white">必須</span>
            <span className="ml-auto font-normal text-[#757578]">{name.length}/{NAME_MAX}</span>
          </span>
          <input value={name} maxLength={NAME_MAX} onChange={(e) => { setName(e.target.value); touch() }} className="h-9 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]" aria-label="テンプレート名" />
        </label>
        <div className="text-xs">
          <span className="mb-1 block font-bold">フォルダ</span>
          {newFolder === null ? (
            <select
              value={folderId ?? ''}
              onChange={(e) => { if (e.target.value === '__new__') setNewFolder(''); else { setFolderId(e.target.value || null); touch() } }}
              className="h-9 w-full rounded border border-[#cacace] bg-white px-2 text-sm outline-none focus:border-[#069e04]"
              aria-label="フォルダ"
            >
              <option value="">未分類</option>
              {folders.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
              <option value="__new__">＋ 新しいフォルダ</option>
            </select>
          ) : (
            <div className="flex gap-1">
              <input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void createFolder() }} placeholder="フォルダ名" className="h-9 min-w-0 flex-1 rounded border border-[#cacace] px-2 text-sm outline-none focus:border-[#069e04]" aria-label="新しいフォルダ名" />
              <button type="button" onClick={() => void createFolder()} className="h-9 rounded bg-[#069e04] px-3 font-bold text-white">作成</button>
              <button type="button" onClick={() => setNewFolder(null)} aria-label="取り消し" className="h-9 rounded border border-[#cacace] px-2">×</button>
            </div>
          )}
        </div>
      </div>

      {legacy !== null ? (
        <div className="mt-6">
          <div className="mb-1 text-xs font-bold">内容(Flex Message の JSON)</div>
          <textarea value={legacy} onChange={(e) => { setLegacy(e.target.value); touch() }} rows={22} spellCheck={false} className="w-full rounded border border-[#cacace] p-3 font-mono text-xs outline-none focus:border-[#069e04]" aria-label="Flex JSON" />
        </div>
      ) : (
        <>
          {kind === 'standard' ? <div className="mt-6"><TypeTabs value={type} onSelect={(t) => void changeType(t)} /></div> : <div className="mt-6 border-b border-[#cacace] pb-2 text-sm font-bold">{EDITOR_TYPE_LABEL.flex}</div>}

          <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="min-w-0 space-y-5">
              <SenderField
                accountId={accountId}
                senderId={senderId}
                onSender={(s) => { setSenderId(s); touch() }}
                allowOverride={allowOverride}
                onAllowOverride={(v) => { setAllowOverride(v); touch() }}
                accountName={selectedAccount.displayName || selectedAccount.name}
                accountIcon={selectedAccount.pictureUrl}
              />
              <EditorBody type={type} data={data} onChange={(d) => { setData(d); touch() }} env={env} />
            </div>
            <aside className="xl:sticky xl:top-4 xl:self-start">
              <h3 className="mb-1 text-xs font-bold">プレビュー</h3>
              <LiveEditorPreview type={type} data={data} senderId={senderId} templateId={detail?.id} />
            </aside>
          </div>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e3e3e6] bg-white/95 px-6 py-3 backdrop-blur lg:left-60">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void leave()} className="text-xs text-[#2b7bb9] underline">テンプレート一覧へ戻る</button>
          <span className="ml-auto flex items-center gap-2">
            {legacy === null ? <button type="button" disabled={busy} onClick={() => setTestOpen(true)} className="h-10 rounded border border-[#cacace] bg-white px-5 text-sm hover:bg-[#f7f7f9]">テスト送信</button> : null}
            {legacy === null ? <button type="button" disabled={busy} onClick={() => void saveDraft()} className="h-10 rounded border border-[#069e04] bg-white px-5 text-sm font-bold text-[#069e04] hover:bg-[#f3fbf3]">下書き保存</button> : null}
            <button type="button" disabled={busy} onClick={() => void save()} className="h-10 w-32 rounded bg-[#069e04] text-sm font-bold text-white hover:bg-[#058503] disabled:opacity-60">
              {busy ? '保存中...' : targetId ? '保存' : '登録'}
            </button>
          </span>
        </div>
      </div>

      <TestSendDialog
        open={testOpen}
        accountId={accountId}
        onClose={() => setTestOpen(false)}
        onSend={async (friendIds) => {
          const errs = validateTemplate(type, data)
          if (errs.length > 0) { setErrors(errs); throw new Error(errs[0]) }
          const r = await api.tpl.testSend({ lineAccountId: accountId, editorType: type, editorData: data, senderId, friendIds })
          if (!r.success) throw new Error('送信できませんでした')
          return r.data
        }}
      />
    </div>
  )
}
