'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaretLeftIcon, CaretRightIcon, FastForwardIcon, RewindIcon, SkipBackIcon, SkipForwardIcon } from '@phosphor-icons/react'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Loader } from '@cloudflare/kumo/components/loader'
import { errorText } from '@/lib/error-text'
import { WEEK_JA, addDaysStr, addMonthsStr, formatDateJa, hhmmToMin, monthStart, reserveApi, todayJst, weekdayOf } from '@/lib/reserve'
import type { CalendarBundle, ReserveShift } from '@/lib/reserve'

type View = 'day' | 'week' | 'month' | 'list'
const pinkBtn = 'rounded-full bg-[#e8355d] px-5 py-2 text-sm font-medium text-white hover:bg-[#d02850] disabled:opacity-60'
const toolBtn = 'inline-flex items-center justify-center border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'
const inputCls = 'w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm'

/** シフト(予約枠ごとの、受け付けられる時間)。日・週・月・リストの表示と、繰り返しの登録・変更・削除 */
export default function ShiftView({ bundle }: { bundle: CalendarBundle }) {
  const { calendar, slots } = bundle
  const [view, setView] = useState<View>('day')
  const [date, setDate] = useState(todayJst())
  const [hidden, setHidden] = useState<string[]>([])
  const [shifts, setShifts] = useState<ReserveShift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pxPerHour, setPxPerHour] = useState(120)
  const scroller = useRef<HTMLDivElement>(null)
  const [dialog, setDialog] = useState<{ shift?: ReserveShift; preset?: { slotId?: string; date?: string; start?: string } } | null>(null)

  const range = useMemo(() => {
    if (view === 'day') return { from: date, to: date }
    if (view === 'week') {
      const s = addDaysStr(date, -weekdayOf(date))
      return { from: s, to: addDaysStr(s, 6) }
    }
    if (view === 'month') {
      const f = monthStart(date)
      const s = addDaysStr(f, -weekdayOf(f))
      return { from: s, to: addDaysStr(s, 41) }
    }
    return { from: todayJst(), to: addDaysStr(todayJst(), 60) }
  }, [view, date])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await reserveApi.shifts(calendar.id, range.from, range.to)
      if (!res.success) throw new Error(res.error)
      setShifts(res.data)
    } catch (err) {
      setError(errorText(err, 'シフトを読み込めませんでした'))
    } finally {
      setLoading(false)
    }
  }, [calendar.id, range.from, range.to])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (view === 'day' && scroller.current) scroller.current.scrollLeft = Math.max(0, 8 * pxPerHour - 20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date])

  const visibleSlots = slots.filter((s) => !hidden.includes(s.id))
  const visibleShifts = shifts.filter((s) => !hidden.includes(s.slotId))
  const slotName = (id: string) => slots.find((s) => s.id === id)?.name ?? ''
  const move = (dir: -1 | 1) => setDate((d) => (view === 'month' ? addMonthsStr(d, dir) : addDaysStr(d, view === 'week' ? dir * 7 : dir)))

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold text-gray-900">シフト</h2>
        <div className="inline-flex overflow-hidden rounded border border-gray-300">
          {([['day', '日'], ['week', '週'], ['month', '月'], ['list', 'リスト']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`px-3 py-1.5 text-sm ${view === v ? 'bg-gray-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{label}</button>
          ))}
        </div>
        {view !== 'list' ? (
          <div className="inline-flex">
            <button type="button" className={`${toolBtn} rounded-l`} onClick={() => move(-1)} aria-label="前へ"><CaretLeftIcon size={14} /></button>
            <button type="button" className={`${toolBtn} border-l-0`} onClick={() => setDate(todayJst())}>今日</button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${toolBtn} w-40 border-l-0`} aria-label="日付" />
            <button type="button" className={`${toolBtn} rounded-r border-l-0`} onClick={() => move(1)} aria-label="次へ"><CaretRightIcon size={14} /></button>
          </div>
        ) : null}
        <button type="button" className={`${pinkBtn} ml-auto`} onClick={() => setDialog({ preset: { date } })}>＋ 新規シフト</button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <span>表示する{calendar.slotSettings.title}:</span>
        {slots.map((s) => (
          <label key={s.id} className="flex items-center gap-1"><input type="checkbox" checked={!hidden.includes(s.id)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((x) => x !== s.id) : [...hidden, s.id])} /> {s.name}</label>
        ))}
      </div>

      {!calendar.slotSettings.shiftLinked ? (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          いまは、予約枠の「シフト連動」を使っていないため、シフトは予約の受付に影響しません。予約設定 &gt; 予約枠 / コース で「シフト連動」を利用すると、シフトが入っている時間だけ予約を受け付けます。
        </p>
      ) : null}
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
      {slots.length === 0 ? <p className="text-sm text-gray-500">先に、予約設定で{calendar.slotSettings.title}を作ってください。</p> : null}

      {view === 'day' ? (
        <div>
          <div className="flex overflow-hidden rounded border border-gray-300 bg-white">
            <div className="w-36 shrink-0 border-r border-gray-300">
              <div className="h-8 border-b border-gray-300" />
              {visibleSlots.map((s) => (
                <div key={s.id} className="flex h-11 items-center gap-2 border-b border-gray-200 px-2 text-sm font-medium text-gray-800">
                  <span className="h-6 w-6 shrink-0 rounded-full bg-gray-700 text-center text-[11px] leading-6 text-white">{s.name.charAt(0)}</span>
                  <span className="truncate">{s.name}</span>
                </div>
              ))}
            </div>
            <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
              <div style={{ width: 24 * pxPerHour }} className="relative">
                <div className="flex h-8 border-b border-gray-300 text-xs text-gray-600">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="border-l border-gray-200 pl-1 pt-1.5" style={{ width: pxPerHour }}>{`${String(h).padStart(2, '0')}:00`}</div>
                  ))}
                </div>
                {visibleSlots.map((s) => (
                  <div
                    key={s.id}
                    className="relative h-11 cursor-pointer border-b border-gray-200"
                    style={{ backgroundImage: `repeating-linear-gradient(to right, #e5e7eb 0, #e5e7eb 1px, transparent 1px, transparent ${pxPerHour}px)` }}
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                      const h = Math.min(23, Math.floor((e.clientX - rect.left) / pxPerHour))
                      setDialog({ preset: { slotId: s.id, date, start: `${String(h).padStart(2, '0')}:00` } })
                    }}
                  >
                    {visibleShifts.filter((x) => x.slotId === s.id).map((x) => (
                      <button key={x.id} type="button" onClick={(e) => { e.stopPropagation(); setDialog({ shift: x }) }} className="absolute inset-y-1 overflow-hidden rounded bg-green-500 px-1 text-left text-[11px] text-white" style={{ left: (hhmmToMin(x.startTime) / 60) * pxPerHour, width: ((hhmmToMin(x.endTime) - hhmmToMin(x.startTime)) / 60) * pxPerHour }}>
                        {x.startTime}〜{x.endTime}{x.seriesId ? ' ↻' : ''}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
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
        </div>
      ) : null}

      {view === 'week' ? (
        <div className="overflow-x-auto rounded border border-gray-300 bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-gray-100 text-xs text-gray-600">
              <tr>
                <th className="w-32 px-2 py-2 text-left font-medium" />
                {Array.from({ length: 7 }, (_, i) => addDaysStr(range.from, i)).map((d) => <th key={d} className="px-2 py-2 font-medium">{Number(d.slice(5, 7))}/{Number(d.slice(8))}({WEEK_JA[weekdayOf(d)]})</th>)}
              </tr>
            </thead>
            <tbody>
              {visibleSlots.map((s) => (
                <tr key={s.id} className="border-t border-gray-200 align-top">
                  <td className="px-2 py-2 font-medium">{s.name}</td>
                  {Array.from({ length: 7 }, (_, i) => addDaysStr(range.from, i)).map((d) => (
                    <td key={d} className="cursor-pointer px-1 py-1 hover:bg-gray-50" onClick={() => setDialog({ preset: { slotId: s.id, date: d } })}>
                      {visibleShifts.filter((x) => x.slotId === s.id && x.workDate === d).map((x) => (
                        <button key={x.id} type="button" onClick={(e) => { e.stopPropagation(); setDialog({ shift: x }) }} className="mb-0.5 block w-full rounded bg-green-100 px-1 py-0.5 text-left text-xs text-green-900">{x.startTime}〜{x.endTime}</button>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {view === 'month' ? (
        <div className="grid grid-cols-7 border-l border-t border-gray-300 bg-white text-xs">
          {WEEK_JA.map((w) => <div key={w} className="border-b border-r border-gray-300 bg-gray-50 py-1 text-center">{w}</div>)}
          {Array.from({ length: 42 }, (_, i) => addDaysStr(range.from, i)).map((d) => (
            <div key={d} className={`min-h-[84px] cursor-pointer border-b border-r border-gray-300 p-1 ${d.slice(0, 7) === monthStart(date).slice(0, 7) ? 'bg-white' : 'bg-gray-50 text-gray-400'}`} onClick={() => setDialog({ preset: { date: d } })}>
              <div className="mb-0.5">{Number(d.slice(8))}</div>
              {visibleShifts.filter((x) => x.workDate === d).slice(0, 3).map((x) => (
                <button key={x.id} type="button" onClick={(e) => { e.stopPropagation(); setDialog({ shift: x }) }} className="mb-0.5 block w-full truncate rounded bg-green-100 px-1 text-left text-[11px] text-green-900">{slotName(x.slotId)} {x.startTime}</button>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {view === 'list' ? (
        <div className="overflow-x-auto rounded border border-gray-300 bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-gray-100 text-left text-xs text-gray-600"><tr><th className="px-3 py-2 font-medium">日付</th><th className="px-3 py-2 font-medium">時間</th><th className="px-3 py-2 font-medium">{calendar.slotSettings.title}</th><th className="px-3 py-2 font-medium">メモ</th></tr></thead>
            <tbody>
              {visibleShifts.length === 0 && !loading ? <tr><td colSpan={4} className="py-8 text-center text-gray-500">今日から60日間に、シフトがありません</td></tr> : null}
              {visibleShifts.map((x) => (
                <tr key={x.id} className="cursor-pointer border-t border-gray-200 hover:bg-gray-50" onClick={() => setDialog({ shift: x })}>
                  <td className="px-3 py-2">{formatDateJa(x.workDate)}</td>
                  <td className="px-3 py-2">{x.startTime}〜{x.endTime}{x.seriesId ? ' ↻' : ''}</td>
                  <td className="px-3 py-2">{slotName(x.slotId)}</td>
                  <td className="px-3 py-2 text-gray-600">{x.memo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {loading ? <div className="mt-2"><Loader size="sm" /></div> : null}

      {dialog ? <ShiftDialog bundle={bundle} shift={dialog.shift} preset={dialog.preset} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void load() }} /> : null}
    </div>
  )
}

function ShiftDialog({ bundle, shift, preset, onClose, onSaved }: { bundle: CalendarBundle; shift?: ReserveShift; preset?: { slotId?: string; date?: string; start?: string }; onClose: () => void; onSaved: () => void }) {
  const { calendar, slots } = bundle
  const [slotId, setSlotId] = useState(shift?.slotId ?? preset?.slotId ?? slots[0]?.id ?? '')
  const [date, setDate] = useState(shift?.workDate ?? preset?.date ?? todayJst())
  const [start, setStart] = useState(shift?.startTime ?? preset?.start ?? '10:00')
  const [end, setEnd] = useState(shift?.endTime ?? (preset?.start ? `${String(Math.min(23, Number(preset.start.slice(0, 2)) + 8)).padStart(2, '0')}:00` : '19:00'))
  const [memo, setMemo] = useState(shift?.memo ?? '')
  const [freq, setFreq] = useState<'' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('')
  const [until, setUntil] = useState(addDaysStr(date, 28))
  const [scope, setScope] = useState<'this' | 'following' | 'all'>('this')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true)
    setError('')
    try {
      const res = await fn()
      if (!res.success) throw new Error(res.error)
      onSaved()
    } catch (err) {
      setError(errorText(err, '保存できませんでした'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="base" className="p-0">
        <div className="border-b border-gray-200 px-5 py-3 text-base font-semibold">{shift ? 'シフトの編集' : '新規シフト'}</div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <label className="block">{calendar.slotSettings.title}
            <select className={inputCls} value={slotId} onChange={(e) => setSlotId(e.target.value)}>{slots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <label className="block">開始日<input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="flex items-center gap-2">
            <label className="flex-1">開始時間<input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <span className="pt-5">〜</span>
            <label className="flex-1">終了時間<input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          {!shift ? (
            <div>
              <label className="block">繰り返し
                <select className={inputCls} value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)}>
                  <option value="">しない</option>
                  <option value="daily">毎日</option>
                  <option value="weekly">毎週</option>
                  <option value="monthly">毎月</option>
                  <option value="yearly">毎年</option>
                </select>
              </label>
              {freq ? <label className="mt-2 block">繰り返しの終了日<input type="date" className={inputCls} value={until} onChange={(e) => setUntil(e.target.value)} /></label> : null}
            </div>
          ) : shift.seriesId ? (
            <fieldset className="rounded border border-gray-200 p-2 text-xs">
              <legend className="px-1 text-gray-500">繰り返しのシフトの、変更・削除の範囲</legend>
              {([['this', 'このシフトのみ'], ['following', 'これ以降のすべてのシフト'], ['all', 'すべてのシフト']] as const).map(([v, label]) => (
                <label key={v} className="mr-4 inline-flex items-center gap-1"><input type="radio" checked={scope === v} onChange={() => setScope(v)} /> {label}</label>
              ))}
            </fieldset>
          ) : null}
          <label className="block">メモ<textarea className={inputCls} rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
        <div className="flex justify-between border-t border-gray-200 px-5 py-3">
          {shift ? <button type="button" className="rounded border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50" disabled={busy} onClick={() => void run(() => reserveApi.deleteShift(shift.id, scope))}>削除する</button> : <span />}
          <div className="flex gap-2">
            <button type="button" className="rounded border border-gray-300 px-4 py-2 text-sm" onClick={onClose}>キャンセル</button>
            <button
              type="button"
              className={pinkBtn}
              disabled={busy || !slotId}
              onClick={() =>
                void run(() =>
                  shift
                    ? reserveApi.updateShift(shift.id, scope, { slotId, startTime: start, endTime: end, memo, date })
                    : reserveApi.createShift(calendar.id, { slotId, date, startTime: start, endTime: end, memo, repeat: freq ? { freq, until } : null }),
                )
              }
            >
              {shift ? 'シフトを更新' : 'シフトを登録'}
            </button>
          </div>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
