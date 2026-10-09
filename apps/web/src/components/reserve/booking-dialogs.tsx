'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarBlankIcon, CheckCircleIcon, ChatCircleIcon, ClockIcon, CurrencyJpyIcon, PencilSimpleIcon, StorefrontIcon, TrashIcon, UserIcon, XIcon } from '@phosphor-icons/react'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Loader } from '@cloudflare/kumo/components/loader'
import { api } from '@/lib/api'
import { errorText } from '@/lib/error-text'
import { STATUS_LABEL, formatDateJa, hhmmToMin, minToHhmm, reserveApi } from '@/lib/reserve'
import type { BookingStatus, CalendarBundle, ReserveBooking } from '@/lib/reserve'

const pinkBtn = 'rounded-full bg-[#e8355d] px-5 py-2 text-sm font-semibold text-white shadow-md shadow-rose-200 transition hover:bg-[#d02850] disabled:opacity-60'
const grayBtn = 'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-60'
const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20'

export function displayName(b: Pick<ReserveBooking, 'name' | 'guestName' | 'friend'>): string {
  return b.name || b.guestName || b.friend?.realName || b.friend?.systemDisplayName || b.friend?.displayName || '(名前なし)'
}

/** 友だちを探して選ぶ */
function FriendPicker({ accountId, value, onChange }: { accountId: string; value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Array<{ id: string; name: string; picture: string | null }>>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await api.friends.list({ accountId, search: q.trim() || undefined, limit: 10, includeTags: false })
        if (res.success) {
          setItems(res.data.items.filter((f) => f.isFollowing !== false).map((f) => ({ id: f.id, name: f.realName || f.systemDisplayName || f.displayName || '(名前なし)', picture: f.pictureUrl ?? null })))
        }
      } catch {
        setItems([])
      }
    }, 250)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [q, open, accountId])

  return (
    <div className="relative">
      {value ? (
        <div className="flex items-center justify-between rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm">
          <span>{value.name}</span>
          <button type="button" className="text-xs text-red-600" onClick={() => onChange(null)}>選び直す</button>
        </div>
      ) : (
        <>
          <input className={inputCls} placeholder="友だちを検索して選ぶ" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} />
          {open ? (
            <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded border border-gray-300 bg-white py-1 text-sm shadow">
              {items.length === 0 ? <li className="px-3 py-2 text-gray-400">該当する友だちがいません</li> : null}
              {items.map((f) => (
                <li key={f.id}>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-100" onClick={() => { onChange({ id: f.id, name: f.name }); setOpen(false) }}>
                    {f.picture ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={f.picture} alt="" className="h-6 w-6 rounded-full" /> : <span className="h-6 w-6 rounded-full bg-gray-200" />}
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  )
}

export interface EditorPreset {
  date?: string
  time?: string
  slotId?: string | null
}

/** 管理者の新規予約・予約の編集(ブロック枠も) */
export function BookingEditor({
  bundle,
  accountId,
  booking,
  preset,
  onClose,
  onSaved,
}: {
  bundle: CalendarBundle
  accountId: string
  booking?: ReserveBooking | null
  preset?: EditorPreset
  onClose: () => void
  onSaved: (b: ReserveBooking) => void
}) {
  const { calendar, slots, courses } = bundle
  const editing = !!booking
  const [isBlock, setIsBlock] = useState(booking?.isBlock ?? false)
  const [courseId, setCourseId] = useState(booking?.courseId ?? '')
  const [date, setDate] = useState(booking?.startsAt.slice(0, 10) ?? preset?.date ?? '')
  const [start, setStart] = useState(booking?.startsAt.slice(11, 16) ?? preset?.time ?? '10:00')
  const [end, setEnd] = useState(booking?.endsAt.slice(11, 16) ?? '')
  const [useCourseTime, setUseCourseTime] = useState(!booking)
  const [slotId, setSlotId] = useState(booking ? (booking.slotId ?? '') : (preset?.slotId ?? ''))
  const [slotPrice, setSlotPrice] = useState(booking?.slotPriceApplied ?? true)
  const [friend, setFriend] = useState<{ id: string; name: string } | null>(booking?.friendId ? { id: booking.friendId, name: displayName(booking) } : null)
  const [answers, setAnswers] = useState<Record<string, string>>(booking?.answers ?? {})
  const [overwrite, setOverwrite] = useState(false)
  const [runActions, setRunActions] = useState(false)
  const [memo, setMemo] = useState(booking?.memo ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const course = courses.find((c) => c.id === courseId) ?? null
  const minutes = course ? course.durationMinutes : calendar.courseSettings.unspecifiedMinutes
  const computedEnd = useMemo(() => (start ? minToHhmm(Math.min(1439, hhmmToMin(start) + minutes)) : ''), [start, minutes])
  const effectiveEnd = useCourseTime ? computedEnd : end || computedEnd

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      if (!date || !start) throw new Error('日付と開始時間を入力してください')
      const body: Record<string, unknown> = {
        friendId: isBlock ? null : friend?.id ?? null,
        slotId: slotId || null,
        courseId: isBlock ? null : courseId || null,
        startsAt: `${date}T${start}`,
        endsAt: `${date}T${effectiveEnd}`,
        isBlock,
        answers: isBlock ? {} : answers,
        runActions,
        slotPriceApplied: slotPrice,
        overwriteFriend: overwrite,
        memo,
      }
      const res = editing ? await reserveApi.updateBooking(booking!.id, { ...body, endsAt: `${date}T${effectiveEnd}` }) : await reserveApi.createBooking(calendar.id, body)
      if (!res.success) throw new Error(res.error)
      onSaved(res.data)
    } catch (err) {
      setError(errorText(err, '登録できませんでした'))
    } finally {
      setBusy(false)
    }
  }

  const row = 'grid grid-cols-[110px_1fr] items-start gap-3 py-2'
  const label = 'pt-1.5 text-xs font-semibold text-gray-700'
  const req = <span className="ml-1 rounded bg-[#f0627f] px-1.5 py-0.5 text-[10px] font-bold text-white">必須</span>

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative h-full w-[min(680px,100vw)] overflow-y-auto bg-white shadow-2xl">
        <button type="button" className="sticky left-0 top-0 z-10 flex items-center gap-1 rounded-br-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-black" onClick={onClose}>
          <span aria-hidden>×</span> Close
        </button>
        <div className="px-6 pb-24 pt-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">{editing ? '予約の編集' : '新規予約登録'}</h2>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isBlock} onChange={(e) => setIsBlock(e.target.checked)} /> この時間の予約をブロックする
            </label>
          </div>
          {!isBlock ? (
            <div className={row}>
              <span className={label}>{calendar.courseSettings.title}{calendar.courseSettings.required ? req : null}</span>
              <select className={inputCls} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">-- 未指定 --</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.visible ? '(非表示)' : ''} / {c.durationMinutes}分</option>)}
              </select>
            </div>
          ) : null}
          <div className={row}>
            <span className={label}>日付</span>
            <input type="date" className={`${inputCls} w-48`} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={row}>
            <span className={label}>時間{req}</span>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input type="time" step={calendar.screen.unitMinutes * 60} className={`${inputCls} w-32`} value={start} onChange={(e) => setStart(e.target.value)} />
                <span>~</span>
                <input type="time" className={`${inputCls} w-32 disabled:bg-gray-100 disabled:font-semibold`} value={effectiveEnd} disabled={useCourseTime} onChange={(e) => setEnd(e.target.value)} />
              </div>
              {!isBlock ? (
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={useCourseTime} onChange={(e) => { setUseCourseTime(e.target.checked); if (!e.target.checked) setEnd(computedEnd) }} /> 終了時間をコース所要時間から設定
                </label>
              ) : null}
            </div>
          </div>
          <div className={row}>
            <span className={label}>{calendar.slotSettings.title}{calendar.slotSettings.required ? req : null}</span>
            <div className="space-y-1">
              <select className={inputCls} value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                <option value="">-- 未指定 --</option>
                {slots.map((s) => <option key={s.id} value={s.id}>{s.name}{!s.visible ? '(非表示)' : ''}</option>)}
              </select>
              {!isBlock && calendar.slotSettings.priceEnabled && slotId ? (
                <div className="flex gap-4 text-xs">
                  <label className="flex items-center gap-1"><input type="radio" checked={slotPrice} onChange={() => setSlotPrice(true)} /> 予約枠の料金を加算する</label>
                  <label className="flex items-center gap-1"><input type="radio" checked={!slotPrice} onChange={() => setSlotPrice(false)} /> 加算しない</label>
                </div>
              ) : null}
            </div>
          </div>
          {!isBlock ? (
            <>
              <div className={row}>
                <span className={label}>友だちを選択</span>
                <FriendPicker accountId={accountId} value={friend} onChange={setFriend} />
              </div>
              <h3 className="mb-1 mt-6 text-sm font-semibold text-gray-900">予約情報取得項目</h3>
              {calendar.screen.fields.map((f) => (
                <div key={f.id} className={row}>
                  <span className={label}>{f.label}{f.required ? req : null}</span>
                  {f.type === 'textarea' ? (
                    <textarea className={inputCls} rows={3} value={answers[f.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })} />
                  ) : f.type === 'select' ? (
                    <select className={inputCls} value={answers[f.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })}>
                      <option value="">選択してください</option>
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input className={inputCls} value={answers[f.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })} />
                  )}
                </div>
              ))}
              <div className={row}>
                <span className={label}>予約メモ</span>
                <textarea className={inputCls} rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />
              </div>
              <h3 className="mb-1 mt-6 text-sm font-semibold text-gray-900">登録時オプション</h3>
              {friend ? (
                <div className={row}>
                  <span />
                  <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> 登録後、項目内容を友だち情報または本名に上書きする</label>
                </div>
              ) : null}
              <div className={row}>
                <span className={label}>アクションの実行</span>
                <div className="flex gap-5 pt-1 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={runActions} onChange={() => setRunActions(true)} /> 実行する</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={!runActions} onChange={() => setRunActions(false)} /> 実行しない</label>
                </div>
              </div>
            </>
          ) : null}
          {error ? <p className="py-2 text-sm text-red-600">{error}</p> : null}
          <div className="py-6 text-center">
            <button type="button" className={`${pinkBtn} px-10 py-3`} disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : editing ? '予約を更新' : isBlock ? 'ブロック枠を登録する' : '予約を登録する'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const KIND_LABEL: Record<string, string> = { new: '新規予約', change: '変更', cancel: 'キャンセル' }

/** 予約の詳細(ステータス・来店済み・承認・履歴・メモ) */
export function BookingDetail({
  bundle,
  bookingId,
  onClose,
  onChanged,
  onEdit,
}: {
  bundle: CalendarBundle
  bookingId: string
  onClose: () => void
  onChanged: () => void
  onEdit: (b: ReserveBooking) => void
}) {
  const { calendar } = bundle
  const [data, setData] = useState<Awaited<ReturnType<typeof reserveApi.booking>> | null>(null)
  const [error, setError] = useState('')
  const [memo, setMemo] = useState('')
  const [runActions, setRunActions] = useState(calendar.actions.runActionsByDefault)
  const [makeDefault, setMakeDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | 'cancel' | 'delete' | 'visited'>(null)
  const [cancelActions, setCancelActions] = useState(true)
  const [runFollow, setRunFollow] = useState(true)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await reserveApi.booking(bookingId)
      setData(res)
      if (res.success) setMemo(res.data.booking.memo)
      else setError(res.error)
    } catch {
      setError('読み込めませんでした')
    }
  }, [bookingId])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (fn: () => Promise<{ success: boolean; error?: string }>, after?: () => void) => {
    setBusy(true)
    setError('')
    try {
      const res = await fn()
      if (!res.success) throw new Error(res.error)
      setConfirm(null)
      await load()
      onChanged()
      after?.()
    } catch (err) {
      setError(errorText(err, '操作できませんでした'))
    } finally {
      setBusy(false)
    }
  }

  const d = data && data.success ? data.data : null
  const b = d?.booking ?? null

  const decide = (decision: 'approve' | 'reject') =>
    act(async () => {
      if (makeDefault) await reserveApi.saveSection(calendar.id, 'actions', { ...calendar.actions, runActionsByDefault: runActions })
      return reserveApi.decide(bookingId, decision, runActions)
    })

  const kind = b ? (b.status === 'pending' ? 'new' : b.pendingKind) : null
  const payload = b?.pendingPayload as { startsAt?: string; endsAt?: string } | null

  const STATUS_STYLE: Record<BookingStatus, string> = {
    confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    pending: 'bg-amber-50 text-amber-700 ring-amber-200',
    cancelled: 'bg-gray-100 text-gray-600 ring-gray-200',
    rejected: 'bg-red-50 text-red-700 ring-red-200',
  }
  const weekday = b ? ['日', '月', '火', '水', '木', '金', '土'][new Date(`${b.startsAt.slice(0, 10)}T00:00:00Z`).getUTCDay()] : ''
  const nm = b ? displayName(b) : ''
  const picture = d?.friend?.picture_url ?? null
  const card = 'rounded-xl border border-gray-200 bg-white p-4'
  const cardTitle = 'mb-3 text-xs font-semibold tracking-wide text-gray-500'

  const Item = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
    <div className="flex items-start gap-3 py-2">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] leading-4 text-gray-500">{label}</div>
        <div className="text-sm font-medium text-gray-900">{children}</div>
      </div>
    </div>
  )

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="lg" className="p-0 !w-[min(880px,96vw)] !max-w-none overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 bg-gradient-to-b from-gray-50 to-white px-6 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>{calendar.name}</span>
              {b ? <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-gray-200">{b.isBlock ? 'ブロック枠' : b.createdBy === 'admin' ? '管理者が登録' : '友だちが予約'}</span> : null}
            </div>
            {b ? (
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-bold tracking-tight text-gray-900">
                  {Number(b.startsAt.slice(5, 7))}月{Number(b.startsAt.slice(8, 10))}日({weekday}) <span className="tabular-nums">{b.startsAt.slice(11, 16)}〜{(b.displayEndsAt ?? b.endsAt).slice(11, 16)}</span>
                </h2>
                {!b.isBlock ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATUS_STYLE[b.status]}`}>{STATUS_LABEL[b.status]}{b.pendingKind && b.status !== 'pending' ? `・${KIND_LABEL[b.pendingKind] ?? ''}リクエスト中` : ''}</span> : null}
              </div>
            ) : (
              <h2 className="text-xl font-bold text-gray-900">予約の詳細</h2>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {b ? (
              <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50" onClick={() => onEdit(b)}>
                <PencilSimpleIcon size={14} /> 編集
              </button>
            ) : null}
            <button type="button" aria-label="閉じる" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={onClose}><XIcon size={18} /></button>
          </div>
        </div>

        <div className="max-h-[68vh] overflow-y-auto bg-gray-50/60 px-6 py-5">
          {!d ? <div className="py-10 text-center">{error ? <span className="text-sm text-red-600">{error}</span> : <Loader size="sm" />}</div> : null}
          {d && b ? (
            <div className="space-y-4 text-sm">
              {kind ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                  <p className="mb-1 text-sm font-semibold text-amber-900">承認待ち: {KIND_LABEL[kind]}のリクエストが届いています</p>
                  {kind === 'change' && payload?.startsAt ? <p className="mb-2 text-xs text-amber-900">変更後の予約日時: {formatDateJa(payload.startsAt.slice(0, 10))} {payload.startsAt.slice(11, 16)}</p> : null}
                  <div className="mb-3 mt-2 space-y-1">
                    <label className="flex items-center gap-2 text-xs text-amber-950"><input type="checkbox" checked={runActions} onChange={(e) => setRunActions(e.target.checked)} /> アクションを実行する</label>
                    <label className="flex items-center gap-2 text-xs text-amber-950"><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> 「アクション実行」をデフォルト値にする(カレンダーごと)</label>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={pinkBtn} disabled={busy} onClick={() => void decide('approve')}>承認する</button>
                    <button type="button" className={grayBtn} disabled={busy} onClick={() => void decide('reject')}>否認する</button>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-[1.35fr_1fr]">
                {/* 左: 友だち・予約内容・回答 */}
                <div className="space-y-4">
                  {!b.isBlock ? (
                    <div className={card}>
                      <div className={cardTitle}>友だち</div>
                      <div className="flex items-center gap-3">
                        {picture ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={picture} alt="" className="h-12 w-12 rounded-full object-cover ring-1 ring-gray-200" /> : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 text-gray-500"><UserIcon size={22} /></span>}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-bold text-gray-900">{b.friend || d.friend ? nm : b.guestName || '(友だち未選択)'}</div>
                          {d.friend && d.friend.display_name && d.friend.display_name !== nm ? <div className="truncate text-xs text-gray-500">LINE名: {d.friend.display_name}</div> : null}
                        </div>
                        {b.friendId ? (
                          <div className="flex shrink-0 gap-2">
                            <Link href={`/friends/detail?id=${b.friendId}`} target="_blank" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"><UserIcon size={13} /> 友だち詳細</Link>
                            <Link href={`/chats?friend=${b.friendId}`} target="_blank" className="inline-flex items-center gap-1 rounded-lg bg-[#06c755] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#05b34c]"><ChatCircleIcon size={13} weight="fill" /> 個別トーク</Link>
                          </div>
                        ) : null}
                      </div>
                      {d.friend?.notes ? <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">メモ: {d.friend.notes}</p> : null}
                    </div>
                  ) : null}

                  <div className={card}>
                    <div className={cardTitle}>予約内容</div>
                    <div className="divide-y divide-gray-100">
                      <Item icon={<CalendarBlankIcon size={16} />} label="日時">{formatDateJa(b.startsAt.slice(0, 10))} {b.startsAt.slice(11, 16)}〜{(b.displayEndsAt ?? b.endsAt).slice(11, 16)}</Item>
                      {!b.isBlock ? (
                        <>
                          <Item icon={<ClockIcon size={16} />} label={calendar.slotSettings.title}>{d.names.slotName || '指定なし'}</Item>
                          <Item icon={<StorefrontIcon size={16} />} label={calendar.courseSettings.title}>{d.names.courseName || '指定なし'}</Item>
                          {calendar.slotSettings.priceEnabled || calendar.courseSettings.priceEnabled || b.price > 0 ? <Item icon={<CurrencyJpyIcon size={16} />} label="料金">{b.price.toLocaleString('ja-JP')}円</Item> : null}
                        </>
                      ) : null}
                    </div>
                  </div>

                  {!b.isBlock && calendar.screen.fields.some((f) => b.answers[f.id]) ? (
                    <div className={card}>
                      <div className={cardTitle}>予約情報</div>
                      <dl className="divide-y divide-gray-100">
                        {calendar.screen.fields.filter((f) => b.answers[f.id]).map((f) => (
                          <div key={f.id} className="grid grid-cols-[120px_1fr] gap-3 py-2">
                            <dt className="text-xs text-gray-500">{f.label}</dt>
                            <dd className="whitespace-pre-wrap text-sm font-medium text-gray-900">{b.answers[f.id]}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ) : null}
                </div>

                {/* 右: 対応・履歴・メモ */}
                <div className="space-y-4">
                  {!b.isBlock ? (
                    <div className={card}>
                      <div className={cardTitle}>対応</div>
                      <div className="space-y-3">
                        <label className="block text-xs text-gray-500">予約ステータス
                          <select
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900"
                            value={b.status}
                            disabled={busy || b.status === 'pending'}
                            onChange={(e) => { if (e.target.value === 'cancelled') setConfirm('cancel') }}
                          >
                            {(['confirmed', 'pending', 'cancelled', 'rejected'] as BookingStatus[]).map((s) => <option key={s} value={s} disabled={s !== b.status && s !== 'cancelled'}>{STATUS_LABEL[s]}</option>)}
                          </select>
                        </label>
                        <label className="block text-xs text-gray-500">完了後のステータス
                          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900" value={b.followupStatus ?? ''} disabled={busy} onChange={(e) => void act(() => reserveApi.updateBooking(bookingId, { followupStatus: e.target.value }))}>
                            <option value="">未設定</option>
                            <option value="対応済み">対応済み</option>
                          </select>
                        </label>
                        {b.status === 'confirmed' ? (
                          <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${b.visited ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
                            <span className="flex items-center gap-2 text-sm font-medium text-gray-800"><CheckCircleIcon size={18} weight={b.visited ? 'fill' : 'regular'} className={b.visited ? 'text-emerald-600' : 'text-gray-400'} /> 来店/来場済み</span>
                            <input type="checkbox" checked={b.visited} disabled={busy} onChange={(e) => (e.target.checked ? setConfirm('visited') : void act(() => reserveApi.visited(calendar.id, [b.id], false, false)))} />
                          </label>
                        ) : null}
                        {b.followState === 'running' ? <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">フォロー中</span> : null}
                        {b.followState === 'done' ? <span className="inline-block rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-700">フォロー終了</span> : null}
                      </div>
                    </div>
                  ) : null}

                  <div className={card}>
                    <div className={cardTitle}>予約メモ</div>
                    <textarea className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" rows={3} placeholder="スタッフ用のメモ(友だちには見えません)" value={memo} onChange={(e) => setMemo(e.target.value)} />
                    <div className="mt-2 text-right">
                      <button type="button" className={grayBtn} disabled={busy || memo === b.memo} onClick={() => void act(() => reserveApi.updateBooking(bookingId, { memo }))}>メモを保存</button>
                    </div>
                  </div>

                  <div className={card}>
                    <div className={cardTitle}>操作履歴</div>
                    <ol className="relative space-y-3 border-l border-gray-200 pl-4">
                      {d.logs.map((l, i) => (
                        <li key={i} className="relative">
                          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-gray-300 ring-2 ring-white" />
                          <div className="text-xs text-gray-900">{l.text}{l.actor && l.actor !== 'friend' ? `(${l.actor})` : ''}</div>
                          <div className="text-[11px] text-gray-500">{l.createdAt.slice(0, 16).replace('T', ' ')}</div>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {d.recent.length > 0 ? (
                    <div className={card}>
                      <div className={cardTitle}>この友だちの直近の予約</div>
                      <ul className="space-y-1.5">
                        {d.recent.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-2 text-xs text-gray-700">
                            <span className="tabular-nums">{formatDateJa(r.startsAt.slice(0, 10))} {r.startsAt.slice(11, 16)}</span>
                            <span className={`rounded-full px-2 py-0.5 ring-1 ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {error && d ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 bg-white px-6 py-3">
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50" onClick={() => setConfirm('delete')}><TrashIcon size={15} /> 削除する</button>
          <button type="button" className={grayBtn} onClick={onClose}>閉じる</button>
        </div>

        {confirm ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
            <div className="w-[min(440px,92%)] rounded-2xl bg-white p-6 shadow-2xl">
              {confirm === 'cancel' ? (
                <>
                  <p className="mb-3 text-base font-bold text-gray-900">この予約をキャンセル済みにしますか?</p>
                  <label className="mb-5 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={cancelActions} onChange={(e) => setCancelActions(e.target.checked)} /> 予約キャンセル時のアクションを実行する</label>
                </>
              ) : null}
              {confirm === 'delete' ? (
                <>
                  <p className="mb-2 text-base font-bold text-gray-900">この予約を削除しますか?</p>
                  <p className="mb-5 text-sm text-gray-600">削除すると元に戻せません。友だちへの通知は送られません。</p>
                </>
              ) : null}
              {confirm === 'visited' ? (
                <>
                  <p className="mb-3 text-base font-bold text-gray-900">来店/来場済みにします</p>
                  {calendar.follow.enabled ? <label className="mb-5 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={runFollow} onChange={(e) => setRunFollow(e.target.checked)} /> フォローを実行する</label> : <p className="mb-5 text-xs text-gray-500">フォロー設定がオフのため、フォローは実行されません。</p>}
                </>
              ) : null}
              <div className="flex justify-end gap-2">
                <button type="button" className={grayBtn} onClick={() => setConfirm(null)}>戻る</button>
                <button
                  type="button"
                  className={confirm === 'delete' ? 'rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60' : pinkBtn}
                  disabled={busy}
                  onClick={() => {
                    if (confirm === 'cancel') void act(() => reserveApi.cancelBooking(bookingId, cancelActions))
                    else if (confirm === 'delete') void act(() => reserveApi.deleteBooking(bookingId), onClose)
                    else void act(() => reserveApi.visited(calendar.id, [bookingId], true, runFollow))
                  }}
                >
                  {confirm === 'delete' ? '削除する' : 'OK'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>
    </Dialog.Root>
  )
}
