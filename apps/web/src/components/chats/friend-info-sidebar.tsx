'use client'

import { useState, useEffect } from 'react'
import { XIcon } from '@phosphor-icons/react'
import { api, fetchApi, type MileageHistoryItem, type MileageSummary } from '@/lib/api'
import { Button } from '@cloudflare/kumo/components/button'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'
import { FriendFieldPicker, type PickerFolder } from '@/components/forms/friend-field-picker'
import { FriendNameEditDialog, NameEditPencil, resolveFriendName } from '@/components/friends/friend-name-edit-dialog'

interface FriendDetail {
  id: string
  displayName: string | null
  pictureUrl: string | null
  isFollowing: boolean
  metadata: Record<string, unknown>
  realName: string | null
  systemDisplayName: string | null
  memo: string | null
  refCode: string | null
  createdAt: string
  tags: Array<{ id: string; name: string; color: string }>
  formSubmissions: Array<{
    id: string
    formId: string
    formName: string
    fields: Array<{ name: string; label: string }>
    data: Record<string, unknown>
    createdAt: string
  }>
}

interface ChatStatusInfo {
  status: 'unread' | 'in_progress' | 'resolved' | null
  notes: string | null
}

interface Props {
  friendId: string | null
  /** 表示名(本名/システム表示名)を保存した後に呼ばれる。親側の一覧・ヘッダー再取得用 */
  onNameChanged?: () => void
  /** 親 (ChatDetail) が持っている chat 側の情報 — status / notes */
  chatStatus?: ChatStatusInfo
  /** 担当者名 (ChatDetail で operatorId → name 変換済を渡す想定) */
  operatorName?: string | null
  /** 編集可能メモ (OAMのノート相当)。onSaveNotes が渡された時のみ編集UIを出す */
  notesValue?: string
  onNotesChange?: (value: string) => void
  onSaveNotes?: () => void
  savingNotes?: boolean
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const statusLabels: Record<NonNullable<ChatStatusInfo['status']>, { label: string; className: string }> = {
  unread: { label: '未対応', className: 'bg-red-100 text-red-700' },
  in_progress: { label: '対応中', className: 'bg-yellow-100 text-yellow-700' },
  resolved: { label: '解決済', className: 'bg-green-100 text-green-700' },
}

/**
 * よく使うキーだけ日本語ラベルを付ける。それ以外(Lステップの独自項目等)は
 * キー名をそのまま出す — 項目を決め打ちで列挙すると増えるたびに直す羽目になる。
 */
const METADATA_LABELS: Record<string, string> = {
  lstep_member_id: 'Lステップ会員ID(移行元)',
}

interface FieldDef {
  id: string
  folderId: string | null
  fieldKey: string
  label: string
  fieldType: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'image' | 'pdf' | 'select' | 'radio' | 'checkbox'
  options: string[]
}


let metadataRowSeq = 0
interface MetadataRow { rowId: number; key: string; value: string }

/** Render a metadata value safely as text. Objects/arrays → JSON, primitives → as-is. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value || '-'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '[unparseable]'
  }
}

export default function FriendInfoSidebar({ friendId, onNameChanged, chatStatus, operatorName, notesValue, onNotesChange, onSaveNotes, savingNotes }: Props) {
  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [nameDialogOpen, setNameDialogOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  type MileageState =
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'data'; summary: MileageSummary; history: MileageHistoryItem[] }
  const [mileage, setMileage] = useState<MileageState>({ kind: 'loading' })

  // 本名 — 友だち情報(metadata)とは別の専用項目。インライン編集。
  const [editingRealName, setEditingRealName] = useState(false)
  const [draftRealName, setDraftRealName] = useState('')
  const [savingRealName, setSavingRealName] = useState(false)

  const [editingMetadata, setEditingMetadata] = useState(false)
  const [metadataRows, setMetadataRows] = useState<MetadataRow[]>([])
  const [savingMetadata, setSavingMetadata] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([])
  const [fieldFolders, setFieldFolders] = useState<PickerFolder[]>([])

  // 友だち情報欄の定義(本名など、事前に登録された項目)。友だち一覧全体で共通なので一度だけ取得。
  useEffect(() => {
    fetchApi<{ success: boolean; data: FieldDef[] }>('/api/friend-fields/definitions')
      .then((res) => { if (res.success) setFieldDefs(res.data) })
      .catch(() => { /* silent */ })
    fetchApi<{ success: boolean; data: PickerFolder[] }>('/api/friend-fields/folders')
      .then((res) => { if (res.success) setFieldFolders(res.data) })
      .catch(() => { /* silent */ })
  }, [])
  const fieldDefsByKey = new Map(fieldDefs.map((d) => [d.fieldKey, d]))

  function startEditingRealName(current: string | null) {
    setDraftRealName(current ?? '')
    setEditingRealName(true)
  }

  async function saveRealName(friendId: string) {
    setSavingRealName(true)
    try {
      const res = await api.friends.updateProfile(friendId, { realName: draftRealName.trim() || null })
      if (res.success && res.data) {
        setFriend(res.data as unknown as FriendDetail)
        setEditingRealName(false)
      }
    } finally {
      setSavingRealName(false)
    }
  }

  function startEditingMetadata(current: Record<string, unknown>) {
    const rows = Object.entries(current).map(([key, value]) => ({
      rowId: metadataRowSeq++,
      key,
      value: typeof value === 'string' ? value : renderValue(value),
    }))
    setMetadataRows(rows)
    setMetadataError(null)
    setEditingMetadata(true)
  }

  async function saveMetadata(friendId: string, original: Record<string, unknown>) {
    setSavingMetadata(true)
    setMetadataError(null)
    try {
      const payload: Record<string, string | null> = {}
      const seenKeys = new Set<string>()
      for (const row of metadataRows) {
        const key = row.key.trim()
        if (!key) continue
        payload[key] = row.value
        seenKeys.add(key)
      }
      // 元にあったが編集後に無くなったキーは null を送って削除する(サーバー側の仕様)。
      for (const key of Object.keys(original)) {
        if (!seenKeys.has(key)) payload[key] = null
      }
      const res = await api.friends.updateMetadata(friendId, payload)
      if (res.success && res.data) {
        setFriend(res.data as unknown as FriendDetail)
        setEditingMetadata(false)
      } else {
        setMetadataError((res as { error?: string }).error ?? '保存に失敗しました')
      }
    } catch (err) {
      setMetadataError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSavingMetadata(false)
    }
  }

  useEffect(() => {
    setEditingMetadata(false)
    setMetadataError(null)
    if (!friendId) {
      setFriend(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api.friends.get(friendId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setFriend(res.data as unknown as FriendDetail)
      } else {
        setError((res as { error?: string }).error ?? '友だち情報を取得できませんでした')
      }
    }).catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [friendId])

  useEffect(() => {
    if (!friendId) {
      setMileage({ kind: 'loading' })
      return
    }
    let cancelled = false
    setMileage({ kind: 'loading' })
    api.friends.mileage(friendId, 10).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setMileage({ kind: 'data', ...res.data })
      } else {
        setMileage({ kind: 'error' })
      }
    }).catch(() => {
      if (!cancelled) setMileage({ kind: 'error' })
    })
    return () => { cancelled = true }
  }, [friendId])

  // リッチメニュー — loading / error / data を区別して、null=未設定 を取得失敗と
  // 混同しないようにする。Codex review (P3) の指摘で導入。
  type RichMenuState =
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'data'; id: string | null; name: string | null; isDefault: boolean }
  const [richMenu, setRichMenu] = useState<RichMenuState>({ kind: 'loading' })

  useEffect(() => {
    if (!friendId) {
      setRichMenu({ kind: 'loading' })
      return
    }
    let cancelled = false
    setRichMenu({ kind: 'loading' })
    api.friends.richMenu(friendId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setRichMenu({ kind: 'data', ...res.data })
      } else {
        setRichMenu({ kind: 'error' })
      }
    }).catch(() => {
      if (cancelled) return
      setRichMenu({ kind: 'error' })
    })
    return () => { cancelled = true }
  }, [friendId])

  if (!friendId) return null

  return (
    <div className="w-full lg:w-72 xl:w-80 2xl:w-96 lg:flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">友だち詳細</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-32" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-red-600">{error}</div>
        ) : friend ? (
          <div className="divide-y divide-gray-100">
            {/* Profile Header */}
            <div className="p-4 flex items-start gap-3">
              {friend.pictureUrl ? (
                <img src={friend.pictureUrl} alt="" className="w-12 h-12 rounded-full flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-gray-500 text-base">{(friend.displayName || '?').charAt(0)}</span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{resolveFriendName(friend)}</p>
                  <NameEditPencil onClick={() => setNameDialogOpen(true)} />
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  登録日: {formatDate(friend.createdAt)}
                </p>
                {!friend.isFollowing && (
                  <span className="inline-block mt-1 px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                    ブロック済
                  </span>
                )}
              </div>
            </div>

            <FriendNameEditDialog
              friend={friend}
              open={nameDialogOpen}
              onClose={() => setNameDialogOpen(false)}
              onSaved={(u) => {
                setFriend((prev) => (prev ? { ...prev, ...u } : prev))
                onNameChanged?.()
              }}
            />

            {/* 本名 — 友だち情報(metadata)とは別の専用項目(Lステップ新形式準拠) */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-[11px] font-medium text-gray-500">本名</h4>
                {!editingRealName && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => startEditingRealName(friend.realName)}
                  >
                    編集
                  </Button>
                )}
              </div>
              {editingRealName ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    className="min-w-0 flex-1 text-xs"
                    aria-label="本名"
                    placeholder="山田花子"
                    value={draftRealName}
                    onValueChange={setDraftRealName}
                  />
                  <Button type="button" size="xs" variant="primary" loading={savingRealName} onClick={() => void saveRealName(friend.id)}>保存</Button>
                  <Button type="button" size="xs" variant="secondary" onClick={() => setEditingRealName(false)}>取消</Button>
                </div>
              ) : (
                <p className="text-xs text-gray-700">{friend.realName || <span className="text-gray-400">未設定</span>}</p>
              )}
            </div>

            {/* Harness Mileage — canonical user identity across LINE accounts */}
            <div className="p-4">
              <h4 className="text-[11px] font-medium text-gray-500 mb-2">マイル</h4>
              {mileage.kind === 'loading' ? (
                <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
              ) : mileage.kind === 'error' ? (
                <p className="text-[11px] text-red-500 italic">マイルの取得に失敗しました</p>
              ) : (
                <div className="overflow-hidden rounded-xl bg-gradient-to-br from-gray-900 via-gray-700 to-amber-800 p-3.5 text-white shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold text-white/70">{mileage.summary.programName}</p>
                      <p className="mt-0.5 text-2xl font-bold tabular-nums">
                        {mileage.summary.available.toLocaleString('ja-JP')}
                        <span className="ml-1 text-[11px] font-semibold text-white/70">mile</span>
                      </p>
                      <p className="text-[10px] text-white/60">利用可能</p>
                    </div>
                    {mileage.summary.pending > 0 && (
                      <span className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-medium">
                        確定待ち {mileage.summary.pending.toLocaleString('ja-JP')}
                      </span>
                    )}
                  </div>

                  {mileage.history.length > 0 ? (
                    <div className="mt-3 space-y-1.5 border-t border-white/15 pt-2.5">
                      {mileage.history.slice(0, 3).map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="min-w-0 truncate text-white/75">{item.reason}</span>
                          <span className={`shrink-0 font-semibold tabular-nums ${item.amount > 0 ? 'text-amber-200' : 'text-white/80'}`}>
                            {item.amount > 0 ? '+' : ''}{item.amount.toLocaleString('ja-JP')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 border-t border-white/15 pt-2.5 text-[10px] text-white/50">
                      まだマイル履歴はありません
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Status / Operator */}
            {(chatStatus?.status || operatorName) && (
              <div className="p-4 space-y-2">
                {chatStatus?.status && statusLabels[chatStatus.status] && (
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500">対応状況</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusLabels[chatStatus.status].className}`}>
                      {statusLabels[chatStatus.status].label}
                    </span>
                  </div>
                )}
                {operatorName && (
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500">担当者</span>
                    <span className="text-xs text-gray-700">{operatorName}</span>
                  </div>
                )}
              </div>
            )}

            {/* Notes — OAMのノート相当。編集ハンドラが渡された時は編集UI、なければ従来の読み取り表示 */}
            {onSaveNotes ? (
              <div className="p-4">
                <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">個別メモ</h4>
                <InputArea
                  minRows={3}
                  value={notesValue ?? ''}
                  onValueChange={(value) => onNotesChange?.(value)}
                  placeholder="メモを入力..."
                  aria-label="個別メモ"
                />
                <div className="mt-1.5 flex justify-end">
                  <Button
                    onClick={onSaveNotes}
                    disabled={savingNotes}
                    size="xs"
                    variant="secondary"
                    loading={savingNotes}
                  >
                    {savingNotes ? '保存中...' : 'メモ保存'}
                  </Button>
                </div>
              </div>
            ) : chatStatus?.notes ? (
              <div className="p-4">
                <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">個別メモ</h4>
                <p className="text-xs text-gray-700 whitespace-pre-wrap break-words">{chatStatus.notes}</p>
              </div>
            ) : null}

            {/* Tags */}
            <div className="p-4">
              <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">タグ</h4>
              {friend.tags.length === 0 ? (
                <p className="text-[11px] text-gray-400 italic">タグなし</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {friend.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Rich Menu */}
            <div className="p-4">
              <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">リッチメニュー</h4>
              {richMenu.kind === 'loading' ? (
                <p className="text-[11px] text-gray-400 italic">読み込み中...</p>
              ) : richMenu.kind === 'error' ? (
                <p className="text-[11px] text-red-500 italic">取得に失敗しました</p>
              ) : richMenu.id === null ? (
                <p className="text-[11px] text-gray-400 italic">未設定</p>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-700">{richMenu.name ?? '(名前なし)'}</span>
                  {richMenu.isDefault && (
                    <span className="px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                      デフォルト
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Metadata custom fields (本名等)。中身が空でも「本名」等を追加できるよう常に表示する */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[11px] font-medium text-gray-500">友だち情報</h4>
                {!editingMetadata && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => startEditingMetadata(friend.metadata ?? {})}
                  >
                    編集
                  </Button>
                )}
              </div>

              {editingMetadata ? (
                <div className="space-y-2">
                  {metadataRows.map((row, i) => {
                    const def = fieldDefsByKey.get(row.key)
                    const setValue = (v: string) =>
                      setMetadataRows((rows) => rows.map((r, ri) => (ri === i ? { ...r, value: v } : r)))
                    return (
                      <div key={row.rowId} className="flex items-start gap-1.5">
                        {def ? (
                          <span className="mt-1.5 w-24 flex-none truncate text-xs font-medium text-gray-600" title={def.fieldKey}>
                            {def.label}
                          </span>
                        ) : (
                          <Input
                            className="w-24 flex-none text-xs"
                            aria-label="項目名"
                            placeholder="項目名 (例: full_name)"
                            value={row.key}
                            onValueChange={(v) => setMetadataRows((rows) => rows.map((r, ri) => (ri === i ? { ...r, key: v } : r)))}
                          />
                        )}

                        {def && (def.fieldType === 'select' || def.fieldType === 'radio') ? (
                          <Select
                            className="min-w-0 flex-1"
                            aria-label="値"
                            value={row.value}
                            onValueChange={(v) => setValue(v ?? '')}
                            items={def.options.map((o) => ({ value: o, label: o }))}
                          />
                        ) : def && def.fieldType === 'checkbox' ? (
                          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                            {def.options.map((o) => {
                              const selected = row.value.split(',').map((v) => v.trim()).filter(Boolean).includes(o)
                              return (
                                <Button
                                  key={o}
                                  type="button"
                                  size="xs"
                                  variant={selected ? 'primary' : 'secondary'}
                                  onClick={() => {
                                    const current = row.value.split(',').map((v) => v.trim()).filter(Boolean)
                                    const next = selected ? current.filter((v) => v !== o) : [...current, o]
                                    setValue(next.join(', '))
                                  }}
                                >
                                  {o}
                                </Button>
                              )
                            })}
                          </div>
                        ) : def && def.fieldType === 'textarea' ? (
                          <InputArea
                            className="min-w-0 flex-1 text-xs"
                            aria-label="値"
                            minRows={2}
                            value={row.value}
                            onValueChange={setValue}
                          />
                        ) : (
                          <Input
                            className="min-w-0 flex-1 text-xs"
                            aria-label="値"
                            type={def?.fieldType === 'number' ? 'number' : def?.fieldType === 'date' ? 'date' : def?.fieldType === 'datetime' ? 'datetime-local' : 'text'}
                            placeholder="値"
                            value={row.value}
                            onValueChange={setValue}
                          />
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="mt-1 flex-none"
                          icon={XIcon}
                          aria-label="この項目を削除"
                          onClick={() => setMetadataRows((rows) => rows.filter((_, ri) => ri !== i))}
                        />
                      </div>
                    )
                  })}

                  <div className="flex flex-wrap items-center gap-1.5">
                    <FriendFieldPicker
                      value=""
                      placeholder="＋ 友だち情報欄を選択して追加"
                      fields={fieldDefs}
                      folders={fieldFolders}
                      disabledKeys={metadataRows.map((r) => r.key)}
                      onChange={(key) => {
                        if (!key) return
                        setMetadataRows((rows) => (rows.some((r) => r.key === key) ? rows : [...rows, { rowId: metadataRowSeq++, key, value: '' }]))
                      }}
                      onCreated={(f) => setFieldDefs((prev) => [...prev, { ...f, options: [], fieldType: (f.fieldType ?? 'text') as FieldDef['fieldType'] }])}
                    />
                    <Button
                      type="button"
                      size="xs"
                      variant="secondary"
                      onClick={() => setMetadataRows((rows) => [...rows, { rowId: metadataRowSeq++, key: '', value: '' }])}
                    >
                      自由入力(キーを直接指定)
                    </Button>
                  </div>

                  {metadataError && <p className="text-[11px] text-red-600">{metadataError}</p>}

                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      variant="primary"
                      loading={savingMetadata}
                      onClick={() => void saveMetadata(friend.id, friend.metadata ?? {})}
                    >
                      保存
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setEditingMetadata(false)}>
                      取消
                    </Button>
                  </div>
                </div>
              ) : friend.metadata && Object.keys(friend.metadata).length > 0 ? (
                <dl className="space-y-2 text-xs">
                  {Object.entries(friend.metadata).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-[10px] text-gray-400 uppercase tracking-wide">{fieldDefsByKey.get(key)?.label ?? METADATA_LABELS[key] ?? key}</dt>
                      <dd className="text-gray-700 mt-0.5 whitespace-pre-wrap break-words">{renderValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-gray-400">未設定(「編集」から本名などを追加できます)</p>
              )}
            </div>

            {/* Form answers — save_to_metadata の設定に関係なく回答履歴を表示 */}
            {friend.formSubmissions?.length > 0 && (
              <div className="p-4">
                <h4 className="text-[11px] font-medium text-gray-500 mb-2">フォーム回答</h4>
                <div className="space-y-3">
                  {friend.formSubmissions.map((submission) => {
                    const labels = new Map(submission.fields.map((field) => [field.name, field.label]))
                    const answers = Object.entries(submission.data).filter(([key]) => !key.startsWith('_'))
                    return (
                      <div key={submission.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium text-gray-700 break-words">{submission.formName}</p>
                          <time className="shrink-0 text-[10px] text-gray-400">
                            {formatDate(submission.createdAt)}
                          </time>
                        </div>
                        <dl className="mt-2 space-y-2">
                          {answers.map(([key, value]) => (
                            <div key={key}>
                              <dt className="text-[10px] text-gray-400">{labels.get(key) ?? key}</dt>
                              <dd className="mt-0.5 whitespace-pre-wrap break-words text-xs text-gray-700">
                                {renderValue(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/*
              編集導線は将来追加予定 (現在の /friends は ?id= をハンドルしないため、
              リンク先が機能しない → Codex review で指摘済 → 代わりに削除。
              編集 UI が出来たら復活させる)。
            */}
          </div>
        ) : (
          <div className="p-4 text-xs text-gray-400">友だち情報がありません</div>
        )}
      </div>
    </div>
  )
}
