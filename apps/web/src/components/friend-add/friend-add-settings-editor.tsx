'use client'

import { useCallback, useEffect, useState } from 'react'
import { LightningIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { ApiError, api, fetchApi } from '@/lib/api'
import { describeAction, describeTiming } from '@/lib/friend-add-actions'
import type { FriendAddActionItem, FriendAddKindItem, FriendAddSettingItem } from '@/lib/friend-add-actions'
import ActionSettingsModal from './action-settings-modal'
import type { ModalLookups } from './action-settings-modal'

const NONE = '__none__'

const CARDS: Array<{ kind: FriendAddKindItem; title: string; description: string }> = [
  { kind: 'new', title: '新規友だち', description: 'システム導入後に新しくアカウントをフォローした人についての設定' },
  {
    kind: 'returning',
    title: 'システム導入前からの友だち・アカウントへのブロックを解除した友だち',
    description: 'システム導入前からの友だちとアカウントへのブロック解除した友だちについての設定',
  },
]

interface Draft {
  scenarioId: string
  actions: FriendAddActionItem[]
}

/** Lステップの「友だち追加時設定」と同じ画面: 新規友だち / 導入前からの友だち・ブロック解除 の2枚。保存ボタンは1つ。 */
export default function FriendAddSettingsEditor({ accountId }: { accountId: string; accountName?: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<FriendAddKindItem, Draft> | null>(null)
  const [lookups, setLookups] = useState<ModalLookups>({ tags: [], templates: [], menus: [], fields: [], reminders: [], conversions: [], forms: [], scenarios: [] })
  const [editing, setEditing] = useState<FriendAddKindItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, sc, tg, tp, mn, fd, rm, cv, fm] = await Promise.all([
        api.friendAddSettings.get(accountId),
        api.scenarios.list({ accountId }),
        api.tags.list(),
        api.templates.list(),
        api.richMenuGroups.list(accountId).catch(() => null),
        fetchApi<{ success: boolean; data: Array<{ field_key?: string; fieldKey?: string; label: string }> }>('/api/friend-fields/definitions').catch(() => null),
        api.reminders.list().catch(() => null),
        api.conversions.points().catch(() => null),
        fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>('/api/forms').catch(() => null),
      ])
      if (!s.success) throw new Error(s.error)
      const toDraft = (x: FriendAddSettingItem): Draft => ({ scenarioId: x.scenarioId ?? NONE, actions: x.actions })
      setDrafts({ new: toDraft(s.data.new), returning: toDraft(s.data.returning) })
      setLookups({
        scenarios: sc.success ? sc.data.map((x) => ({ id: x.id, name: x.name })) : [],
        tags: tg.success ? tg.data.map((x) => ({ id: x.id, name: x.name })) : [],
        templates: tp.success ? tp.data.map((x) => ({ id: x.id, name: x.name })) : [],
        menus: mn && mn.success ? mn.data.filter((x) => x.status === 'published').map((x) => ({ id: x.id, name: x.name })) : [],
        fields: fd && fd.success ? fd.data.map((f) => ({ fieldKey: (f.fieldKey ?? f.field_key) as string, label: f.label })) : [],
        reminders: rm && rm.success ? rm.data.map((x) => ({ id: x.id, name: x.name })) : [],
        conversions: cv && cv.success ? cv.data.map((x) => ({ id: x.id, name: x.name })) : [],
        forms: fm && fm.success ? fm.data.map((x) => ({ id: x.id, name: x.name })) : [],
      })
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? '友だち追加時設定は、管理者だけが操作できます' : '読み込めませんでした。時間をおいてもう一度お試しください')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!drafts) return
    setSaving(true)
    setMessage(null)
    try {
      for (const card of CARDS) {
        const d = drafts[card.kind]
        const res = await api.friendAddSettings.save(accountId, card.kind, { scenarioId: d.scenarioId === NONE ? null : d.scenarioId, actions: d.actions })
        if (!res.success) throw new Error(res.error)
      }
      setMessage({ ok: true, text: '保存しました' })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError && err.message ? err.message : '保存できませんでした' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader size="sm" /> 読み込み中
      </div>
    )
  }
  if (error || !drafts) return <Banner variant="error" title={error || '読み込めませんでした'} />

  return (
    <div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {CARDS.map((card) => {
          const d = drafts[card.kind]
          return (
            <section key={card.kind} className="rounded border border-gray-300 bg-white">
              <header className="border-b border-gray-300 bg-gray-100 px-4 py-2 text-xs text-gray-700">{card.title}</header>
              <div className="p-4">
                <p className="mb-4 text-sm text-gray-700">{card.description}</p>
                <label className="mb-1 block text-sm font-bold text-gray-800">シナリオ</label>
                <Select
                  value={d.scenarioId}
                  onValueChange={(v) => setDrafts({ ...drafts, [card.kind]: { ...d, scenarioId: v ?? NONE } })}
                  aria-label={`${card.title}のシナリオ`}
                  items={[{ value: NONE, label: '' }, ...lookups.scenarios.map((s) => ({ value: s.id, label: s.name }))]}
                />
                <hr className="my-4 border-gray-200" />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(card.kind)}
                    className="inline-flex items-center gap-1.5 rounded bg-[#f0ad4e] px-3 py-2 text-sm font-medium text-white hover:bg-[#ec9f35]"
                  >
                    <LightningIcon size={14} weight="fill" /> その他のアクションを設定する
                  </button>
                  {d.actions.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setDrafts({ ...drafts, [card.kind]: { ...d, actions: [] } })}
                      className="rounded border border-green-600 bg-white px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
                    >
                      設定解除
                    </button>
                  ) : null}
                </div>
                {d.actions.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-gray-700">
                    {d.actions.map((a, i) => (
                      <li key={i}>
                        {describeAction(a, lookups)}
                        {(a.type === 'text' || a.type === 'template') && a.timing && a.timing.mode !== 'now' ? `(${describeTiming(a.timing)})` : ''}
                        {a.condition ? '(条件あり)' : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {editing === card.kind ? (
                <ActionSettingsModal
                  open
                  initial={d.actions}
                  lookups={lookups}
                  accountId={accountId}
                  onClose={() => setEditing(null)}
                  onSave={(actions) => {
                    setDrafts({ ...drafts, [card.kind]: { ...d, actions } })
                    setEditing(null)
                  }}
                />
              ) : null}
            </section>
          )
        })}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded bg-green-600 px-10 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {message ? <span className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</span> : null}
      </div>
    </div>
  )
}
