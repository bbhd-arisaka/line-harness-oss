'use client'

import { useState } from 'react'
import { LightningIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import ActionSettingsModal from '@/components/friend-add/action-settings-modal'
import { useActionLookups } from '@/components/friend-add/use-action-lookups'
import { describeAction, describeTiming } from '@/lib/friend-add-actions'
import type { FriendAddActionItem } from '@/lib/friend-add-actions'
import type { CalendarBundle, FollowItem, FollowSettings, ReminderItem, ReminderSettings, ReserveActionKey, ReserveActions } from '@/lib/reserve'
import { Block, PageTitle, Row, SaveBar, orangeBtn, smallInput, useSectionSave } from './config-common'

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
        {actions.length > 0 && !disabled ? <button type="button" className="rounded border border-green-600 bg-white px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50" onClick={onClear}>設定解除</button> : null}
      </div>
      {actions.length > 0 ? <ul className="mt-1 space-y-0.5 text-[11px] text-gray-700">{summary(actions, lookups)}</ul> : null}
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
      <div className="mb-10">
        <div className="mb-2 flex items-center gap-3"><h2 className="text-xl font-semibold text-gray-900">リマインダ設定</h2><Toggle on={rem.enabled} label="リマインダ" onChange={(v) => setRem({ ...rem, enabled: v })} /></div>
        <p className="mb-1 text-sm text-gray-600">予約した友だちに対して、予約日前の効果的なタイミングでリマインドアクションを起こすことができます。</p>
        <p className="mb-4 text-sm font-semibold text-gray-800">設定前に入っている予約にはリマインダは送信されません。</p>
        <p className="mb-3 text-xs text-gray-500">時刻指定と残り時間指定を合わせて、10件まで登録できます。</p>
        {rem.items.map((it) => (
          <div key={it.id} className="mb-3 rounded border border-gray-300 bg-white p-3">
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
        <button type="button" disabled={total(rem.items.length)} className="inline-flex items-center gap-1 text-sm text-[#e8355d] disabled:opacity-40" onClick={() => setRem({ ...rem, items: [...rem.items, { id: newId('r'), kind: 'time', daysBefore: 1, time: '19:00', amount: 1, unit: 'hours', actions: [] }] })}>
          <PlusIcon size={14} weight="bold" /> タイミングを追加
        </button>
        <div className="mt-4"><button type="button" className="rounded-full bg-[#e8355d] px-8 py-2.5 text-sm font-medium text-white hover:bg-[#d02850] disabled:opacity-60" disabled={remSave.busy} onClick={() => void remSave.save(rem)}>設定を保存する</button>{remSave.message ? <span className={`ml-3 text-sm ${remSave.message.ok ? 'text-green-700' : 'text-red-600'}`}>{remSave.message.text}</span> : null}</div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-3"><h2 className="text-xl font-semibold text-gray-900">フォロー設定</h2><Toggle on={fol.enabled} label="フォロー" onChange={(v) => setFol({ ...fol, enabled: v })} /></div>
        <p className="mb-1 text-sm text-gray-600">友だちが来店・来場した後に、任意のタイミングで感謝のメッセージやアンケートの送付などができます。</p>
        <p className="mb-1 text-sm text-gray-600">実際に来店・来場したかどうかは、「来店/来場済み」ステータスで管理できます。</p>
        <p className="mb-4 text-sm font-semibold text-gray-800">「来店/来場済み」ステータスにチェックがついていない友だちに対してはフォローアクションは実行されません。</p>
        <p className="mb-3 text-xs text-gray-500">時刻指定と経過時間指定を合わせて、10件まで登録できます。</p>
        {fol.items.map((it) => (
          <div key={it.id} className="mb-3 rounded border border-gray-300 bg-white p-3">
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
        <button type="button" disabled={total(fol.items.length)} className="inline-flex items-center gap-1 text-sm text-[#e8355d] disabled:opacity-40" onClick={() => setFol({ ...fol, items: [...fol.items, { id: newId('f'), kind: 'time', daysAfter: 1, time: '19:00', amount: 1, unit: 'hours', actions: [] }] })}>
          <PlusIcon size={14} weight="bold" /> タイミングを追加
        </button>
        <div className="mt-4"><button type="button" className="rounded-full bg-[#e8355d] px-8 py-2.5 text-sm font-medium text-white hover:bg-[#d02850] disabled:opacity-60" disabled={folSave.busy} onClick={() => void folSave.save(fol)}>設定を保存する</button>{folSave.message ? <span className={`ml-3 text-sm ${folSave.message.ok ? 'text-green-700' : 'text-red-600'}`}>{folSave.message.text}</span> : null}</div>
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
  const { busy, message, save } = useSectionSave(cal.id, 'external', reload)
  return (
    <div>
      <PageTitle>外部サービス連携設定</PageTitle>
      <Block title="Googleカレンダー連携" hint="Googleカレンダーの予定の時間帯をシフトに反映したり、予約をGoogleカレンダーの予定に反映できます。">
        <Row label="連携">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={g.enabled} onChange={(e) => setG({ ...g, enabled: e.target.checked })} /> 利用する</label>
        </Row>
        {g.enabled ? (
          <>
            <Row label="連携対象">
              <select className={`${smallInput} w-72`} value={g.target} onChange={(e) => setG({ ...g, target: e.target.value as typeof g.target })}>
                <option value="all">すべて(予約をGoogleに反映・Googleをシフトに反映)</option>
                <option value="bookings">予約をGoogleカレンダーの予定に反映</option>
                <option value="shift">Googleカレンダーをシフトに連動</option>
              </select>
            </Row>
            <Row label="連携するGoogleカレンダー" note="Googleカレンダーの接続は、設定 > 外部連携 で登録したものから選びます。">
              <input className={`${smallInput} w-72`} placeholder="接続ID(空のときは、連携されません)" value={g.connectionId ?? ''} onChange={(e) => setG({ ...g, connectionId: e.target.value || null })} />
            </Row>
          </>
        ) : null}
      </Block>
      <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">Googleカレンダーとの実際の同期は、現在準備中です。設定は保存されますが、反映は始まっていません。</p>
      <SaveBar busy={busy} message={message} onSave={() => void save({ google: g })} />
    </div>
  )
}
