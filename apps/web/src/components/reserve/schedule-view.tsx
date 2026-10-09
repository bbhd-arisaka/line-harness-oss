'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaretLeftIcon, CaretRightIcon, FunnelIcon, ListIcon, CalendarBlankIcon, RowsIcon, SkipBackIcon, RewindIcon, FastForwardIcon, SkipForwardIcon, DownloadSimpleIcon } from '@phosphor-icons/react'
import { Loader } from '@cloudflare/kumo/components/loader'
import { apiUrl } from '@/lib/api'
import { errorText } from '@/lib/error-text'
import { STATUS_LABEL, WEEK_JA, addDaysStr, addMonthsStr, formatDateJa, hhmmToMin, minToHhmm, monthStart, reserveApi, todayJst, weekdayOf } from '@/lib/reserve'
import type { BookingStatus, CalendarBundle, ReserveBooking, ReserveShift } from '@/lib/reserve'
import { BookingDetail, BookingEditor, displayName } from './booking-dialogs'
import type { EditorPreset } from './booking-dialogs'

type View = 'day' | 'month' | 'list'
const pinkBtn = 'inline-flex items-center gap-1.5 rounded-full bg-[#e8355d] px-5 py-2 text-sm font-semibold text-white shadow-md shadow-rose-200 transition hover:bg-[#d02850]'
const toolBtn = 'inline-flex items-center justify-center border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50'

function storageKey(calendarId: string) {
  return `reserve-filter-${calendarId}`
}

/** 予約一覧(日・月・リスト)。Lステップの「予約一覧」と同じ構成 */
export default function ScheduleView({ bundle, reload, initialView, initialDate }: { bundle: CalendarBundle; reload: () => void; initialView?: string | null; initialDate?: string | null }) {
  const { calendar, slots } = bundle
  const [view, setView] = useState<View>(initialView === 'month' || initialView === 'list' ? initialView : 'day')
  const [date, setDate] = useState(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : todayJst())
  const [hiddenSlots, setHiddenSlots] = useState<string[]>([])
  const [showFilter, setShowFilter] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ booking?: ReserveBooking | null; preset?: EditorPreset } | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(calendar.id))
      if (raw) setHiddenSlots(JSON.parse(raw) as string[])
    } catch {
      /* 保存された絞り込みが読めなくても、そのまま表示する */
    }
  }, [calendar.id])

  const saveHidden = (next: string[]) => {
    setHiddenSlots(next)
    try {
      localStorage.setItem(storageKey(calendar.id), JSON.stringify(next))
    } catch {
      /* 保存できなくても、画面は動く */
    }
  }

  const refresh = () => {
    setTick((n) => n + 1)
    reload()
  }

  const move = (dir: -1 | 1) => setDate((d) => (view === 'month' ? addMonthsStr(d, dir) : addDaysStr(d, dir)))
  const accountId = calendar.lineAccountId

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 shadow-sm">
          {([['day', '日', RowsIcon], ['month', '月', CalendarBlankIcon], ['list', 'リスト', ListIcon]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm ${view === v ? 'bg-emerald-600 font-semibold text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {view !== 'list' ? (
          <div className="inline-flex shadow-sm">
            <button type="button" className={`${toolBtn} rounded-l-lg`} onClick={() => move(-1)} aria-label="前へ"><CaretLeftIcon size={14} /></button>
            <button type="button" className={`${toolBtn} border-l-0`} onClick={() => setDate(todayJst())}>今日</button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${toolBtn} border-l-0 w-40`} aria-label="日付" />
            <button type="button" className={`${toolBtn} rounded-r-lg border-l-0`} onClick={() => move(1)} aria-label="次へ"><CaretRightIcon size={14} /></button>
          </div>
        ) : null}
        <button type="button" className={`${pinkBtn} ml-auto`} onClick={() => setEditor({ preset: { date } })}>＋ 新規予約</button>
      </div>

      {view !== 'list' ? (
        <div className="relative mb-2">
          <button type="button" onClick={() => setShowFilter((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50">
            <span className={`h-2.5 w-2.5 rounded-full ${hiddenSlots.length ? 'bg-[#e8355d]' : 'bg-gray-300'}`} /> 予約表示フィルター <FunnelIcon size={12} />
          </button>
          {showFilter ? (
            <div className="absolute z-20 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-3 text-sm shadow-xl">
              <p className="mb-1 text-xs text-gray-500">表示する{calendar.slotSettings.title}(このブラウザに保存されます)</p>
              {[...slots.map((s) => ({ id: s.id, name: s.name })), { id: 'none', name: '未指定' }].map((s) => (
                <label key={s.id} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={!hiddenSlots.includes(s.id)} onChange={(e) => saveHidden(e.target.checked ? hiddenSlots.filter((x) => x !== s.id) : [...hiddenSlots, s.id])} /> {s.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {view === 'day' ? <DayView bundle={bundle} date={date} hiddenSlots={hiddenSlots} tick={tick} onOpen={setDetailId} onNew={(p) => setEditor({ preset: p })} /> : null}
      {view === 'month' ? <MonthView bundle={bundle} date={date} hiddenSlots={hiddenSlots} tick={tick} onOpen={setDetailId} onPickDay={(d) => { setDate(d); setView('day') }} /> : null}
      {view === 'list' ? <ListView bundle={bundle} tick={tick} onOpen={setDetailId} onChanged={refresh} /> : null}

      {detailId ? (
        <BookingDetail
          bundle={bundle}
          bookingId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={refresh}
          onEdit={(b) => {
            setDetailId(null)
            setEditor({ booking: b })
          }}
        />
      ) : null}
      {editor ? (
        <BookingEditor
          bundle={bundle}
          accountId={accountId}
          booking={editor.booking}
          preset={editor.preset}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}

// ── 日ビュー(予約枠が行・時間が横) ───────────────────────────────────────────

function DayView({
  bundle,
  date,
  hiddenSlots,
  tick,
  onOpen,
  onNew,
}: {
  bundle: CalendarBundle
  date: string
  hiddenSlots: string[]
  tick: number
  onOpen: (id: string) => void
  onNew: (p: EditorPreset) => void
}) {
  const { calendar, slots, courses } = bundle
  const [bookings, setBookings] = useState<ReserveBooking[]>([])
  const [shifts, setShifts] = useState<ReserveShift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pxPerHour, setPxPerHour] = useState(110)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const [b, s] = await Promise.all([
          reserveApi.bookings(calendar.id, { from: date, to: date, includeBlocks: true, statuses: ['confirmed', 'pending'], limit: 500 }),
          calendar.slotSettings.shiftLinked ? reserveApi.shifts(calendar.id, date, date) : Promise.resolve(null),
        ])
        if (cancelled) return
        if (!b.success) throw new Error(b.error)
        setBookings(b.data.items)
        setShifts(s && s.success ? s.data : [])
      } catch (err) {
        if (!cancelled) setError(errorText(err, '予約を読み込めませんでした'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [calendar.id, calendar.slotSettings.shiftLinked, date, tick])

  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, 8 * pxPerHour - 20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loading])

  const rows = [...slots.filter((s) => !hiddenSlots.includes(s.id)).map((s) => ({ id: s.id as string | null, name: s.name, icon: s.iconUrl as string })), ...(hiddenSlots.includes('none') || (calendar.slotSettings.required && !bookings.some((b) => (b.slotId ?? null) === null)) ? [] : [{ id: null as string | null, name: '未指定', icon: '' }])]
  const courseColor = new Map(courses.map((c) => [c.id, c.color]))
  const width = 24 * pxPerHour
  const unit = calendar.screen.unitMinutes
  const rowH = 54

  return (
    <div>
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
      <div className="flex overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="w-40 shrink-0 border-r border-gray-200 bg-gray-50/60">
          <div className="h-9 border-b border-gray-200" />
          {rows.map((r) => (
            <div key={r.id ?? 'none'} className="flex items-center gap-2 border-b border-gray-200 px-2 text-sm font-medium text-gray-800" style={{ height: rowH }}>
              {r.icon ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.icon} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" /> : <span className="h-6 w-6 shrink-0 rounded-full bg-gray-700 text-center text-[11px] leading-6 text-white">{r.name.charAt(0)}</span>}
              <span className="truncate">{r.name}</span>
            </div>
          ))}
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width }} className="relative">
            <div className="flex h-9 border-b border-gray-200 bg-gray-50/60 text-xs font-medium text-gray-500">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="border-l border-gray-200 pl-1.5 pt-2" style={{ width: pxPerHour }}>{`${String(h).padStart(2, '0')}:00`}</div>
              ))}
            </div>
            {rows.map((r) => (
              <div
                key={r.id ?? 'none'}
                className="relative border-b border-gray-200"
                style={{ height: rowH, backgroundImage: `repeating-linear-gradient(to right, #e5e7eb 0, #e5e7eb 1px, transparent 1px, transparent ${pxPerHour}px)` }}
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                  const minutes = Math.floor(((e.clientX - rect.left) / pxPerHour) * 60 / unit) * unit
                  onNew({ date, time: minToHhmm(Math.min(minutes, 1439)), slotId: r.id })
                }}
              >
                {calendar.slotSettings.shiftLinked && r.id
                  ? shifts.filter((s) => s.slotId === r.id).map((s) => (
                      <div key={s.id} className="absolute inset-y-0 bg-green-100/70" style={{ left: (hhmmToMin(s.startTime) / 60) * pxPerHour, width: ((hhmmToMin(s.endTime) - hhmmToMin(s.startTime)) / 60) * pxPerHour }} title={`シフト ${s.startTime}〜${s.endTime}`} />
                    ))
                  : null}
                {bookings
                  .filter((b) => (b.slotId ?? null) === r.id)
                  .map((b) => {
                    const s = hhmmToMin(b.startsAt.slice(11, 16))
                    const e = Math.max(s + 15, b.endsAt.slice(0, 10) > date ? 1440 : hhmmToMin(b.endsAt.slice(11, 16)))
                    const color = b.isBlock ? '#6b7280' : (b.courseId ? courseColor.get(b.courseId) : null) ?? '#3b82f6'
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          onOpen(b.id)
                        }}
                        className="absolute top-1 overflow-hidden rounded-lg px-2 py-1 text-left text-[11px] leading-tight text-white shadow-md ring-1 ring-black/5 transition hover:brightness-110"
                        style={{
                          left: (s / 60) * pxPerHour,
                          width: Math.max(24, ((e - s) / 60) * pxPerHour - 2),
                          height: rowH - 8,
                          background: b.status === 'pending' ? `repeating-linear-gradient(45deg, ${color}, ${color} 6px, ${color}cc 6px, ${color}cc 12px)` : color,
                          opacity: b.isBlock ? 0.85 : 1,
                        }}
                        title={`${b.startsAt.slice(11, 16)}〜${b.endsAt.slice(11, 16)} ${b.isBlock ? 'ブロック' : displayName(b)}`}
                      >
                        <div className="font-medium">{b.startsAt.slice(11, 16)} {b.isBlock ? 'ブロック' : displayName(b)}</div>
                        {b.status === 'pending' ? <div>承認待ち</div> : null}
                        {b.pendingKind ? <div>{b.pendingKind === 'change' ? '変更リクエスト' : 'キャンセルリクエスト'}</div> : null}
                      </button>
                    )
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {loading ? <div className="mt-2 text-xs text-gray-500"><Loader size="sm" /></div> : null}
      <div className="mt-4 flex items-center gap-3 text-xs text-gray-600">
        <div className="flex gap-3 text-gray-500">
          <button type="button" aria-label="最初へ" className="hover:text-gray-800" onClick={() => scroller.current?.scrollTo({ left: 0, behavior: 'smooth' })}><SkipBackIcon size={22} weight="fill" /></button>
          <button type="button" aria-label="前へ" className="hover:text-gray-800" onClick={() => scroller.current?.scrollBy({ left: -(scroller.current.clientWidth * 0.8), behavior: 'smooth' })}><RewindIcon size={22} weight="fill" /></button>
        </div>
        <div className="mx-auto flex w-full max-w-xl items-center gap-3">
          <span>詳細</span>
          <input type="range" min={40} max={260} value={pxPerHour} onChange={(e) => setPxPerHour(Number(e.target.value))} className="flex-1" aria-label="表示範囲" />
          <span>広範囲</span>
        </div>
        <div className="flex gap-3 text-gray-500">
          <button type="button" aria-label="次へ" className="hover:text-gray-800" onClick={() => scroller.current?.scrollBy({ left: scroller.current.clientWidth * 0.8, behavior: 'smooth' })}><FastForwardIcon size={22} weight="fill" /></button>
          <button type="button" aria-label="最後へ" className="hover:text-gray-800" onClick={() => scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: 'smooth' })}><SkipForwardIcon size={22} weight="fill" /></button>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-gray-500">空いている時間をクリックすると、その時間の新規予約を登録できます。</p>
    </div>
  )
}

// ── 月ビュー ────────────────────────────────────────────────────────────────

function MonthView({ bundle, date, hiddenSlots, tick, onOpen, onPickDay }: { bundle: CalendarBundle; date: string; hiddenSlots: string[]; tick: number; onOpen: (id: string) => void; onPickDay: (d: string) => void }) {
  const { calendar } = bundle
  const first = monthStart(date)
  const gridStart = addDaysStr(first, -weekdayOf(first))
  const days = Array.from({ length: 42 }, (_, i) => addDaysStr(gridStart, i))
  const [items, setItems] = useState<ReserveBooking[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await reserveApi.bookings(calendar.id, { from: days[0], to: days[41], includeBlocks: true, statuses: ['confirmed', 'pending'], limit: 2000 })
        if (cancelled) return
        if (!res.success) throw new Error(res.error)
        setItems(res.data.items)
      } catch (err) {
        if (!cancelled) setError(errorText(err, '予約を読み込めませんでした'))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.id, first, tick])

  const visible = items.filter((b) => !hiddenSlots.includes(b.slotId ?? 'none'))
  const today = todayJst()
  return (
    <div>
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
      <div className="mb-3 text-center text-xl font-bold text-gray-900">{first.slice(0, 4)}年{Number(first.slice(5, 7))}月</div>
      <div className="grid grid-cols-7 overflow-hidden rounded-2xl border-l border-t border-gray-200 bg-white text-xs shadow-sm">
        {WEEK_JA.map((w, i) => (
          <div key={w} className={`border-b border-r border-gray-200 bg-gray-50 py-2 text-center font-semibold ${i === 0 ? 'text-red-600' : i === 6 ? 'text-blue-600' : ''}`}>{w}</div>
        ))}
        {days.map((d) => {
          const list = visible.filter((b) => b.startsAt.slice(0, 10) === d)
          const inMonth = d.slice(0, 7) === first.slice(0, 7)
          return (
            <div key={d} className={`min-h-[104px] cursor-pointer border-b border-r border-gray-200 p-1.5 transition hover:bg-emerald-50/40 ${inMonth ? 'bg-white' : 'bg-gray-50/70 text-gray-400'}`} onClick={() => onPickDay(d)}>
              <div className={`mb-1 inline-block rounded-full px-1.5 py-0.5 font-semibold ${d === today ? 'bg-[#e8355d] text-white' : ''}`}>{Number(d.slice(8))}</div>
              {list.slice(0, 3).map((b) => (
                <button key={b.id} type="button" onClick={(e) => { e.stopPropagation(); onOpen(b.id) }} className={`mb-0.5 block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium ${b.isBlock ? 'bg-gray-200 text-gray-700' : b.status === 'pending' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-900'}`}>
                  {b.startsAt.slice(11, 16)} {b.isBlock ? 'ブロック' : displayName(b)}
                </button>
              ))}
              {list.length > 3 ? <div className="text-[11px] text-gray-500">他{list.length - 3}件</div> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── リストビュー ────────────────────────────────────────────────────────────

function ListView({ bundle, tick, onOpen, onChanged }: { bundle: CalendarBundle; tick: number; onOpen: (id: string) => void; onChanged: () => void }) {
  const { calendar, slots, courses } = bundle
  const [from, setFrom] = useState(todayJst())
  const [to, setTo] = useState(addDaysStr(todayJst(), 30))
  const [slotId, setSlotId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [status, setStatus] = useState('')
  const [visited, setVisited] = useState('')
  const [friendQ, setFriendQ] = useState('')
  const [guestQ, setGuestQ] = useState('')
  const [timeFrom, setTimeFrom] = useState('')
  const [timeTo, setTimeTo] = useState('')
  const [blockMode, setBlockMode] = useState<'' | 'only' | 'none'>('')
  const [items, setItems] = useState<ReserveBooking[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [bulk, setBulk] = useState(false)
  const [runFollow, setRunFollow] = useState(true)
  const PAGE = 50

  const query = useMemo(
    () => ({
      from,
      to,
      slotIds: slotId ? [slotId] : undefined,
      courseIds: courseId ? [courseId] : undefined,
      statuses: status ? ([status] as BookingStatus[]) : undefined,
      visited: visited === '' ? undefined : visited === '1',
      friendQ: friendQ.trim() || undefined,
      guestQ: guestQ.trim() || undefined,
      timeFrom: timeFrom || undefined,
      timeTo: timeTo || undefined,
      includeBlocks: blockMode !== 'none',
      onlyBlocks: blockMode === 'only',
    }),
    [from, to, slotId, courseId, status, visited, friendQ, guestQ, timeFrom, timeTo, blockMode],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await reserveApi.bookings(calendar.id, { ...query, limit: PAGE, offset: page * PAGE })
      if (!res.success) throw new Error(res.error)
      setItems(res.data.items)
      setTotal(res.data.total)
      setSelected([])
    } catch (err) {
      setError(errorText(err, '予約を読み込めませんでした'))
    } finally {
      setLoading(false)
    }
  }, [calendar.id, query, page])

  useEffect(() => {
    void load()
  }, [load, tick])
  useEffect(() => setPage(0), [query])

  const download = async () => {
    try {
      const res = await fetch(`${apiUrl()}${reserveApi.csvUrl(calendar.id, query)}`, { credentials: 'include' })
      if (!res.ok) throw new Error('csv')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `reserve-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      setError('CSVをダウンロードできませんでした')
    }
  }

  const doBulk = async () => {
    try {
      const res = await reserveApi.visited(calendar.id, selected, true, runFollow)
      if (!res.success) throw new Error(res.error)
      setBulk(false)
      onChanged()
    } catch (err) {
      setError(errorText(err, '更新できませんでした'))
    }
  }

  const sel = 'w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20'
  const fl = 'pt-1.5 text-xs font-semibold text-gray-700'
  return (
    <div>
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-3 text-sm">
            <span className="text-gray-600">{total}件</span>
            <button type="button" disabled={selected.length === 0} onClick={() => setBulk(true)} className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">一括操作: 来店/来場済みに変更する ({selected.length})</button>
            <button type="button" className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#4a9d2f] px-5 py-2 text-sm font-medium text-white hover:bg-[#3f8727]" onClick={() => void download()}><DownloadSimpleIcon size={14} weight="bold" /> CSV</button>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-gray-50 text-center text-xs text-gray-600">
                <tr className="border-b border-gray-200">
                  <th className="w-8 px-2 py-2"><input type="checkbox" aria-label="すべて選択" checked={items.length > 0 && selected.length === items.length} onChange={(e) => setSelected(e.target.checked ? items.filter((i) => !i.isBlock).map((i) => i.id) : [])} /></th>
                  <th className="px-2 py-2 font-semibold">{calendar.slotSettings.title}</th>
                  <th className="px-2 py-2 font-semibold">予約日時</th>
                  <th className="px-2 py-2 font-semibold">{calendar.courseSettings.title}</th>
                  <th className="px-2 py-2 font-semibold">ステータス</th>
                  <th className="px-2 py-2 font-semibold">来店/来場</th>
                  <th className="px-2 py-2 font-semibold">友だち</th>
                  <th className="px-2 py-2 font-semibold">お客さま</th>
                  <th className="px-2 py-2 font-semibold">ブロック</th>
                  <th className="px-2 py-2 font-semibold">承認</th>
                </tr>
              </thead>
              <tbody className="text-center">
                {loading ? <tr><td colSpan={10} className="py-8"><Loader size="sm" /></td></tr> : null}
                {!loading && items.length === 0 ? <tr><td colSpan={10} className="py-8 text-xs text-gray-500">条件に一致する予約がありません</td></tr> : null}
                {!loading
                  ? items.map((b) => (
                      <tr key={b.id} className="cursor-pointer border-b border-gray-200 hover:bg-gray-50" onClick={() => onOpen(b.id)}>
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          {!b.isBlock ? <input type="checkbox" aria-label="選択" checked={selected.includes(b.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, b.id] : selected.filter((x) => x !== b.id))} /> : null}
                        </td>
                        <td className="px-2 py-2">{b.slotId ? slots.find((s) => s.id === b.slotId)?.name ?? '' : '指定なし'}</td>
                        <td className="whitespace-nowrap px-2 py-2">{formatDateJa(b.startsAt.slice(0, 10))} {b.startsAt.slice(11, 16)}〜{b.endsAt.slice(11, 16)}</td>
                        <td className="px-2 py-2">{b.courseId ? courses.find((c) => c.id === b.courseId)?.name ?? '' : ''}</td>
                        <td className="px-2 py-2">{b.isBlock ? '' : STATUS_LABEL[b.status]}{b.pendingKind && b.status !== 'pending' ? `(${b.pendingKind === 'change' ? '変更' : 'キャンセル'}リクエスト)` : ''}</td>
                        <td className="px-2 py-2">{b.visited ? '済' : ''}{b.followState === 'running' ? ' フォロー中' : b.followState === 'done' ? ' フォロー終了' : ''}</td>
                        <td className="px-2 py-2">{b.friend ? b.friend.realName || b.friend.systemDisplayName || b.friend.displayName || '' : ''}</td>
                        <td className="px-2 py-2">{b.isBlock ? '' : b.guestName || ''}</td>
                        <td className="px-2 py-2">{b.isBlock ? '○' : ''}</td>
                        <td className="px-2 py-2 text-xs">{b.status === 'pending' || b.pendingKind ? '承認待ち' : ''}</td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="w-full shrink-0 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:w-80">
          <h3 className="mb-3 border-b-2 border-[#9fc77e] pb-1 text-base font-semibold text-gray-900">絞り込みメニュー</h3>
          <div className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-2 gap-y-2.5">
            <span className={fl}>{calendar.slotSettings.title}</span>
            <select className={sel} value={slotId} onChange={(e) => setSlotId(e.target.value)}><option value="">-- 全て --</option><option value="none">未指定</option>{slots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <span className={fl}>日付</span>
            <div className="flex items-center gap-1"><input type="date" className={sel} value={from} onChange={(e) => setFrom(e.target.value)} />~<input type="date" className={sel} value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <span className={fl}>時間</span>
            <div className="flex items-center gap-1"><input type="time" className={sel} value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />~<input type="time" className={sel} value={timeTo} onChange={(e) => setTimeTo(e.target.value)} /></div>
            <span className={fl}>{calendar.courseSettings.title}</span>
            <select className={sel} value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">-- 全て --</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <span className={fl}>ステータス</span>
            <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">-- 全て --</option>{(Object.keys(STATUS_LABEL) as BookingStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
            <span className={fl}>来店/来場</span>
            <select className={sel} value={visited} onChange={(e) => setVisited(e.target.value)}><option value="">-- 全て --</option><option value="1">済み</option><option value="0">未</option></select>
            <span className={fl}>友だち</span>
            <input className={sel} value={friendQ} placeholder="友だち名を入力" onChange={(e) => setFriendQ(e.target.value)} />
            <span className={fl}>お客さま</span>
            <input className={sel} value={guestQ} onChange={(e) => setGuestQ(e.target.value)} />
            <span className={fl}>ブロック</span>
            <select className={sel} value={blockMode} onChange={(e) => setBlockMode(e.target.value as '' | 'only' | 'none')}><option value="">-- 全て --</option><option value="only">ブロックのみ</option><option value="none">ブロックを除く</option></select>
          </div>
        </aside>
      </div>
      {total > PAGE ? (
        <div className="mt-2 flex items-center justify-center gap-3 text-sm">
          <button type="button" className={toolBtn} disabled={page === 0} onClick={() => setPage(page - 1)}>前へ</button>
          <span>{page + 1} / {Math.ceil(total / PAGE)}</span>
          <button type="button" className={toolBtn} disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>次へ</button>
        </div>
      ) : null}

      {bulk ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setBulk(false)}>
          <div className="w-[min(420px,92%)] rounded bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-medium">選んだ{selected.length}件を、来店/来場済みにします。</p>
            {calendar.follow.enabled ? <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={runFollow} onChange={(e) => setRunFollow(e.target.checked)} /> フォローを実行する</label> : <p className="mb-4 text-xs text-gray-500">フォロー設定がオフのため、フォローは実行されません。</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded border border-gray-300 px-4 py-2 text-sm" onClick={() => setBulk(false)}>キャンセル</button>
              <button type="button" className="rounded bg-[#e8355d] px-4 py-2 text-sm font-medium text-white" onClick={() => void doBulk()}>実行する</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
