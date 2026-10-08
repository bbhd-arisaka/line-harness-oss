'use client'

import { useState } from 'react'
import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { DEADLINE_OPTIONS, WEEKDAYS } from '@/lib/reserve'
import type { CalendarBundle, DayRule, ReceptionSettings, RelativeUnit, TimeRange } from '@/lib/reserve'
import { Block, PageTitle, Radio, Row, SaveBar, smallInput, useSectionSave } from './config-common'

const UNIT_LABEL: Record<RelativeUnit, string> = { days: '日前', hours: '時間前', minutes: '分前' }

/** 1日ぶんの受付時間(複数の時間帯・休業・24時間) */
function DayRuleEditor({ rule, onChange, label }: { rule: DayRule; onChange: (r: DayRule) => void; label: string }) {
  const setRange = (i: number, patch: Partial<TimeRange>) => onChange({ ...rule, ranges: rule.ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="space-y-1.5">
        {!rule.closed && !rule.allDay
          ? rule.ranges.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="time" aria-label={`${label}の開始`} className={`${smallInput} w-28`} value={r.from} onChange={(e) => setRange(i, { from: e.target.value })} />
                <span>〜</span>
                <input type="time" aria-label={`${label}の終了`} className={`${smallInput} w-28`} value={r.to} onChange={(e) => setRange(i, { to: e.target.value })} />
                {rule.ranges.length > 1 ? (
                  <button type="button" aria-label="この時間帯を削除" className="text-gray-400 hover:text-red-600" onClick={() => onChange({ ...rule, ranges: rule.ranges.filter((_, j) => j !== i) })}><TrashIcon size={15} /></button>
                ) : null}
              </div>
            ))
          : <span className="text-gray-400">{rule.closed ? '休業' : '24時間'}</span>}
      </div>
      {!rule.closed && !rule.allDay ? (
        <button type="button" aria-label="受付時間を追加" className="mt-1 text-[#e8355d]" onClick={() => onChange({ ...rule, ranges: [...rule.ranges, { from: '13:00', to: '17:00' }] })}><PlusIcon size={16} weight="bold" /></button>
      ) : null}
      <label className="mt-1 inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={rule.closed} onChange={(e) => onChange({ ...rule, closed: e.target.checked, allDay: e.target.checked ? false : rule.allDay, ranges: rule.ranges.length ? rule.ranges : [{ from: '10:00', to: '19:00' }] })} /> 休業</label>
      <label className="mt-1 inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={rule.allDay} onChange={(e) => onChange({ ...rule, allDay: e.target.checked, closed: e.target.checked ? false : rule.closed, ranges: rule.ranges.length ? rule.ranges : [{ from: '10:00', to: '19:00' }] })} /> 24時間</label>
    </div>
  )
}

/** 予約設定 > 予約受付(受付時間・受付期間・同時予約可能数・承認) */
export default function ReceptionConfig({ bundle, reload }: { bundle: CalendarBundle; reload: () => void }) {
  const cal = bundle.calendar
  const [r, setR] = useState<ReceptionSettings>(cal.reception)
  const [capOn, setCapOn] = useState(cal.reception.totalCapacity !== null)
  const { busy, message, save } = useSectionSave(cal.id, 'reception', reload)
  const patch = (p: Partial<ReceptionSettings>) => setR({ ...r, ...p })

  const start = r.start
  const deadline = r.deadline

  return (
    <div>
      <PageTitle>予約受付設定</PageTitle>

      <Block title="受付時間" id="hours" hint="ここで設定した時間が、予約できる時間として友だち画面に表示されます。シフト連動を使っているときは、シフトの影響も受けます。受付時間は「特定日 > 祝日 > 曜日」の優先順位で使われます。">
        <div className="py-3">
          <Radio checked={r.hoursMode === 'daily'} onChange={() => patch({ hoursMode: 'daily' })} label="毎日共通設定" />
          <Radio checked={r.hoursMode === 'weekday'} onChange={() => patch({ hoursMode: 'weekday' })} label="曜日ごと設定" />
        </div>
        {r.hoursMode === 'daily' ? (
          <div className="py-3"><DayRuleEditor label="毎日" rule={r.daily} onChange={(d) => patch({ daily: d })} /></div>
        ) : (
          WEEKDAYS.map((w) => (
            <div key={w.key} className="grid grid-cols-[90px_1fr] gap-3 py-2">
              <div className="pt-1.5 text-sm font-medium">{w.label}</div>
              <DayRuleEditor label={w.label} rule={r.weekdays[w.key]} onChange={(d) => patch({ weekdays: { ...r.weekdays, [w.key]: d } })} />
            </div>
          ))
        )}
        <div className="py-3">
          {r.specialDays.map((s, i) => (
            <div key={i} className="mb-2 grid grid-cols-[150px_1fr_24px] items-start gap-3">
              <input type="date" aria-label="特定日" className={smallInput} value={s.date} onChange={(e) => patch({ specialDays: r.specialDays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
              <DayRuleEditor label="特定日" rule={s} onChange={(d) => patch({ specialDays: r.specialDays.map((x, j) => (j === i ? { ...d, date: x.date } : x)) })} />
              <button type="button" aria-label="この特定日を削除" className="pt-1.5 text-gray-400 hover:text-red-600" onClick={() => patch({ specialDays: r.specialDays.filter((_, j) => j !== i) })}><TrashIcon size={15} /></button>
            </div>
          ))}
          <button type="button" className="inline-flex items-center gap-1 text-sm text-[#e8355d]" onClick={() => patch({ specialDays: [...r.specialDays, { date: '', closed: true, allDay: false, ranges: [{ from: '10:00', to: '19:00' }] }] })}>
            <PlusIcon size={14} weight="bold" /> 特定日の設定を追加
          </button>
        </div>
      </Block>

      <Block title="受付期間" id="period">
        <Row label="予約の受付期間">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-gray-600">受付開始</div>
              <div className="flex flex-wrap items-center gap-2">
                <select className={`${smallInput} w-60`} value={start.mode} onChange={(e) => patch({ start: e.target.value === 'relative' ? { mode: 'relative', amount: 30, unit: 'days' } : e.target.value === 'at' ? { mode: 'at', at: '' } : { mode: 'always' } })}>
                  <option value="relative">予約日時を起点に一定期間前</option>
                  <option value="at">特定の日時を指定</option>
                  <option value="always">常に予約を受けつける</option>
                </select>
                {start.mode === 'relative' ? (
                  <>
                    <input type="number" min={0} className={`${smallInput} w-20`} value={start.amount} onChange={(e) => patch({ start: { ...start, amount: Number(e.target.value) } })} />
                    <select className={smallInput} value={start.unit} onChange={(e) => patch({ start: { ...start, unit: e.target.value as RelativeUnit } })}>{(Object.keys(UNIT_LABEL) as RelativeUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>
                    <span className="text-xs text-gray-500">から受付</span>
                  </>
                ) : null}
                {start.mode === 'at' ? <input type="datetime-local" className={smallInput} value={start.at} onChange={(e) => patch({ start: { mode: 'at', at: e.target.value } })} /> : null}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-gray-600">受付締切</div>
              <div className="flex flex-wrap items-center gap-2">
                <select className={`${smallInput} w-60`} value={deadline.mode} onChange={(e) => patch({ deadline: e.target.value === 'relative' ? { mode: 'relative', amount: 1, unit: 'days', time: '18:00' } : e.target.value === 'at' ? { mode: 'at', at: '' } : { mode: 'until_start' } })}>
                  <option value="relative">予約日時を起点に一定期間前</option>
                  <option value="at">特定の日時を指定</option>
                  <option value="until_start">予約開始まで受けつける</option>
                </select>
                {deadline.mode === 'relative' ? (
                  <>
                    <input type="number" min={0} className={`${smallInput} w-20`} value={deadline.amount} onChange={(e) => patch({ deadline: { ...deadline, amount: Number(e.target.value) } })} />
                    <select className={smallInput} value={deadline.unit} onChange={(e) => patch({ deadline: { ...deadline, unit: e.target.value as RelativeUnit, time: e.target.value === 'days' ? deadline.time ?? '18:00' : null } })}>{(Object.keys(UNIT_LABEL) as RelativeUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>
                    {deadline.unit === 'days' ? (
                      <>
                        <span className="text-xs text-gray-500">の</span>
                        <input type="time" className={`${smallInput} w-28`} value={deadline.time ?? ''} onChange={(e) => patch({ deadline: { ...deadline, time: e.target.value || null } })} />
                        <span className="text-xs text-gray-500">まで受付</span>
                      </>
                    ) : <span className="text-xs text-gray-500">まで受付</span>}
                  </>
                ) : null}
                {deadline.mode === 'at' ? <input type="datetime-local" className={smallInput} value={deadline.at} onChange={(e) => patch({ deadline: { mode: 'at', at: e.target.value } })} /> : null}
              </div>
            </div>
          </div>
        </Row>
        <Row label="予約変更の受付期限">
          <select className={`${smallInput} w-60`} value={r.changeDeadline} onChange={(e) => patch({ changeDeadline: e.target.value as ReceptionSettings['changeDeadline'] })}>{DEADLINE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </Row>
        <Row label="予約キャンセルの受付期限">
          <select className={`${smallInput} w-60`} value={r.cancelDeadline} onChange={(e) => patch({ cancelDeadline: e.target.value as ReceptionSettings['cancelDeadline'] })}>{DEADLINE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </Row>
      </Block>

      <Block title="同時予約可能数" id="capacity">
        <Row label="全体の同時予約可能数" note="予約枠に関係なく、同じ時間帯に何件まで予約を許可するかです。チェックしないときは、無制限です。">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={capOn} onChange={(e) => { setCapOn(e.target.checked); patch({ totalCapacity: e.target.checked ? r.totalCapacity ?? 1 : null }) }} /> 設定する</label>
          {capOn ? <input type="number" min={1} className={`${smallInput} ml-3 w-24`} value={r.totalCapacity ?? 1} onChange={(e) => patch({ totalCapacity: Number(e.target.value) })} /> : null}
        </Row>
        <Row label="予約枠ごとの同時予約可能数"><span className="text-gray-600">「予約枠 / コース」の設定に移動しました。</span></Row>
      </Block>

      <Block title="承認" id="approval" hint="リクエスト制にすると、友だちからの予約・変更・キャンセルは、管理者が承認して初めて確定します(承認済みの予約に対する変更・キャンセルが、リクエストの対象です)。">
        <Row label="新規予約">
          <Radio checked={r.approval.newBooking === 'auto'} onChange={() => patch({ approval: { ...r.approval, newBooking: 'auto' } })} label="全承認" />
          <Radio checked={r.approval.newBooking === 'request'} onChange={() => patch({ approval: { ...r.approval, newBooking: 'request' } })} label="リクエスト制" disabled={cal.slotSettings.autoAssign} />
          {cal.slotSettings.autoAssign ? <p className="mt-1 text-xs text-gray-500">予約枠の自動振り分けが有効のため、リクエスト制にはできません。</p> : null}
        </Row>
        <Row label="友だちによる変更">
          <Radio checked={r.approval.change === 'allow'} onChange={() => patch({ approval: { ...r.approval, change: 'allow' } })} label="許可する" />
          <Radio checked={r.approval.change === 'deny'} onChange={() => patch({ approval: { ...r.approval, change: 'deny' } })} label="許可しない" />
          <Radio checked={r.approval.change === 'request'} onChange={() => patch({ approval: { ...r.approval, change: 'request' } })} label="リクエスト制" />
        </Row>
        <Row label="友だちによるキャンセル">
          <Radio checked={r.approval.cancel === 'allow'} onChange={() => patch({ approval: { ...r.approval, cancel: 'allow' } })} label="許可する" />
          <Radio checked={r.approval.cancel === 'deny'} onChange={() => patch({ approval: { ...r.approval, cancel: 'deny' } })} label="許可しない" />
          <Radio checked={r.approval.cancel === 'request'} onChange={() => patch({ approval: { ...r.approval, cancel: 'request' } })} label="リクエスト制" />
        </Row>
      </Block>

      <SaveBar busy={busy} message={message} onSave={() => void save({ ...r, totalCapacity: capOn ? r.totalCapacity ?? 1 : null })} />
    </div>
  )
}
