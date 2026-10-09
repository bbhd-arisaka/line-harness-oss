'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { BellIcon, CalendarDotsIcon, ClockIcon, CopyIcon, DeviceMobileIcon, GearIcon, ListIcon, TrashIcon } from '@phosphor-icons/react'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Loader } from '@cloudflare/kumo/components/loader'
import { errorText } from '@/lib/error-text'
import { reserveApi } from '@/lib/reserve'
import type { CalendarBundle } from '@/lib/reserve'
import ScheduleView from '@/components/reserve/schedule-view'
import ShiftView from '@/components/reserve/shift-view'
import ReceptionConfig from '@/components/reserve/config-reception'
import CourseConfig from '@/components/reserve/config-course'
import ScreenConfig from '@/components/reserve/config-screen'
import { ActionsConfig, EpisodeConfig, ExternalConfig } from '@/components/reserve/config-actions'

type Tab = 'schedule' | 'shift' | 'config'
type Section = 'reception' | 'course' | 'screen' | 'action' | 'episode' | 'external'

const SECTIONS: Array<{ key: Section; label: string; subs?: Array<{ id: string; label: string }> }> = [
  { key: 'reception', label: '予約受付', subs: [{ id: 'hours', label: '受付時間' }, { id: 'period', label: '受付期間' }, { id: 'capacity', label: '同時予約可能数' }, { id: 'approval', label: '承認' }] },
  { key: 'course', label: '予約枠 / コース', subs: [{ id: 'slots', label: '予約枠' }, { id: 'courses', label: 'コース' }, { id: 'links', label: '予約枠とコースの紐づけ' }] },
  { key: 'screen', label: '予約画面', subs: [{ id: 'view', label: 'カレンダー表示' }, { id: 'admin', label: '管理者情報' }, { id: 'thanks', label: 'サンクスページURL' }, { id: 'fields', label: '予約情報取得項目' }] },
  { key: 'action', label: 'アクション', subs: [{ id: 'basic', label: '基本予約アクション' }, { id: 'req-new', label: '新規予約リクエストアクション' }, { id: 'req-change', label: '変更リクエストアクション' }, { id: 'req-cancel', label: 'キャンセルリクエストアクション' }] },
  { key: 'episode', label: 'リマインダ / フォロー', subs: [{ id: 'reminder', label: 'リマインダ設定' }, { id: 'follow', label: 'フォロー設定' }] },
  { key: 'external', label: '外部サービス連携' },
]

export default function ReserveDetailPage() {
  return (
    <Suspense fallback={<main className="p-6"><Loader size="sm" /></main>}>
      <Shell />
    </Suspense>
  )
}

function Shell() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const tab = (['schedule', 'shift', 'config'].includes(params.get('tab') ?? '') ? params.get('tab') : 'schedule') as Tab
  const section = (SECTIONS.some((s) => s.key === params.get('section')) ? params.get('section') : 'reception') as Section
  const [bundle, setBundle] = useState<CalendarBundle | null>(null)
  const [error, setError] = useState('')
  const [siteOpen, setSiteOpen] = useState(false)
  const [bell, setBell] = useState(false)
  const [notices, setNotices] = useState<Awaited<ReturnType<typeof reserveApi.notices>> | null>(null)
  const [version, setVersion] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await reserveApi.get(id)
      if (!res.success) throw new Error(res.error)
      setBundle(res.data)
      setError('')
    } catch (err) {
      setError(errorText(err, 'カレンダーを読み込めませんでした'))
    }
  }, [id])

  useEffect(() => {
    if (id) void load()
  }, [id, load])

  // 承認待ちの件数は、1分ごとに更新する
  useEffect(() => {
    if (!id) return
    const t = setInterval(() => void load(), 60_000)
    return () => clearInterval(t)
  }, [id, load])

  const go = (q: Record<string, string>) => {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(q)) p.set(k, v)
    router.push(`/reserve/detail?${p.toString()}`)
  }

  const toggleStatus = async () => {
    if (!bundle) return
    const next = bundle.calendar.status === 'active' ? 'stopped' : 'active'
    try {
      const res = await reserveApi.patch(id, { status: next })
      if (!res.success) throw new Error(res.error)
      await load()
    } catch (err) {
      setError(errorText(err, '切り替えられませんでした'))
    }
  }

  const openBell = async () => {
    setBell((v) => !v)
    if (!bell) {
      try {
        setNotices(await reserveApi.notices(id))
      } catch {
        setNotices(null)
      }
    }
  }

  if (!id) return <main className="p-6 text-sm text-gray-600">カレンダーが指定されていません。<Link href="/reserve" className="text-blue-700 underline">一覧へ</Link></main>
  if (error && !bundle) return <main className="p-6 text-sm text-red-600">{error}</main>
  if (!bundle) return <main className="p-6"><Loader size="sm" /></main>
  const { calendar } = bundle
  const active = calendar.status === 'active'

  const tabCls = (t: Tab) => `inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition ${tab === t ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-200 bg-white/95 px-5 py-2.5 shadow-sm backdrop-blur">
        <Link href="/reserve" aria-label="カレンダー一覧へ戻る" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"><ListIcon size={20} /></Link>
        <span className="max-w-[16rem] truncate text-base font-bold text-gray-900">{calendar.name}</span>
        <span className="hidden h-6 w-px bg-gray-200 sm:block" />
        <nav className="flex gap-1">
          <button type="button" className={tabCls('schedule')} onClick={() => go({ tab: 'schedule' })}><CalendarDotsIcon size={16} /> 予約一覧</button>
          <button type="button" className={tabCls('shift')} onClick={() => go({ tab: 'shift' })}><ClockIcon size={16} /> シフト</button>
          <button type="button" className={tabCls('config')} onClick={() => go({ tab: 'config' })}><GearIcon size={16} /> 予約設定</button>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <button type="button" role="switch" aria-checked={active} onClick={() => void toggleStatus()} className={`flex items-center gap-2.5 rounded-full border px-3 py-1.5 transition ${active ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`} title="友だちからの予約受付を、稼働中・停止中に切り替えます">
            <span className={`relative h-5 w-9 rounded-full transition ${active ? 'bg-emerald-500' : 'bg-gray-400'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${active ? 'left-[18px]' : 'left-0.5'}`} /></span>
            <span className="leading-tight"><span className="block text-[10px] text-gray-500">友だち予約</span><b className={active ? 'text-emerald-700' : 'text-gray-600'}>{active ? '稼働中' : '停止中'}</b></span>
          </button>
          <button type="button" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900" onClick={() => setSiteOpen(true)}><DeviceMobileIcon size={16} /> 予約サイト確認</button>
          <div className="relative">
            <button type="button" className="relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900" onClick={() => void openBell()}>
              <BellIcon size={16} /> お知らせ
              {bundle.pendingCount > 0 ? <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white shadow">{bundle.pendingCount}</span> : null}
            </button>
            {bell ? (
              <div className="absolute right-0 top-11 z-30 w-80 rounded-xl border border-gray-200 bg-white p-2 text-sm text-gray-800 shadow-xl">
                <p className="px-2 py-1 text-xs text-gray-500">新規予約と、承認待ちのリクエスト{notices && notices.success && notices.data.pendingCount ? `(承認待ち ${notices.data.pendingCount}件)` : ''}</p>
                {!notices ? <div className="p-3"><Loader size="sm" /></div> : null}
                {notices && notices.success && notices.data.items.length === 0 ? <p className="p-3 text-xs text-gray-500">お知らせはありません</p> : null}
                <ul className="max-h-80 overflow-y-auto">
                  {notices && notices.success ? notices.data.items.map((n) => (
                    <li key={n.id}>
                      <button type="button" className="block w-full rounded px-2 py-1.5 text-left hover:bg-gray-100" onClick={() => { setBell(false); go({ tab: 'schedule', view: 'list' }); setVersion((v) => v + 1) }}>
                        <span className="block text-xs text-gray-500">{n.requestedAt.slice(0, 16).replace('T', ' ')}</span>
                        <span className="block">{n.name}さん {n.status === 'pending' ? '予約リクエスト' : n.pendingKind === 'change' ? '変更リクエスト' : n.pendingKind === 'cancel' ? 'キャンセルリクエスト' : '新規予約'}</span>
                        <span className="block text-xs text-gray-500">予約日時 {n.startsAt.slice(0, 16).replace('T', ' ')}</span>
                      </button>
                    </li>
                  )) : null}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {error ? <p className="bg-red-50 px-5 py-2 text-sm text-red-700">{error}</p> : null}

      {tab === 'schedule' ? <ScheduleView key={`s-${version}`} bundle={bundle} reload={() => void load()} initialView={params.get('view')} initialDate={params.get('date')} /> : null}
      {tab === 'shift' ? <ShiftView bundle={bundle} /> : null}
      {tab === 'config' ? (
        <div className="flex flex-col gap-6 px-5 py-6 md:flex-row">
          <aside className="w-full shrink-0 md:sticky md:top-20 md:w-60 md:self-start">
            <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-wider text-gray-500">予約設定</h2>
            <ul className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              {SECTIONS.map((s) => (
                <li key={s.key} className="border-b border-gray-100 last:border-b-0">
                  <button type="button" onClick={() => go({ tab: 'config', section: s.key })} className={`flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm transition ${section === s.key ? 'bg-emerald-50 font-semibold text-emerald-800' : 'text-gray-700 hover:bg-gray-50'}`}>
                    <GearIcon size={16} className={section === s.key ? 'text-emerald-600' : 'text-gray-400'} weight="fill" /> {s.label}
                  </button>
                  {section === s.key && s.subs ? (
                    <ul className="bg-white pb-1">
                      {s.subs.map((sub) => (
                        <li key={sub.id}>
                          <button type="button" className="block w-full border-l-2 border-transparent px-10 py-1.5 text-left text-xs text-gray-600 hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-800" onClick={() => document.getElementById(sub.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{sub.label}</button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </aside>
          <div className="min-w-0 max-w-4xl flex-1">
            {section === 'reception' ? <ReceptionConfig bundle={bundle} reload={() => void load()} /> : null}
            {section === 'course' ? <CourseConfig bundle={bundle} reload={() => void load()} /> : null}
            {section === 'screen' ? <ScreenConfig bundle={bundle} reload={() => void load()} /> : null}
            {section === 'action' ? <ActionsConfig bundle={bundle} reload={() => void load()} /> : null}
            {section === 'episode' ? <EpisodeConfig bundle={bundle} reload={() => void load()} /> : null}
            {section === 'external' ? <ExternalConfig bundle={bundle} reload={() => void load()} /> : null}
          </div>
        </div>
      ) : null}

      {siteOpen ? <SiteDialog bundle={bundle} onClose={() => setSiteOpen(false)} reload={() => void load()} /> : null}
    </div>
  )
}

function CopyRow({ label, url, hint }: { label: string; url: string | null; hint?: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="mb-3">
      <p className="mb-1 text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <input readOnly className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs" value={url ?? '(LIFFの設定がないため、URLを作れません)'} onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          disabled={!url}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-green-600 px-3 py-1.5 text-xs text-green-700 hover:bg-green-50 disabled:opacity-40"
          onClick={async () => {
            if (!url) return
            try {
              await navigator.clipboard.writeText(url)
              setDone(true)
              setTimeout(() => setDone(false), 1500)
            } catch {
              window.prompt('URLをコピーしてください', url)
            }
          }}
        >
          <CopyIcon size={13} /> {done ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
  )
}

/** 予約サイト確認(友だち予約URL・予約履歴URL・予約枠とコースを指定したURLの発行) */
function SiteDialog({ bundle, onClose, reload }: { bundle: CalendarBundle; onClose: () => void; reload: () => void }) {
  const { calendar, slots, courses, siteLinks, reserveUrl } = bundle
  const [slotId, setSlotId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const issue = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await reserveApi.createSiteLink(calendar.id, slotId || null, courseId || null)
      if (!res.success) throw new Error(res.error)
      reload()
    } catch (err) {
      setError(errorText(err, '発行できませんでした'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="lg" className="p-0 !w-[min(680px,95vw)] !max-w-none">
        <div className="border-b border-gray-200 px-5 py-3 text-base font-semibold">予約サイト確認</div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <CopyRow label="友だち予約URL" url={bundle.reserveUrl} hint="友だちが予約を登録するためのURLです。メッセージやリッチメニューに設置すると、予約を受け付けられます。" />
          <CopyRow label="友だち予約履歴URL" url={bundle.historyUrl} hint="友だちが予約履歴を確認し、変更やキャンセル(またはリクエスト)をするためのURLです。" />
          <hr className="my-4" />
          <p className="mb-2 text-sm font-medium">予約枠とコースを指定した予約URLを発行する</p>
          <p className="mb-2 text-xs text-gray-500">指定した予約枠とコースが、あらかじめ選ばれた状態の予約画面になります(友だちは、あとから変更できます)。どちらかが未指定でも発行できます。</p>
          <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={slotId} onChange={(e) => setSlotId(e.target.value)}><option value="">{calendar.slotSettings.title}: 指定しない</option>{slots.map((s) => <option key={s.id} value={s.id}>{s.name}{!s.visible ? '(非表示)' : ''}</option>)}</select>
            <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">{calendar.courseSettings.title}: 指定しない</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.visible ? '(非表示)' : ''}</option>)}</select>
          </div>
          <button type="button" disabled={busy || !reserveUrl} className="rounded bg-[#e8355d] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#d02850] disabled:opacity-50" onClick={() => void issue()}>発行</button>
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
          <ul className="mt-3 space-y-2">
            {siteLinks.map((l) => (
              <li key={l.id} className="rounded border border-gray-200 p-2 text-xs">
                <div className="mb-1 flex items-center justify-between text-gray-600">
                  <span>{slots.find((s) => s.id === l.slotId)?.name ?? (l.slotId ? '(削除された予約枠)' : '予約枠: 指定なし')} / {courses.find((c) => c.id === l.courseId)?.name ?? (l.courseId ? '(削除されたコース)' : 'コース: 指定なし')}</span>
                  <button type="button" aria-label="発行したURLを削除" className="text-gray-400 hover:text-red-600" onClick={async () => { await reserveApi.deleteSiteLink(calendar.id, l.id); reload() }}><TrashIcon size={14} /></button>
                </div>
                <CopyRow label="" url={reserveUrl ? `${reserveUrl}&link=${l.id}` : null} />
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end border-t border-gray-200 px-5 py-3"><button type="button" className="rounded border border-gray-300 px-4 py-2 text-sm" onClick={onClose}>閉じる</button></div>
      </Dialog>
    </Dialog.Root>
  )
}
