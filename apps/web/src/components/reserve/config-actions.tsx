'use client'

import { useEffect, useState } from 'react'
import { LightningIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import ActionSettingsModal from '@/components/friend-add/action-settings-modal'
import { useActionLookups } from '@/components/friend-add/use-action-lookups'
import { describeAction, describeTiming } from '@/lib/friend-add-actions'
import type { FriendAddActionItem } from '@/lib/friend-add-actions'
import { reserveApi } from '@/lib/reserve'
import type { CalendarBundle, FollowItem, FollowSettings, ReminderItem, ReminderSettings, ReserveActionKey, ReserveActions } from '@/lib/reserve'
import { Block, PageTitle, Row, SaveBar, orangeBtn, pinkBtn, smallInput, useSectionSave } from './config-common'

type ModalState = { actions: FriendAddActionItem[]; change: boolean; onSave: (a: FriendAddActionItem[]) => void } | null

function summary(actions: FriendAddActionItem[], lookups: ReturnType<typeof useActionLookups>) {
  return actions.map((a, i) => (
    <li key={i}>
      {describeAction(a, lookups)}
      {(a.type === 'text' || a.type === 'template') && a.timing && a.timing.mode !== 'now' ? `(${describeTiming(a.timing)})` : ''}
      {a.condition ? '(条件あり)' : ''}
    </li>
  ))
}

function ActionButton({ actions, onOpen, onClear, lookups, disabled }: { actions: FriendAddActionItem[]; onOpen: () => void; onClear: () => void; lookups: ReturnType<typeof useActionLookups>; disabled?: boolean }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled} className={`${orangeBtn} disabled:cursor-not-allowed disabled:opacity-40`} onClick={onOpen}><LightningIcon size={14} weight="fill" /> アクション設定</button>
        {actions.length > 0 && !disabled ? <button type="button" className="rounded-lg border border-emerald-600 bg-white px-3.5 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50" onClick={onClear}>設定解除</button> : null}
      </div>
      {actions.length > 0 ? <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">{summary(actions, lookups)}</ul> : null}
    </div>
  )
}

const BASE: Array<{ key: ReserveActionKey; label: string; change?: boolean }> = [
  { key: 'onBooked', label: '予約完了時のアクション' },
  { key: 'onChanged', label: '予約変更時のアクション', change: true },
  { key: 'onCancelled', label: '予約キャンセル時のアクション' },
]
const NEW_REQ: Array<{ key: ReserveActionKey; label: string }> = [
  { key: 'requestNewSubmitted', label: '新規予約リクエスト申請時のアクション' },
  { key: 'requestNewApproved', label: '新規予約リクエスト承認時のアクション' },
  { key: 'requestNewRejected', label: '新規予約リクエスト否認時のアクション' },
]
const CHANGE_REQ: Array<{ key: ReserveActionKey; label: string }> = [
  { key: 'requestChangeSubmitted', label: '変更リクエスト申請時のアクション' },
  { key: 'requestChangeApproved', label: '変更リクエスト承認時のアクション' },
  { key: 'requestChangeRejected', label: '変更リクエスト否認時のアクション' },
]
const CANCEL_REQ: Array<{ key: ReserveActionKey; label: string }> = [
  { key: 'requestCancelSubmitted', label: 'キャンセルリクエスト申請時のアクション' },
  { key: 'requestCancelApproved', label: 'キャンセルリクエスト承認時のアクション' },
  { key: 'requestCancelRejected', label: 'キャンセルリクエスト否認時のアクション' },
]

/** 予約設定 > アクション(予約完了・変更・キャンセル・各リクエスト) */
export function ActionsConfig({ bundle, reload }: { bundle: CalendarBundle; reload: () => void }) {
  const cal = bundle.calendar
  const [a, setA] = useState<ReserveActions>(cal.actions)
  const [modal, setModal] = useState<ModalState>(null)
  const lookups = useActionLookups(cal.lineAccountId, { change: false })
  const lookupsChange = useActionLookups(cal.lineAccountId, { change: true })
  const { busy, message, save } = useSectionSave(cal.id, 'actions', reload)
  const ap = cal.reception.approval

  const row = (key: ReserveActionKey, label: string, change: boolean, disabled: boolean) => (
    <Row key={key} label={label}>
      <ActionButton
        actions={a[key]}
        lookups={lookups}
        disabled={disabled}
        onClear={() => setA({ ...a, [key]: [] })}
        onOpen={() => setModal({ actions: a[key], change, onSave: (x) => setA({ ...a, [key]: x }) })}
      />
    </Row>
  )

  return (
    <div>
      <PageTitle>予約アクション設定</PageTitle>
      <Block title="基本予約アクション" id="basic" hint="リクエスト制にしている項目は、発動しません(下のリクエストアクションを使います)。テキスト送信には、予約情報(予約者名・料金・予約日時・コース名・予約枠・予約確認URL)を差し込めます。">
        {BASE.map((b) => row(b.key, b.label, !!b.change, (b.key === 'onBooked' && ap.newBooking === 'request') || (b.key === 'onChanged' && ap.change === 'request') || (b.key === 'onCancelled' && ap.cancel === 'request')))}
      </Block>
      <Block title="新規予約リクエストアクション" id="req-new" hint="予約受付設定で、新規予約を「リクエスト制」にしたときに使います。">
        {NEW_REQ.map((b) => row(b.key, b.label, false, ap.newBooking !== 'request'))}
      </Block>
      <Block title="変更リクエストアクション" id="req-change" hint="予約受付設定で“友だちによる変更”を【リクエスト制】にすると、設定できます。">
        {CHANGE_REQ.map((b) => row(b.key, b.label, true, ap.change !== 'request'))}
      </Block>
      <Block title="キャンセルリクエストアクション" id="req-cancel" hint="予約受付設定で“友だちによるキャンセル”を【リクエスト制】にすると、設定できます。">
        {CANCEL_REQ.map((b) => row(b.key, b.label, false, ap.cancel !== 'request'))}
      </Block>
      <SaveBar busy={busy} message={message} onSave={() => void save(a)} />
      {modal ? (
        <ActionSettingsModal
          open
          initial={modal.actions}
          lookups={modal.change ? lookupsChange : lookups}
          accountId={cal.lineAccountId}
          onClose={() => setModal(null)}
          onSave={(x) => {
            modal.onSave(x)
            setModal(null)
          }}
        />
      ) : null}
    </div>
  )
}

// ── リマインダ・フォロー ────────────────────────────────────────────────────

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-green-500' : 'bg-gray-300'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

/** 予約設定 > リマインダ / フォロー */
export function EpisodeConfig({ bundle, reload }: { bundle: CalendarBundle; reload: () => void }) {
  const cal = bundle.calendar
  const [rem, setRem] = useState<ReminderSettings>(cal.reminders)
  const [fol, setFol] = useState<FollowSettings>(cal.follow)
  const [modal, setModal] = useState<ModalState>(null)
  const lookups = useActionLookups(cal.lineAccountId, { change: false })
  const remSave = useSectionSave(cal.id, 'reminders', reload)
  const folSave = useSectionSave(cal.id, 'follow', reload)

  const patchRem = (id: string, p: Partial<ReminderItem>) => setRem({ ...rem, items: rem.items.map((x) => (x.id === id ? { ...x, ...p } : x)) })
  const patchFol = (id: string, p: Partial<FollowItem>) => setFol({ ...fol, items: fol.items.map((x) => (x.id === id ? { ...x, ...p } : x)) })
  const total = (n: number) => n >= 10

  return (
    <div>
      <div id="reminder" className="mb-6 scroll-mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-2 flex items-center gap-3"><h2 className="text-2xl font-bold tracking-tight text-gray-900">リマインダ設定</h2><Toggle on={rem.enabled} label="リマインダ" onChange={(v) => setRem({ ...rem, enabled: v })} /></div>
        <p className="mb-1 text-sm text-gray-600">予約した友だちに対して、予約日前の効果的なタイミングでリマインドアクションを起こすことができます。</p>
        <p className="mb-4 text-sm font-semibold text-gray-800">設定前に入っている予約にはリマインダは送信されません。</p>
        <p className="mb-3 text-xs text-gray-500">時刻指定と残り時間指定を合わせて、10件まで登録できます。</p>
        {rem.items.map((it) => (
          <div key={it.id} className="mb-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select className={smallInput} value={it.kind} onChange={(e) => patchRem(it.id, { kind: e.target.value as ReminderItem['kind'] })}>
                <option value="time">時刻指定</option>
                <option value="remaining">ゴール日時までの残り時間で指定</option>
              </select>
              {it.kind === 'time' ? (
                <>
                  <span>予約日の</span>
                  <input type="number" min={0} className={`${smallInput} w-20`} value={it.daysBefore} onChange={(e) => patchRem(it.id, { daysBefore: Number(e.target.value) })} />
                  <span>日前の</span>
                  <input type="time" className={`${smallInput} w-28`} value={it.time} onChange={(e) => patchRem(it.id, { time: e.target.value })} />
                  <span>(当日は0日前)</span>
                </>
              ) : (
                <>
                  <span>予約時間の</span>
                  <input type="number" min={1} className={`${smallInput} w-20`} value={it.amount} onChange={(e) => patchRem(it.id, { amount: Number(e.target.value) })} />
                  <select className={smallInput} value={it.unit} onChange={(e) => patchRem(it.id, { unit: e.target.value as 'hours' | 'minutes' })}><option value="hours">時間前</option><option value="minutes">分前</option></select>
                </>
              )}
              <button type="button" aria-label="このリマインダを削除" className="ml-auto text-gray-400 hover:text-red-600" onClick={() => setRem({ ...rem, items: rem.items.filter((x) => x.id !== it.id) })}><TrashIcon size={16} /></button>
            </div>
            <div className="mt-2">
              <ActionButton actions={it.actions} lookups={lookups} onClear={() => patchRem(it.id, { actions: [] })} onOpen={() => setModal({ actions: it.actions, change: false, onSave: (x) => patchRem(it.id, { actions: x }) })} />
            </div>
          </div>
        ))}
        <button type="button" disabled={total(rem.items.length)} className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-rose-300 bg-rose-50/40 px-5 py-2.5 text-sm font-semibold text-[#e8355d] transition hover:bg-rose-50 disabled:opacity-40" onClick={() => setRem({ ...rem, items: [...rem.items, { id: newId('r'), kind: 'time', daysBefore: 1, time: '19:00', amount: 1, unit: 'hours', actions: [] }] })}>
          <PlusIcon size={14} weight="bold" /> タイミングを追加
        </button>
        <div className="mt-4"><button type="button" className={pinkBtn} disabled={remSave.busy} onClick={() => void remSave.save(rem)}>設定を保存する</button>{remSave.message ? <span className={`ml-3 text-sm ${remSave.message.ok ? 'text-green-700' : 'text-red-600'}`}>{remSave.message.text}</span> : null}</div>
      </div>

      <div id="follow" className="scroll-mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-2 flex items-center gap-3"><h2 className="text-2xl font-bold tracking-tight text-gray-900">フォロー設定</h2><Toggle on={fol.enabled} label="フォロー" onChange={(v) => setFol({ ...fol, enabled: v })} /></div>
        <p className="mb-1 text-sm text-gray-600">友だちが来店・来場した後に、任意のタイミングで感謝のメッセージやアンケートの送付などができます。</p>
        <p className="mb-1 text-sm text-gray-600">実際に来店・来場したかどうかは、「来店/来場済み」ステータスで管理できます。</p>
        <p className="mb-4 text-sm font-semibold text-gray-800">「来店/来場済み」ステータスにチェックがついていない友だちに対してはフォローアクションは実行されません。</p>
        <p className="mb-3 text-xs text-gray-500">時刻指定と経過時間指定を合わせて、10件まで登録できます。</p>
        {fol.items.map((it) => (
          <div key={it.id} className="mb-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select className={smallInput} value={it.kind} onChange={(e) => patchFol(it.id, { kind: e.target.value as FollowItem['kind'] })}>
                <option value="time">時刻指定</option>
                <option value="elapsed">経過時間で指定</option>
              </select>
              {it.kind === 'time' ? (
                <>
                  <span>予約日の</span>
                  <input type="number" min={0} className={`${smallInput} w-20`} value={it.daysAfter} onChange={(e) => patchFol(it.id, { daysAfter: Number(e.target.value) })} />
                  <span>日後の</span>
                  <input type="time" className={`${smallInput} w-28`} value={it.time} onChange={(e) => patchFol(it.id, { time: e.target.value })} />
                  <span>(当日は0日後)</span>
                </>
              ) : (
                <>
                  <span>コース終了後</span>
                  <input type="number" min={1} className={`${smallInput} w-20`} value={it.amount} onChange={(e) => patchFol(it.id, { amount: Number(e.target.value) })} />
                  <select className={smallInput} value={it.unit} onChange={(e) => patchFol(it.id, { unit: e.target.value as 'hours' | 'minutes' })}><option value="hours">時間後</option><option value="minutes">分後</option></select>
                  <span className="text-xs text-gray-500">(表示時間があるコースは、表示時間の終了から)</span>
                </>
              )}
              <button type="button" aria-label="このフォローを削除" className="ml-auto text-gray-400 hover:text-red-600" onClick={() => setFol({ ...fol, items: fol.items.filter((x) => x.id !== it.id) })}><TrashIcon size={16} /></button>
            </div>
            <div className="mt-2">
              <ActionButton actions={it.actions} lookups={lookups} onClear={() => patchFol(it.id, { actions: [] })} onOpen={() => setModal({ actions: it.actions, change: false, onSave: (x) => patchFol(it.id, { actions: x }) })} />
            </div>
          </div>
        ))}
        <button type="button" disabled={total(fol.items.length)} className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-rose-300 bg-rose-50/40 px-5 py-2.5 text-sm font-semibold text-[#e8355d] transition hover:bg-rose-50 disabled:opacity-40" onClick={() => setFol({ ...fol, items: [...fol.items, { id: newId('f'), kind: 'time', daysAfter: 1, time: '19:00', amount: 1, unit: 'hours', actions: [] }] })}>
          <PlusIcon size={14} weight="bold" /> タイミングを追加
        </button>
        <div className="mt-4"><button type="button" className={pinkBtn} disabled={folSave.busy} onClick={() => void folSave.save(fol)}>設定を保存する</button>{folSave.message ? <span className={`ml-3 text-sm ${folSave.message.ok ? 'text-green-700' : 'text-red-600'}`}>{folSave.message.text}</span> : null}</div>
      </div>

      {modal ? (
        <ActionSettingsModal
          open
          initial={modal.actions}
          lookups={lookups}
          accountId={cal.lineAccountId}
          onClose={() => setModal(null)}
          onSave={(x) => {
            modal.onSave(x)
            setModal(null)
          }}
        />
      ) : null}
    </div>
  )
}

// ── 外部サービス連携 ────────────────────────────────────────────────────────

/** 予約設定 > 外部サービス連携(Googleカレンダー) */
export function ExternalConfig({ bundle, reload }: { bundle: CalendarBundle; reload: () => void }) {
  const cal = bundle.calendar
  const [g, setG] = useState(cal.external.google)
  const [conns, setConns] = useState<Array<{ id: string; calendarId: string; authType: string; lastError: string | null }> | null>(null)
  const { busy, message, save } = useSectionSave(cal.id, 'external', reload)
  useEffect(() => {
    let cancelled = false
    reserveApi.googleConnections(cal.id)
      .then((r) => { if (!cancelled) setConns(r.success ? r.data : []) })
      .catch(() => { if (!cancelled) setConns([]) })
    return () => { cancelled = true }
  }, [cal.id])
  const selected = conns?.find((x) => x.id === g.connectionId)
  return (
    <div>
      <PageTitle>外部サービス連携設定</PageTitle>
      <Block title="Googleカレンダー" hint="予約をGoogleカレンダーの予定として登録したり、Googleカレンダーに入っている予定の時間を、予約を受け付けない時間にできます。">
        <Row label="連携">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={g.enabled} onChange={(e) => setG({ ...g, enabled: e.target.checked })} /> 利用する</label>
        </Row>
        {g.enabled ? (
          <>
            <Row label="iCal形式の非公開URL" note="Googleカレンダーの予定の時間を「予約を受け付けない時間」にするだけなら、これだけで使えます(Googleの接続設定はいりません)。Googleカレンダーの「設定 → 対象のカレンダーの設定 → カレンダーの統合」にある「iCal形式の非公開URL」を貼り付けてください。このURLを知っている人は予定を読めるので、他の人には見せないでください。">
              <input className={`${smallInput} w-full max-w-xl`} placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" value={g.icalUrl} onChange={(e) => setG({ ...g, icalUrl: e.target.value })} />
            </Row>
            <Row label="連携するGoogleカレンダー(予約を予定として書き込む)" note={conns && conns.length === 0 ? '書き込みには、Googleアカウントの接続が必要です。接続がまだないため、今は選べません(Googleの予定を読むだけなら、上のiCal形式のURLで使えます)。' : undefined}>
              <select className={`${smallInput} w-80`} value={g.connectionId ?? ''} onChange={(e) => setG({ ...g, connectionId: e.target.value || null })}>
                <option value="">-- 選んでください --</option>
                {(conns ?? []).map((x) => <option key={x.id} value={x.id}>{x.calendarId}{x.authType === 'oauth' ? '(Googleアカウント)' : ''}</option>)}
                {g.connectionId && !selected && conns ? <option value={g.connectionId}>(見つからない接続)</option> : null}
              </select>
              {selected?.lastError ? <p className="mt-1 text-xs text-red-600">この接続でエラーが出ています: {selected.lastError}</p> : null}
            </Row>
            <Row label="連携する内容">
              <div className="space-y-1">
                <label className="flex items-center gap-2"><input type="radio" checked={g.target === 'all'} onChange={() => setG({ ...g, target: 'all' })} /> 予約をGoogleの予定にする + Googleの予定の時間は予約を受け付けない</label>
                <label className="flex items-center gap-2"><input type="radio" checked={g.target === 'bookings'} onChange={() => setG({ ...g, target: 'bookings' })} /> 予約をGoogleの予定にする(だけ)</label>
                <label className="flex items-center gap-2"><input type="radio" checked={g.target === 'shift'} onChange={() => setG({ ...g, target: 'shift' })} /> Googleの予定の時間は予約を受け付けない(だけ)</label>
              </div>
              <p className="mt-2 text-xs text-gray-500">予約を受け付けない時間は、すべての予約枠に同じように適用されます。この画面で作った予約の予定は、受け付けない時間の判定には使われません。</p>
            </Row>
          </>
        ) : null}
      </Block>
      <SaveBar busy={busy} message={message} onSave={() => void save({ google: g })} />
    </div>
  )
}
