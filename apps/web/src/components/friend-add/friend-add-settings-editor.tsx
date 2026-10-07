'use client'

import { useCallback, useEffect, useState } from 'react'
import { TrashIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { ApiError, api } from '@/lib/api'
import type { FriendAddActionItem, FriendAddKindItem, FriendAddSettingItem } from '@/lib/api'

type Option = { id: string; name: string }

const NONE = '__none__'

const ACTION_LABEL: Record<FriendAddActionItem['type'], string> = {
  add_tag: 'タグを追加する',
  remove_tag: 'タグを外す',
  send_message: 'テンプレートを送る',
  switch_rich_menu_group: 'リッチメニューを変更する',
  remove_rich_menu: 'リッチメニューを外す',
}

const CARDS: Array<{ kind: FriendAddKindItem; title: string; description: string }> = [
  { kind: 'new', title: '新規友だち', description: 'システム導入後に、はじめてフォローした人についての設定' },
  {
    kind: 'returning',
    title: 'システム導入前からの友だち・ブロックを解除した友だち',
    description: 'すでに友だち一覧にいる人が、またフォローしたときの設定',
  },
]

/** Lステップの「友だち追加時設定」: 新規友だち / 導入前からの友だち・ブロック解除 の2区分。それぞれ、登録するシナリオと、その他のアクション。 */
export default function FriendAddSettingsEditor({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<Record<FriendAddKindItem, FriendAddSettingItem> | null>(null)
  const [scenarios, setScenarios] = useState<Option[]>([])
  const [tags, setTags] = useState<Option[]>([])
  const [templates, setTemplates] = useState<Option[]>([])
  const [menus, setMenus] = useState<Option[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, sc, tg, tp, mn] = await Promise.all([
        api.friendAddSettings.get(accountId),
        api.scenarios.list({ accountId }),
        api.tags.list(),
        api.templates.list(),
        api.richMenuGroups.list(accountId).catch(() => null),
      ])
      if (!s.success) throw new Error(s.error)
      setSettings(s.data)
      if (sc.success) setScenarios(sc.data.map((x) => ({ id: x.id, name: x.name })))
      if (tg.success) setTags(tg.data.map((x) => ({ id: x.id, name: x.name })))
      if (tp.success) setTemplates(tp.data.map((x) => ({ id: x.id, name: x.name })))
      if (mn && mn.success) setMenus(mn.data.filter((x) => x.status === 'published').map((x) => ({ id: x.id, name: x.name })))
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? '友だち追加時設定は、管理者だけが操作できます' : '読み込めませんでした。時間をおいてもう一度お試しください')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader size="sm" /> 読み込み中
      </div>
    )
  }
  if (error || !settings) return <Banner variant="error" title={error || '読み込めませんでした'} />

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        「{accountName}」に友だち追加されたときの設定です。区分ごとに、登録するシナリオと、その他のアクション（タグ・テンプレート送信・リッチメニュー）を設定できます。
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CARDS.map((card) => (
          <SettingCard
            key={card.kind}
            accountId={accountId}
            card={card}
            initial={settings[card.kind]}
            scenarios={scenarios}
            tags={tags}
            templates={templates}
            menus={menus}
          />
        ))}
      </div>
    </div>
  )
}

function SettingCard({
  accountId,
  card,
  initial,
  scenarios,
  tags,
  templates,
  menus,
}: {
  accountId: string
  card: (typeof CARDS)[number]
  initial: FriendAddSettingItem
  scenarios: Option[]
  tags: Option[]
  templates: Option[]
  menus: Option[]
}) {
  const [scenarioId, setScenarioId] = useState<string>(initial.scenarioId ?? NONE)
  const [actions, setActions] = useState<FriendAddActionItem[]>(initial.actions)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const add = (type: FriendAddActionItem['type']) => {
    const next: FriendAddActionItem =
      type === 'add_tag' || type === 'remove_tag'
        ? { type, params: { tagId: tags[0]?.id ?? '' } }
        : type === 'send_message'
          ? { type, params: { template_id: templates[0]?.id ?? '' } }
          : type === 'switch_rich_menu_group'
            ? { type, params: { groupId: menus[0]?.id ?? '' } }
            : { type: 'remove_rich_menu', params: {} }
    setActions((prev) => [...prev, next])
  }

  const setParam = (index: number, value: string) =>
    setActions((prev) =>
      prev.map((a, i) => {
        if (i !== index) return a
        if (a.type === 'add_tag' || a.type === 'remove_tag') return { ...a, params: { tagId: value } }
        if (a.type === 'send_message') return { ...a, params: { template_id: value } }
        if (a.type === 'switch_rich_menu_group') return { ...a, params: { groupId: value } }
        return a
      }),
    )

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await api.friendAddSettings.save(accountId, card.kind, { scenarioId: scenarioId === NONE ? null : scenarioId, actions })
      if (!res.success) throw new Error(res.error)
      setMessage({ ok: true, text: '保存しました' })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError && err.message ? err.message : '保存できませんでした' })
    } finally {
      setSaving(false)
    }
  }

  const optionsFor = (a: FriendAddActionItem): { value: string; items: Option[] } | null => {
    if (a.type === 'add_tag' || a.type === 'remove_tag') return { value: a.params.tagId, items: tags }
    if (a.type === 'send_message') return { value: a.params.template_id, items: templates }
    if (a.type === 'switch_rich_menu_group') return { value: a.params.groupId, items: menus }
    return null
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="border-b border-gray-200 bg-gray-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">{card.title}</h2>
      </header>
      <div className="space-y-4 p-4">
        <p className="text-xs text-gray-500">{card.description}</p>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-800">シナリオ</label>
          <Select
            value={scenarioId}
            onValueChange={(v) => setScenarioId(v ?? NONE)}
            aria-label={`${card.title}のシナリオ`}
            items={[{ value: NONE, label: '— 設定しない —' }, ...scenarios.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-gray-800">その他のアクション</p>
          {actions.length === 0 ? <p className="mb-2 text-xs text-gray-400">アクションは設定されていません</p> : null}
          <ul className="mb-2 space-y-2">
            {actions.map((a, i) => {
              const opts = optionsFor(a)
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 p-2">
                  <span className="min-w-[10rem] text-sm text-gray-700">{ACTION_LABEL[a.type]}</span>
                  {opts ? (
                    <div className="min-w-0 flex-1">
                      <Select
                        value={opts.value}
                        onValueChange={(v) => setParam(i, v ?? '')}
                        aria-label={ACTION_LABEL[a.type]}
                        items={[{ value: '', label: '— 選んでください —' }, ...opts.items.map((o) => ({ value: o.id, label: o.name }))]}
                      />
                    </div>
                  ) : (
                    <span className="flex-1 text-xs text-gray-400">公開中のメニューを外します</span>
                  )}
                  <Button variant="ghost" size="sm" aria-label="このアクションを削除" onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))}>
                    <TrashIcon size={16} />
                  </Button>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ACTION_LABEL) as Array<FriendAddActionItem['type']>).map((type) => (
              <Button key={type} variant="secondary" size="sm" onClick={() => add(type)}>
                ＋ {ACTION_LABEL[type]}
              </Button>
            ))}
          </div>
          {menus.length === 0 ? <p className="mt-2 text-xs text-gray-400">リッチメニューは、「リッチメニュー」画面で公開したものから選べます</p> : null}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            保存
          </Button>
          {message ? <span className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</span> : null}
        </div>
      </div>
    </section>
  )
}
