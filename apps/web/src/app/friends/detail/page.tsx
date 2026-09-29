'use client'

import { resolveFriendName } from '@/components/friends/friend-name-edit-dialog'
import { FieldValue } from '@/components/friends/field-value'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { api, fetchApi } from '@/lib/api'
import type { FriendDetail } from '@/lib/api'
import Header from '@/components/layout/header'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { Tabs } from '@cloudflare/kumo/components/tabs'

// Lステップの「友だち詳細」画面のレイアウト(基本情報カードの上のタブが
// 固定タブ+フォルダ分けされたカスタムフィールドのタブという構成)を模倣する。
// フォルダ・定義は friend-fields 管理画面(/friend-fields)で作るものをそのまま使う。

interface FriendFieldFolder {
  id: string
  name: string
  displayOrder: number
}

interface FriendFieldDefinition {
  id: string
  folderId: string | null
  optionColors?: string[]
  fieldKey: string
  label: string
  fieldType: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'image' | 'pdf' | 'select' | 'radio' | 'checkbox'
  options: string[]
  displayOrder: number
}

interface Tag {
  id: string
  name: string
  color: string
}

const UNASSIGNED_FOLDER_ID = '__unassigned__'

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '[unparseable]'
  }
}

export default function FriendDetailPage() {
  const [friendId, setFriendId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setFriendId(params.get('id'))
  }, [])

  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [folders, setFolders] = useState<FriendFieldFolder[]>([])
  const [defs, setDefs] = useState<FriendFieldDefinition[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])

  const [tab, setTab] = useState('home')

  const loadFriend = useCallback(() => {
    if (!friendId) return
    setLoading(true)
    setError('')
    api.friends.get(friendId).then((res) => {
      if (res.success && res.data) {
        setFriend(res.data)
      } else {
        setError((res as { error?: string }).error ?? '友だち情報を取得できませんでした')
      }
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      setLoading(false)
    })
  }, [friendId])

  useEffect(() => { loadFriend() }, [loadFriend])

  useEffect(() => {
    fetchApi<{ success: boolean; data: FriendFieldFolder[] }>('/api/friend-fields/folders')
      .then((res) => { if (res.success) setFolders(res.data) })
      .catch(() => { /* フォルダタブが出ないだけで致命的ではない */ })
    fetchApi<{ success: boolean; data: FriendFieldDefinition[] }>('/api/friend-fields/definitions')
      .then((res) => { if (res.success) setDefs(res.data) })
      .catch(() => { /* 同上 */ })
    api.tags.list().then((res) => { if (res.success) setAllTags(res.data) }).catch(() => { /* 同上 */ })
  }, [])

  // ── 本名・システム表示名・個別メモ(ホームタブの「基本」セクション) ──────────
  const [editingProfile, setEditingProfile] = useState(false)
  const [draftRealName, setDraftRealName] = useState('')
  const [draftDisplayName, setDraftDisplayName] = useState('')
  const [draftMemo, setDraftMemo] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  function startEditingProfile() {
    if (!friend) return
    setDraftRealName(friend.realName ?? '')
    setDraftDisplayName(friend.systemDisplayName ?? '')
    setDraftMemo(friend.memo ?? '')
    setEditingProfile(true)
  }

  async function saveProfile() {
    if (!friend) return
    setSavingProfile(true)
    try {
      const res = await api.friends.updateProfile(friend.id, {
        realName: draftRealName.trim() || null,
        systemDisplayName: draftDisplayName.trim() || null,
        memo: draftMemo.trim() || null,
      })
      if (res.success && res.data) {
        setFriend(res.data)
        setEditingProfile(false)
      }
    } finally {
      setSavingProfile(false)
    }
  }

  // ── タグタブ(付与/解除のトグル) ──────────────────────────────────────
  const [tagBusyId, setTagBusyId] = useState<string | null>(null)
  const friendTagIds = useMemo(() => new Set((friend?.tags ?? []).map((t) => t.id)), [friend])

  async function toggleTag(tagId: string) {
    if (!friend) return
    setTagBusyId(tagId)
    try {
      const res = friendTagIds.has(tagId)
        ? await api.friends.removeTag(friend.id, tagId)
        : await api.friends.addTag(friend.id, tagId)
      if (res.success) loadFriend()
    } finally {
      setTagBusyId(null)
    }
  }

  // ── フォルダタブ(友だち情報欄。フォルダ単位でまとめて保存) ──────────────
  const [folderDrafts, setFolderDrafts] = useState<Record<string, string>>({})
  const [savingFolder, setSavingFolder] = useState(false)
  const [folderDirty, setFolderDirty] = useState(false)

  function fieldsForFolder(folderId: string | null): FriendFieldDefinition[] {
    return defs
      .filter((d) => (folderId === null ? d.folderId === null : d.folderId === folderId))
      .sort((a, b) => a.displayOrder - b.displayOrder)
  }

  function startEditingFolder(folderId: string | null) {
    if (!friend) return
    const rows: Record<string, string> = {}
    for (const def of fieldsForFolder(folderId)) {
      const v = friend.metadata?.[def.fieldKey]
      rows[def.fieldKey] = typeof v === 'string' ? v : v == null ? '' : renderValue(v)
    }
    setFolderDrafts(rows)
    setFolderDirty(false)
  }

  // タブを切り替えるたびに、そのフォルダの下書きを friend の現在値で作り直す。
  useEffect(() => {
    if (!friend) return
    if (tab === 'home' || tab === 'tags') return
    const folderId = tab === UNASSIGNED_FOLDER_ID ? null : tab
    startEditingFolder(folderId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, friend])

  async function saveFolder(folderId: string | null) {
    if (!friend) return
    setSavingFolder(true)
    try {
      const payload: Record<string, string | null> = {}
      for (const def of fieldsForFolder(folderId)) {
        const v = folderDrafts[def.fieldKey] ?? ''
        payload[def.fieldKey] = v === '' ? null : v
      }
      const res = await api.friends.updateMetadata(friend.id, payload)
      if (res.success && res.data) {
        setFriend(res.data)
        setFolderDirty(false)
      }
    } finally {
      setSavingFolder(false)
    }
  }

  const unassignedCount = defs.filter((d) => d.folderId === null).length
  const tabItems = [
    { value: 'home', label: 'ホーム' },
    { value: 'tags', label: 'タグ' },
    ...folders
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .filter((f) => fieldsForFolder(f.id).length > 0)
      .map((f) => ({ value: f.id, label: f.name })),
    ...(unassignedCount > 0 ? [{ value: UNASSIGNED_FOLDER_ID, label: '友だち情報(未分類)' }] : []),
  ]

  return (
    <div>
      <Header
        title={friend ? resolveFriendName(friend) : '友だち詳細'}
        description="友だちの基本情報・タグ・友だち情報欄を確認・編集できます。"
        action={
          <Link href="/friends">
            <Button type="button" variant="secondary" size="sm">一覧に戻る</Button>
          </Link>
        }
      />

      {friendId === null ? (
        <Banner variant="error" title="友だちが指定されていません" description="友だちリストから選択してください。" />
      ) : error ? (
        <Banner variant="error" title="友だち情報を読み込めませんでした" description={error} />
      ) : loading || !friend ? (
        <LayerCard className="flex min-h-48 items-center justify-center gap-2 p-6 text-sm text-kumo-subtle">
          <Loader size="sm" /> 読み込み中
        </LayerCard>
      ) : (
        <>
          <LayerCard className="mb-4 flex items-start gap-3 p-4">
            {friend.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={friend.pictureUrl} alt="" className="h-14 w-14 flex-shrink-0 rounded-full" />
            ) : (
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-kumo-control-secondary text-lg text-kumo-subtle">
                {resolveFriendName(friend).charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-kumo-strong">{resolveFriendName(friend)}</p>
              <p className="mt-0.5 text-xs text-kumo-subtle">友だちID: {friend.id}</p>
              <p className="text-xs text-kumo-subtle">登録日: {formatDate(friend.createdAt)}</p>
              {!friend.isFollowing && (
                <span className="mt-1 inline-block rounded bg-kumo-control-secondary px-1.5 py-0.5 text-[11px] font-medium text-kumo-subtle">
                  ブロック済み
                </span>
              )}
            </div>
          </LayerCard>

          <Tabs className="mb-4 flex-wrap" value={tab} onValueChange={(v) => v && setTab(v)} tabs={tabItems} />

          {tab === 'home' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <LayerCard className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-kumo-strong">基本</h2>
                  {!editingProfile && (
                    <Button type="button" variant="secondary" size="xs" onClick={startEditingProfile}>編集</Button>
                  )}
                </div>

                {editingProfile ? (
                  <div className="space-y-3">
                    <Input label="本名" value={draftRealName} onValueChange={setDraftRealName} placeholder="山田花子" />
                    <Input label="システム表示名" value={draftDisplayName} onValueChange={setDraftDisplayName} placeholder="表示名" />
                    <InputArea label="個別メモ" minRows={3} value={draftMemo} onValueChange={setDraftMemo} placeholder="メモを入力..." />
                    <div className="flex gap-2">
                      <Button type="button" variant="primary" size="sm" loading={savingProfile} onClick={() => void saveProfile()}>保存</Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setEditingProfile(false)}>取消</Button>
                    </div>
                  </div>
                ) : (
                  <dl className="space-y-2.5 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-kumo-subtle">本名</dt>
                      <dd className="text-kumo-strong">{friend.realName || '未登録'}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-kumo-subtle">システム表示名</dt>
                      <dd className="text-kumo-strong">{friend.systemDisplayName || '未登録'}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-kumo-subtle">個別メモ</dt>
                      <dd className="whitespace-pre-wrap break-words text-kumo-strong">{friend.memo || '未登録'}</dd>
                    </div>
                  </dl>
                )}
              </LayerCard>

              <LayerCard className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-kumo-strong">タグ</h2>
                {friend.tags.length === 0 ? (
                  <p className="text-sm text-kumo-subtle">タグはついていません</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {friend.tags.map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: `${t.color}20`, color: t.color }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs text-kumo-subtle">タグの追加・削除は「タグ」タブから行えます。</p>

                {friend.formSubmissions?.length > 0 && (
                  <div className="mt-5 border-t border-kumo-line pt-4">
                    <h3 className="mb-2 text-xs font-medium text-kumo-subtle">フォーム回答</h3>
                    <div className="space-y-2">
                      {friend.formSubmissions.map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-kumo-strong">{s.formName}</span>
                          <time className="shrink-0 text-kumo-subtle">{formatDate(s.createdAt)}</time>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </LayerCard>
            </div>
          )}

          {tab === 'tags' && (
            <LayerCard className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-kumo-strong">タグ</h2>
              {allTags.length === 0 ? (
                <p className="text-sm text-kumo-subtle">タグがまだ作成されていません。「タグ管理」から作成してください。</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {allTags.map((t) => (
                    <Checkbox
                      key={t.id}
                      label={t.name}
                      checked={friendTagIds.has(t.id)}
                      disabled={tagBusyId === t.id}
                      onCheckedChange={() => void toggleTag(t.id)}
                    />
                  ))}
                </div>
              )}
            </LayerCard>
          )}

          {tab !== 'home' && tab !== 'tags' && (
            <LayerCard className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-kumo-strong">
                {tabItems.find((t) => t.value === tab)?.label}
              </h2>
              <div className="space-y-4">
                {fieldsForFolder(tab === UNASSIGNED_FOLDER_ID ? null : tab).map((def) => {
                  const value = folderDrafts[def.fieldKey] ?? ''
                  const setValue = (v: string) => {
                    setFolderDrafts((rows) => ({ ...rows, [def.fieldKey]: v }))
                    setFolderDirty(true)
                  }
                  return (
                    <div key={def.id} className="grid gap-1.5 sm:grid-cols-[160px_1fr] sm:items-start sm:gap-4">
                      <label className="pt-2 text-sm text-kumo-subtle">{def.label}</label>
                      {def.fieldType === 'image' || def.fieldType === 'pdf' ? (
                        <div className="pt-2 text-sm">
                          <FieldValue value={value} />
                          <p className="mt-1 text-[11px] text-kumo-subtle">ファイルは回答フォームの「ファイル」ブロックから登録されます。</p>
                        </div>
                      ) : def.fieldType === 'select' || def.fieldType === 'radio' ? (
                        <Select
                          aria-label={def.label}
                          value={value}
                          onValueChange={(v) => setValue(v ?? '')}
                          items={[{ value: '', label: '(未選択)' }, ...def.options.map((o) => ({ value: o, label: o }))]}
                        />
                      ) : def.fieldType === 'checkbox' ? (
                        <div className="flex flex-wrap gap-1.5">
                          {def.options.map((o) => {
                            const selected = value.split(',').map((v) => v.trim()).filter(Boolean).includes(o)
                            return (
                              <button
                                key={o}
                                type="button"
                                className={`rounded-full border px-2.5 py-1 text-xs ${
                                  selected ? 'border-kumo-brand bg-kumo-control text-kumo-brand' : 'border-kumo-line text-kumo-subtle'
                                }`}
                                onClick={() => {
                                  const current = value.split(',').map((v) => v.trim()).filter(Boolean)
                                  const next = selected ? current.filter((v) => v !== o) : [...current, o]
                                  setValue(next.join(', '))
                                }}
                              >
                                {o}
                              </button>
                            )
                          })}
                        </div>
                      ) : def.fieldType === 'textarea' ? (
                        <InputArea aria-label={def.label} minRows={2} value={value} onValueChange={setValue} />
                      ) : (
                        <Input
                          aria-label={def.label}
                          type={def.fieldType === 'number' ? 'number' : def.fieldType === 'date' ? 'date' : def.fieldType === 'datetime' ? 'datetime-local' : 'text'}
                          value={value}
                          onValueChange={setValue}
                        />
                      )}
                    </div>
                  )
                })}

                {fieldsForFolder(tab === UNASSIGNED_FOLDER_ID ? null : tab).length === 0 ? (
                  <p className="text-sm text-kumo-subtle">このフォルダには項目がありません。</p>
                ) : (
                  <div className="flex justify-end pt-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      loading={savingFolder}
                      disabled={!folderDirty}
                      onClick={() => void saveFolder(tab === UNASSIGNED_FOLDER_ID ? null : tab)}
                    >
                      保存
                    </Button>
                  </div>
                )}
              </div>
            </LayerCard>
          )}
        </>
      )}
    </div>
  )
}
