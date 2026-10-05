'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tag } from '@line-crm/shared'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { ApiError, api, fetchApi } from '@/lib/api'
import type {
  NotificationDeliveryItem,
  NotificationDestinationItem,
  NotificationDestinationList,
  NotificationScheduleItem,
  NotificationSettingItem,
  NotificationTimingCategory,
} from '@/lib/api'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

type FormOption = { id: string; name: string }

export default function NotificationSettingEditPage() {
  return (
    <Suspense fallback={<main className="p-6"><Loader size="sm" /></main>}>
      <Editor />
    </Suspense>
  )
}

function Editor() {
  const router = useRouter()
  const id = useSearchParams().get('id')
  const { selectedAccount } = useAccount()
  const accountId = selectedAccount?.id ?? null

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [catalog, setCatalog] = useState<NotificationTimingCategory[]>([])
  const [destList, setDestList] = useState<NotificationDestinationList | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [forms, setForms] = useState<FormOption[]>([])
  const [deliveries, setDeliveries] = useState<NotificationDeliveryItem[]>([])

  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<'on' | 'off'>('off')
  const [scheduleMode, setScheduleMode] = useState<'always' | 'weekly'>('always')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0])
  const [from, setFrom] = useState('09:00')
  const [to, setTo] = useState('18:00')
  const [timings, setTimings] = useState<Map<string, string[] | null>>(new Map())
  const [tagIds, setTagIds] = useState<string[]>([])
  const [dests, setDests] = useState<NotificationDestinationItem[]>([])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const [cat, dest, tagRes, formRes, current] = await Promise.all([
          api.notificationSettings.catalog(),
          api.notificationSettings.destinations(),
          api.tags.list(),
          fetchApi<{ success: boolean; data: FormOption[] }>('/api/forms').catch(() => null),
          id && accountId ? api.notificationSettings.list(accountId) : Promise.resolve(null),
        ])
        if (cancelled) return
        if (cat.success) setCatalog(cat.data)
        if (dest.success) setDestList(dest.data)
        if (tagRes.success) setTags(tagRes.data)
        if (formRes?.success) setForms(formRes.data.map((f) => ({ id: f.id, name: f.name })))
        if (id) {
          const item = current && current.success ? current.data.find((x) => x.id === id) : undefined
          if (!item) {
            if (accountId) setError('通知設定が見つかりません')
          } else {
            applyItem(item)
            const d = await api.notificationSettings.deliveries(id).catch(() => null)
            if (!cancelled && d?.success) setDeliveries(d.data)
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError && err.status === 403 ? '通知設定は、管理者だけが操作できます' : '読み込めませんでした')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (!id || accountId) void run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, accountId])

  function applyItem(item: NotificationSettingItem) {
    setTitle(item.title)
    setStatus(item.status)
    if (item.schedule.mode === 'weekly') {
      setScheduleMode('weekly')
      setDays(item.schedule.days)
      setFrom(item.schedule.from)
      setTo(item.schedule.to)
    } else {
      setScheduleMode('always')
    }
    setTimings(new Map(item.timings.map((t) => [t.key, t.formIds && t.formIds.length > 0 ? t.formIds : null])))
    setTagIds(item.filterTagIds)
    setDests(item.destinations)
  }

  const toggleTiming = (key: string, on: boolean) =>
    setTimings((prev) => {
      const next = new Map(prev)
      if (on) next.set(key, null)
      else next.delete(key)
      return next
    })

  const toggleDest = (d: NotificationDestinationItem, on: boolean) =>
    setDests((prev) => (on ? [...prev.filter((x) => !(x.kind === d.kind && x.id === d.id)), d] : prev.filter((x) => !(x.kind === d.kind && x.id === d.id))))

  const destChecked = (d: NotificationDestinationItem) => dests.some((x) => x.kind === d.kind && x.id === d.id)
  // 一覧に出ていない(beyond admin で削除された)通知先も、設定に残っていれば見せる
  const listedKeys = new Set([...(destList?.line ?? []), ...(destList?.mail ?? [])].map((d) => `${d.kind}:${d.id}`))
  const staleDests = dests.filter((d) => !listedKeys.has(`${d.kind}:${d.id}`))

  const buildSchedule = (): NotificationScheduleItem =>
    scheduleMode === 'always' ? { mode: 'always' } : { mode: 'weekly', days, from, to }

  const save = async () => {
    if (!accountId) return
    setError('')
    setNotice('')
    if (!title.trim()) return setError('タイトルを入力してください')
    if (timings.size === 0) return setError('通知するタイミングを1つ以上選んでください')
    if (scheduleMode === 'weekly' && days.length === 0) return setError('通知する曜日を1つ以上選んでください')
    if (status === 'on' && dests.length === 0) return setError('通知先を選ぶまで、オンにはできません')
    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        status,
        schedule: buildSchedule(),
        timings: [...timings.entries()].map(([key, formIds]) => (formIds && formIds.length > 0 ? { key, formIds } : { key })),
        filterTagIds: tagIds,
        destinations: dests,
      }
      const res = id ? await api.notificationSettings.update(id, payload) : await api.notificationSettings.create({ ...payload, lineAccountId: accountId })
      if (!res.success) throw new Error(res.error)
      router.push('/notification-settings')
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : '保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    if (!id) return
    setTesting(true)
    setError('')
    setNotice('')
    try {
      const res = await api.notificationSettings.test(id)
      if (!res.success) throw new Error(res.error)
      const failed = res.data.filter((r) => !r.ok)
      setNotice(failed.length === 0 ? `${res.data.length}件の通知先に、テスト通知を送りました` : `${failed.length}件の通知先に送れませんでした(${failed.map((f) => f.name || f.kind).join('、')})`)
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : 'テスト通知を送れませんでした')
    } finally {
      setTesting(false)
    }
  }

  if (!selectedAccount) return <main className="p-6 text-sm text-kumo-subtle">アカウントを選択してください。</main>
  if (loading) return <main className="p-6"><Loader size="sm" /></main>

  const friendAddSelected = timings.has('friend_add')

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Header
        title={id ? '通知設定の編集' : '通知設定の作成'}
        description={`${selectedAccount.displayName || selectedAccount.name} の通知設定`}
        action={<Link href="/notification-settings" className="text-sm text-kumo-link hover:underline">一覧へ戻る</Link>}
      />

      {error ? <Banner className="mb-4" variant="error" title={error} /> : null}
      {notice ? <Banner className="mb-4" variant="default" title={notice} /> : null}

      <div className="flex flex-col gap-5">
        <LayerCard className="p-5">
          <h2 className="mb-3 text-sm font-semibold">基本</h2>
          <label className="mb-1 block text-sm" htmlFor="ns-title">タイトル</label>
          <Input id="ns-title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="例: チャット通知" />
          <div className="mt-4">
            <Checkbox
              label="この通知設定をオンにする"
              checked={status === 'on'}
              onCheckedChange={(on) => setStatus(on ? 'on' : 'off')}
            />
          </div>
        </LayerCard>

        <LayerCard className="p-5">
          <h2 className="mb-3 text-sm font-semibold">通知スケジュール</h2>
          <div className="mb-3 flex flex-col gap-2">
            <Checkbox label="常に通知する" checked={scheduleMode === 'always'} onCheckedChange={(on) => { if (on) setScheduleMode('always') }} />
            <Checkbox label="曜日と時間帯を決めて通知する(日本時間)" checked={scheduleMode === 'weekly'} onCheckedChange={(on) => { if (on) setScheduleMode('weekly') }} />
          </div>
          {scheduleMode === 'weekly' ? (
            <div className="flex flex-col gap-3 pl-6">
              <div className="flex flex-wrap gap-3">
                {DAY_ORDER.map((d) => (
                  <Checkbox
                    key={d}
                    label={DAY_LABELS[d]}
                    checked={days.includes(d)}
                    onCheckedChange={(on) => setDays((prev) => (on ? [...prev, d] : prev.filter((x) => x !== d)))}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input aria-label="開始時刻" type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="w-32" />
                <span className="text-sm">〜</span>
                <Input aria-label="終了時刻" type="time" value={to} onChange={(e) => setTo(e.target.value)} className="w-32" />
              </div>
              <p className="text-xs text-kumo-subtle">終了が開始より前のときは、日をまたぎます(例: 22:00〜06:00)。</p>
            </div>
          ) : null}
        </LayerCard>

        <LayerCard className="p-5">
          <h2 className="mb-1 text-sm font-semibold">通知するタイミング</h2>
          <p className="mb-4 text-xs text-kumo-subtle">「準備中」のタイミングは、まだ選べません。</p>
          <div className="flex flex-col gap-5">
            {catalog.map((cat) => (
              <section key={cat.key}>
                <h3 className="text-sm font-medium">{cat.label}</h3>
                <p className="mb-2 text-xs text-kumo-subtle">{cat.description}</p>
                <div className="flex flex-col gap-2">
                  {cat.timings.map((t) => (
                    <div key={t.key}>
                      <Checkbox
                        label={t.available ? t.label : `${t.label}(準備中)`}
                        checked={timings.has(t.key)}
                        disabled={!t.available}
                        onCheckedChange={(on) => toggleTiming(t.key, on)}
                      />
                      {t.available && t.note ? <p className="ml-6 text-xs text-kumo-subtle">{t.note}</p> : null}
                      {t.key === 'form_answered' && timings.has('form_answered') ? (
                        <FormPicker forms={forms} value={timings.get('form_answered') ?? null} onChange={(v) => setTimings((prev) => new Map(prev).set('form_answered', v))} />
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </LayerCard>

        <LayerCard className="p-5">
          <h2 className="mb-1 text-sm font-semibold">タグで絞り込む(任意)</h2>
          <p className="mb-3 text-xs text-kumo-subtle">
            選んだタグが付いている友だちの通知だけ送ります。選ばなければ、すべての友だちが対象です。
          </p>
          {friendAddSelected && tagIds.length > 0 ? (
            <Banner className="mb-3" variant="alert" title="友だち追加時の通知は、絞り込みを設定しないでください" description="追加した直後の友だちには、まだタグが付いていないため、通知が届かなくなります。" />
          ) : null}
          {tags.length === 0 ? (
            <p className="text-sm text-kumo-subtle">タグがありません</p>
          ) : (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {tags.map((tag) => (
                <Checkbox
                  key={tag.id}
                  label={tag.name}
                  checked={tagIds.includes(tag.id)}
                  onCheckedChange={(on) => setTagIds((prev) => (on ? [...prev, tag.id] : prev.filter((x) => x !== tag.id)))}
                />
              ))}
            </div>
          )}
        </LayerCard>

        <LayerCard className="p-5">
          <h2 className="mb-1 text-sm font-semibold">通知先</h2>
          <p className="mb-3 text-xs text-kumo-subtle">
            beyond admin に登録された連絡先だけ選べます。追加は、一覧画面の「通知先の追加はこちら」からできます。
          </p>
          {destList && !destList.available ? (
            <Banner className="mb-3" variant="alert" title="通知先を確認できません" description={destList.reason ?? 'beyond admin につながりません'} />
          ) : null}
          {destList?.available && destList.line.length + destList.mail.length === 0 ? (
            <p className="mb-3 text-sm text-kumo-subtle">登録された通知先がありません</p>
          ) : null}
          <DestGroup label="LINE" items={destList?.line ?? []} checked={destChecked} onToggle={toggleDest} />
          <DestGroup label="メール" items={destList?.mail ?? []} checked={destChecked} onToggle={toggleDest} />
          {staleDests.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1 text-xs text-kumo-subtle">beyond admin で見つからない通知先(外すと、再び選べなくなります)</p>
              <div className="flex flex-col gap-2">
                {staleDests.map((d) => (
                  <Checkbox key={`${d.kind}:${d.id}`} label={`${d.kind === 'mail' ? 'メール' : 'LINE'}:${d.name || d.id}`} checked onCheckedChange={(on) => toggleDest(d, on)} />
                ))}
              </div>
            </div>
          ) : null}
        </LayerCard>

        <div className="flex items-center gap-2">
          <Button variant="primary" loading={saving} onClick={() => void save()}>保存</Button>
          {id ? <Button variant="secondary" loading={testing} disabled={dests.length === 0} onClick={() => void sendTest()}>テスト送信</Button> : null}
        </div>

        {id && deliveries.length > 0 ? (
          <LayerCard className="p-5">
            <h2 className="mb-3 text-sm font-semibold">直近の送信記録</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {deliveries.map((d, i) => (
                <li key={i} className="flex flex-wrap gap-x-3">
                  <span className="tabular-nums text-kumo-subtle">{new Date(d.created_at.includes('T') ? d.created_at : `${d.created_at.replace(' ', 'T')}Z`).toLocaleString('ja-JP')}</span>
                  <span>{d.destination_kind === 'mail' ? 'メール' : 'LINE'}</span>
                  <span className={d.status === 'sent' ? '' : 'text-kumo-danger'}>{d.status === 'sent' ? '送信済み' : `失敗${d.error ? `(${d.error})` : ''}`}</span>
                </li>
              ))}
            </ul>
          </LayerCard>
        ) : null}
      </div>
    </main>
  )
}

function DestGroup({
  label,
  items,
  checked,
  onToggle,
}: {
  label: string
  items: NotificationDestinationItem[]
  checked: (d: NotificationDestinationItem) => boolean
  onToggle: (d: NotificationDestinationItem, on: boolean) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="mb-3">
      <h3 className="mb-1 text-sm font-medium">{label}</h3>
      <div className="flex flex-col gap-2">
        {items.map((d) => (
          <Checkbox key={`${d.kind}:${d.id}`} label={d.name || d.id} checked={checked(d)} onCheckedChange={(on) => onToggle(d, on)} />
        ))}
      </div>
    </div>
  )
}

function FormPicker({ forms, value, onChange }: { forms: FormOption[]; value: string[] | null; onChange: (v: string[] | null) => void }) {
  const all = value === null
  return (
    <div className="ml-6 mt-2 flex flex-col gap-2">
      <Checkbox label="すべての回答フォーム" checked={all} onCheckedChange={(on) => onChange(on ? null : [])} />
      {!all ? (
        <div className="flex flex-col gap-2 pl-6">
          {forms.length === 0 ? <p className="text-xs text-kumo-subtle">回答フォームがありません</p> : null}
          {forms.map((f) => (
            <Checkbox
              key={f.id}
              label={f.name}
              checked={(value ?? []).includes(f.id)}
              onCheckedChange={(on) => onChange(on ? [...(value ?? []), f.id] : (value ?? []).filter((x) => x !== f.id))}
            />
          ))}
          {value && value.length === 0 ? <p className="text-xs text-kumo-subtle">フォームを選ばないと、すべての回答フォームが対象になります</p> : null}
        </div>
      ) : null}
    </div>
  )
}
