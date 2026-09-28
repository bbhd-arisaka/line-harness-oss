'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'

type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'radio' | 'checkbox'

const FIELD_TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: 'text', label: '1行テキスト' },
  { value: 'textarea', label: '複数行テキスト' },
  { value: 'number', label: '数値' },
  { value: 'date', label: '日付' },
  { value: 'select', label: 'プルダウン選択' },
  { value: 'radio', label: '単一選択(ラジオ)' },
  { value: 'checkbox', label: '複数選択(チェックボックス)' },
]

const OPTION_TYPES: FieldType[] = ['select', 'radio', 'checkbox']

/** ラベルから項目キー(field_key)を機械的に作る。friends.metadata のJSONキーとして使う。 */
function slugifyFieldKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ぁ-んァ-ヶー一-龯]+/gi, '_')
    .replace(/^_+|_+$/g, '')
  return slug || `field_${Date.now()}`
}

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
  fieldType: FieldType
  options: string[]
  defaultValue: string | null
  displayOrder: number
}

const UNFILED = '__unfiled__'

export default function FriendFieldsPage() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [definitions, setDefinitions] = useState<Definition[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFolderId, setSelectedFolderId] = useState<string>(UNFILED)

  // フォルダ作成/リネーム
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [draftFolderName, setDraftFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)

  // 項目作成/編集
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [draftFieldType, setDraftFieldType] = useState<FieldType>('text')
  const [draftOptionsText, setDraftOptionsText] = useState('')
  const [savingField, setSavingField] = useState(false)
  const [fieldError, setFieldError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [foldersRes, definitionsRes] = await Promise.all([
        fetchApi<{ success: boolean; data: Folder[] }>('/api/friend-fields/folders'),
        fetchApi<{ success: boolean; data: Definition[] }>('/api/friend-fields/definitions'),
      ])
      if (foldersRes.success) setFolders(foldersRes.data)
      if (definitionsRes.success) setDefinitions(definitionsRes.data)
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const definitionsByFolder = useMemo(() => {
    const map = new Map<string, Definition[]>()
    for (const d of definitions) {
      const key = d.folderId ?? UNFILED
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(d)
    }
    return map
  }, [definitions])

  const visibleDefinitions = definitionsByFolder.get(selectedFolderId) ?? []

  // ── フォルダ ──────────────────────────────────────────────
  const openCreateFolder = () => {
    setEditingFolderId(null)
    setDraftFolderName('')
    setFolderDialogOpen(true)
  }
  const openEditFolder = (folder: Folder) => {
    setEditingFolderId(folder.id)
    setDraftFolderName(folder.name)
    setFolderDialogOpen(true)
  }
  const saveFolder = async () => {
    const name = draftFolderName.trim()
    if (!name || savingFolder) return
    setSavingFolder(true)
    try {
      if (editingFolderId) {
        await fetchApi(`/api/friend-fields/folders/${editingFolderId}`, {
          method: 'PUT',
          body: JSON.stringify({ name }),
        })
      } else {
        await fetchApi('/api/friend-fields/folders', {
          method: 'POST',
          body: JSON.stringify({ name, displayOrder: folders.length }),
        })
      }
      setFolderDialogOpen(false)
      await load()
    } finally {
      setSavingFolder(false)
    }
  }
  const deleteFolder = async (folder: Folder) => {
    if (!confirm(`フォルダ「${folder.name}」を削除しますか？(所属する項目は未分類に移動します)`)) return
    await fetchApi(`/api/friend-fields/folders/${folder.id}`, { method: 'DELETE' })
    if (selectedFolderId === folder.id) setSelectedFolderId(UNFILED)
    await load()
  }

  // ── 項目 ──────────────────────────────────────────────────
  const openCreateField = () => {
    setEditingFieldId(null)
    setDraftLabel('')
    setDraftFieldType('text')
    setDraftOptionsText('')
    setFieldError('')
    setFieldDialogOpen(true)
  }
  const openEditField = (def: Definition) => {
    setEditingFieldId(def.id)
    setDraftLabel(def.label)
    setDraftFieldType(def.fieldType)
    setDraftOptionsText(def.options.join(', '))
    setFieldError('')
    setFieldDialogOpen(true)
  }
  const saveField = async () => {
    const label = draftLabel.trim()
    if (!label || savingField) return
    setSavingField(true)
    setFieldError('')
    try {
      const payload = {
        folderId: selectedFolderId === UNFILED ? null : selectedFolderId,
        label,
        fieldType: draftFieldType,
        ...(OPTION_TYPES.includes(draftFieldType)
          ? { options: draftOptionsText.split(',').map((o) => o.trim()).filter(Boolean) }
          : { options: [] }),
      }
      if (editingFieldId) {
        await fetchApi(`/api/friend-fields/definitions/${editingFieldId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        const res = await fetchApi<{ success: boolean; error?: string }>('/api/friend-fields/definitions', {
          method: 'POST',
          body: JSON.stringify({ ...payload, fieldKey: slugifyFieldKey(label) }),
        })
        if (!res.success) {
          setFieldError(res.error || '保存できませんでした。');
          setSavingField(false)
          return
        }
      }
      setFieldDialogOpen(false)
      await load()
    } catch {
      setFieldError('保存できませんでした。もう一度お試しください。')
    } finally {
      setSavingField(false)
    }
  }
  const deleteField = async (def: Definition) => {
    if (!confirm(`項目「${def.label}」を削除しますか？`)) return
    await fetchApi(`/api/friend-fields/definitions/${def.id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <Header title="友だち情報欄管理" description="友だちごとに管理する項目(本名・カウンセリング情報など)をフォルダ分けして定義" />
      </div>

      {loading ? (
        <Loader />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
          {/* フォルダ一覧 */}
          <LayerCard className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-500">フォルダ</h3>
              <Button type="button" size="xs" variant="ghost" onClick={openCreateFolder}>+ 追加</Button>
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setSelectedFolderId(UNFILED)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm ${
                  selectedFolderId === UNFILED ? 'bg-kumo-control font-semibold text-kumo-brand' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span>未分類</span>
                <span className="text-xs text-gray-400 tabular-nums">{(definitionsByFolder.get(UNFILED) ?? []).length}</span>
              </button>
              {folders.map((folder) => (
                <div key={folder.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 pr-14 text-left text-sm ${
                      selectedFolderId === folder.id ? 'bg-kumo-control font-semibold text-kumo-brand' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="truncate">{folder.name}</span>
                    <span className="text-xs text-gray-400 tabular-nums">{(definitionsByFolder.get(folder.id) ?? []).length}</span>
                  </button>
                  <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                    <Button type="button" size="xs" shape="square" variant="ghost" onClick={() => openEditFolder(folder)} aria-label="編集">✎</Button>
                    <Button type="button" size="xs" shape="square" variant="ghost" onClick={() => deleteFolder(folder)} aria-label="削除">×</Button>
                  </div>
                </div>
              ))}
            </div>
          </LayerCard>

          {/* 項目一覧 */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                {selectedFolderId === UNFILED ? '未分類' : folders.find((f) => f.id === selectedFolderId)?.name}
              </h2>
              <Button type="button" size="sm" variant="primary" onClick={openCreateField}>+ 項目を追加</Button>
            </div>

            {visibleDefinitions.length === 0 ? (
              <Empty title="項目がありません" description="「項目を追加」で本名・電話番号などを定義してください。" />
            ) : (
              <LayerCard className="divide-y divide-gray-100 p-0">
                {visibleDefinitions.map((def) => (
                  <div key={def.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{def.label}</span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                          {FIELD_TYPE_OPTIONS.find((o) => o.value === def.fieldType)?.label ?? def.fieldType}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-gray-400">
                        key: {def.fieldKey}{def.options.length > 0 ? ` ・ 選択肢: ${def.options.join(', ')}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-none gap-1">
                      <Button type="button" size="xs" variant="secondary" onClick={() => openEditField(def)}>編集</Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => deleteField(def)}>削除</Button>
                    </div>
                  </div>
                ))}
              </LayerCard>
            )}
          </section>
        </div>
      )}

      {/* フォルダ作成/編集ダイアログ */}
      <Dialog.Root open={folderDialogOpen} onOpenChange={(open) => { if (!open && !savingFolder) setFolderDialogOpen(false) }}>
        <Dialog className="w-full max-w-sm p-5">
          <Dialog.Title>{editingFolderId ? 'フォルダ名を変更' : 'フォルダを追加'}</Dialog.Title>
          <Input
            label="フォルダ名"
            autoFocus
            value={draftFolderName}
            onChange={(e) => setDraftFolderName(e.target.value)}
            className="mt-4"
          />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFolderDialogOpen(false)} disabled={savingFolder}>キャンセル</Button>
            <Button type="button" variant="primary" loading={savingFolder} onClick={() => void saveFolder()} disabled={!draftFolderName.trim()}>保存</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      {/* 項目作成/編集ダイアログ */}
      <Dialog.Root open={fieldDialogOpen} onOpenChange={(open) => { if (!open && !savingField) setFieldDialogOpen(false) }}>
        <Dialog className="w-full max-w-md p-5">
          <Dialog.Title>{editingFieldId ? '項目を編集' : '項目を追加'}</Dialog.Title>
          <Input
            label="項目名(例: 本名)"
            autoFocus
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            className="mt-4"
          />
          <div className="mt-3">
            <label className="mb-1 block text-xs text-gray-500">回答形式</label>
            <Select
              value={draftFieldType}
              onValueChange={(v) => setDraftFieldType(v as FieldType)}
              items={FIELD_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
          {OPTION_TYPES.includes(draftFieldType) && (
            <Input
              className="mt-3"
              label="選択肢(カンマ区切り)"
              placeholder="例: 20代, 30代, 40代以上"
              value={draftOptionsText}
              onValueChange={setDraftOptionsText}
            />
          )}
          {editingFieldId === null && (
            <p className="mt-2 text-[11px] text-gray-400">
              保存後のキー(friends.metadataのJSONキー)は変更できません。
            </p>
          )}
          {fieldError && <Banner className="mt-3" size="sm" variant="error" title="保存できませんでした" description={fieldError} />}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFieldDialogOpen(false)} disabled={savingField}>キャンセル</Button>
            <Button type="button" variant="primary" loading={savingField} onClick={() => void saveField()} disabled={!draftLabel.trim()}>保存</Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}
