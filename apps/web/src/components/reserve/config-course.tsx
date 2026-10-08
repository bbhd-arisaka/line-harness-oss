'use client'

import { useMemo, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { AdvancedSearchDialog } from '@/components/friends/advanced-search-dialog'
import { useActionLookups } from '@/components/friend-add/use-action-lookups'
import { errorText } from '@/lib/error-text'
import { describeFilter, emptyFilter, isFilterEmpty } from '@/lib/friend-filter'
import type { FriendFilter } from '@/lib/friend-filter'
import { reserveApi } from '@/lib/reserve'
import type { CalendarBundle, CourseSettings, ReserveCourse, ReserveSlot, SlotSettings } from '@/lib/reserve'
import { Block, PageTitle, Radio, Row, inputCls, pinkBtn, smallInput, useSectionSave } from './config-common'

/** 友だち予約可能条件(友だち絞り込み)の入力 */
function ConditionField({ value, onChange, accountId }: { value: FriendFilter | null; onChange: (v: FriendFilter | null) => void; accountId: string }) {
  const lookups = useActionLookups(accountId)
  const [open, setOpen] = useState(false)
  const ctx = useMemo(() => ({ tags: lookups.tags, fields: lookups.fields, scenarios: lookups.scenarios, forms: lookups.forms }), [lookups])
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50" onClick={() => setOpen(true)}>絞り込み</button>
        {value ? <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onChange(null)}>条件を外す</button> : null}
      </div>
      <p className="mt-1 text-xs text-gray-600">{value ? describeFilter(value, ctx) || '(条件なし)' : '絞り込みなし(全員に表示)'}</p>
      {open ? (
        <AdvancedSearchDialog
          open
          onClose={() => setOpen(false)}
          accountId={accountId}
          initial={value ?? emptyFilter()}
          initialSort="recent"
          initialPageSize={50}
          title="友だち予約可能条件を設定"
          conditionOnly
          onApply={(f) => {
            onChange(isFilterEmpty(f) ? null : f)
            setOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function ModalShell({ title, children, onClose, onSave, busy, error, saveLabel }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void; busy: boolean; error: string; saveLabel: string }) {
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="lg" className="p-0 !w-[min(720px,95vw)] !max-w-none">
        <div className="border-b border-gray-200 px-5 py-3 text-base font-semibold">{title}</div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4 text-sm">
          {children}
          {error ? <p className="text-red-600">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button type="button" className="rounded border border-gray-300 px-4 py-2 text-sm" onClick={onClose}>キャンセル</button>
          <button type="button" className="rounded bg-[#e8355d] px-5 py-2 text-sm font-medium text-white hover:bg-[#d02850] disabled:opacity-60" disabled={busy} onClick={onSave}>{busy ? '保存中…' : saveLabel}</button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

function DescriptionField({ value, html, onChange }: { value: string; html: boolean; onChange: (v: string, html: boolean) => void }) {
  return (
    <div>
      <textarea className={inputCls} rows={5} value={value} onChange={(e) => onChange(e.target.value, html)} />
      <label className="mt-1 inline-flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={html} onChange={(e) => onChange(value, e.target.checked)} /> HTMLモード(HTMLタグで、レイアウトをカスタマイズできます)
      </label>
    </div>
  )
}

function SlotEditor({ bundle, slot, onClose, onSaved }: { bundle: CalendarBundle; slot: ReserveSlot | null; onClose: () => void; onSaved: () => void }) {
  const { calendar } = bundle
  const [name, setName] = useState(slot?.name ?? '')
  const [useDefault, setUseDefault] = useState(slot ? slot.capacity === null : true)
  const [capacity, setCapacity] = useState(slot?.capacity ?? calendar.slotSettings.defaultCapacity ?? 1)
  const [price, setPrice] = useState(slot?.price ?? 0)
  const [autoAssign, setAutoAssign] = useState(slot?.autoAssign ?? false)
  const [priority, setPriority] = useState(slot?.priority ?? 1)
  const [desc, setDesc] = useState(slot?.description ?? '')
  const [html, setHtml] = useState(slot?.descriptionHtml ?? false)
  const [condition, setCondition] = useState<FriendFilter | null>(slot?.condition ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = { name, capacity: useDefault ? null : capacity, price, autoAssign, priority, description: desc, descriptionHtml: html, condition }
      const res = slot ? await reserveApi.updateSlot(slot.id, body) : await reserveApi.createSlot(calendar.id, body)
      if (!res.success) throw new Error(res.error)
      onSaved()
    } catch (err) {
      setError(errorText(err, '保存できませんでした'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <ModalShell title={slot ? `${calendar.slotSettings.title}の編集` : `${calendar.slotSettings.title}を追加`} onClose={onClose} onSave={() => void save()} busy={busy} error={error} saveLabel={slot ? '更新する' : '登録する'}>
      <Row label="名前"><input className={inputCls} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="同時予約可能数" note="予約枠ごとに、同じ時間帯に何件まで予約を許可するかです。">
        <label className="mr-4 inline-flex items-center gap-1.5"><input type="checkbox" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} /> デフォルトを使う</label>
        {!useDefault ? <input type="number" min={1} className={`${smallInput} w-24`} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /> : null}
      </Row>
      {calendar.slotSettings.priceEnabled ? <Row label="料金"><input type="number" min={0} className={`${smallInput} w-32`} value={price} onChange={(e) => setPrice(Number(e.target.value))} /> 円</Row> : null}
      {!calendar.slotSettings.required && calendar.slotSettings.autoAssign ? (
        <Row label="自動振り分け" note="数字が小さいほど優先度が高く、予約枠を選ばない予約が入ったとき、優先して割り振られます。同じ優先度なら、一覧の上の予約枠からです。">
          <Radio checked={autoAssign} onChange={() => setAutoAssign(true)} label="対象にする" />
          <Radio checked={!autoAssign} onChange={() => setAutoAssign(false)} label="対象にしない" />
          {autoAssign ? <span className="ml-2">優先度 <input type="number" min={1} className={`${smallInput} w-20`} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></span> : null}
        </Row>
      ) : null}
      <Row label="説明文"><DescriptionField value={desc} html={html} onChange={(v, h) => { setDesc(v); setHtml(h) }} /></Row>
      <Row label="友だち予約可能条件" note="条件を満たす友だちにだけ、この予約枠を表示します。管理画面から予約するときは、条件に関係なく選べます。"><ConditionField accountId={calendar.lineAccountId} value={condition} onChange={setCondition} /></Row>
    </ModalShell>
  )
}

function CourseEditor({ bundle, course, onClose, onSaved }: { bundle: CalendarBundle; course: ReserveCourse | null; onClose: () => void; onSaved: () => void }) {
  const { calendar } = bundle
  const [name, setName] = useState(course?.name ?? '')
  const [color, setColor] = useState(course?.color ?? '#3b82f6')
  const [duration, setDuration] = useState(course?.durationMinutes ?? 30)
  const [showOn, setShowOn] = useState(course?.displayMinutes != null)
  const [display, setDisplay] = useState(course?.displayMinutes ?? course?.durationMinutes ?? 30)
  const [price, setPrice] = useState(course?.price ?? 0)
  const [desc, setDesc] = useState(course?.description ?? '')
  const [html, setHtml] = useState(course?.descriptionHtml ?? false)
  const [condition, setCondition] = useState<FriendFilter | null>(course?.condition ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = { name, color, durationMinutes: duration, displayMinutes: showOn ? display : null, price, description: desc, descriptionHtml: html, condition }
      const res = course ? await reserveApi.updateCourse(course.id, body) : await reserveApi.createCourse(calendar.id, body)
      if (!res.success) throw new Error(res.error)
      onSaved()
    } catch (err) {
      setError(errorText(err, '保存できませんでした'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <ModalShell title={course ? `${calendar.courseSettings.title}の編集` : `${calendar.courseSettings.title}を追加`} onClose={onClose} onSave={() => void save()} busy={busy} error={error} saveLabel={course ? '更新する' : 'コースを登録する'}>
      <Row label="コース名"><input className={inputCls} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="カラー" note="予約一覧に表示される色です。"><input type="color" aria-label="カラー" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 rounded border border-gray-300" /></Row>
      <Row label="所要時間" note="予約一覧など、システム上で確保される時間です。"><input type="number" min={5} className={`${smallInput} w-24`} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /> 分</Row>
      <Row label="表示時間" note="友だちの予約画面に表示する時間です。入れないときは、所要時間と同じ時間を表示します。">
        <label className="mr-3 inline-flex items-center gap-1.5"><input type="checkbox" checked={showOn} onChange={(e) => setShowOn(e.target.checked)} /> 設定する</label>
        {showOn ? <><input type="number" min={1} className={`${smallInput} w-24`} value={display} onChange={(e) => setDisplay(Number(e.target.value))} /> 分</> : null}
      </Row>
      {calendar.courseSettings.priceEnabled ? <Row label="コース料金"><input type="number" min={0} className={`${smallInput} w-32`} value={price} onChange={(e) => setPrice(Number(e.target.value))} /> 円</Row> : null}
      <Row label="説明文"><DescriptionField value={desc} html={html} onChange={(v, h) => { setDesc(v); setHtml(h) }} /></Row>
      <Row label="友だち予約可能条件" note="条件を満たす友だちにだけ、このコースを表示します。"><ConditionField accountId={calendar.lineAccountId} value={condition} onChange={setCondition} /></Row>
    </ModalShell>
  )
}

function ItemRow({ name, visible, sub, color, onVisible, onEdit, onCopy, onDelete, onUp, onDown }: { name: string; visible: boolean; sub?: string; color?: string; onVisible: (v: boolean) => void; onEdit: () => void; onCopy: () => void; onDelete: () => void; onUp?: () => void; onDown?: () => void }) {
  const ic = 'rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30'
  return (
    <div className="flex items-center gap-3 border-b border-gray-200 py-2.5">
      {color ? <span className="h-3 w-3 rounded-full" style={{ background: color }} /> : <span className="h-7 w-7 rounded-full bg-gray-700 text-center text-xs leading-7 text-white">{name.charAt(0)}</span>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        {sub ? <div className="text-xs text-gray-500">{sub}</div> : null}
      </div>
      <select className={smallInput} aria-label="表示" value={visible ? '1' : '0'} onChange={(e) => onVisible(e.target.value === '1')}><option value="1">表示する</option><option value="0">非表示</option></select>
      <button type="button" aria-label="編集" className={ic} onClick={onEdit}><PencilSimpleIcon size={16} /></button>
      <button type="button" aria-label="複製" className={ic} onClick={onCopy}><CopyIcon size={16} /></button>
      <button type="button" aria-label="削除" className={ic} onClick={onDelete}><TrashIcon size={16} /></button>
      <button type="button" aria-label="上へ" className={ic} disabled={!onUp} onClick={onUp}><ArrowUpIcon size={16} /></button>
      <button type="button" aria-label="下へ" className={ic} disabled={!onDown} onClick={onDown}><ArrowDownIcon size={16} /></button>
    </div>
  )
}

/** 予約設定 > 予約枠 / コース(予約枠・コース・紐づけ) */
export default function CourseConfig({ bundle, reload }: { bundle: CalendarBundle; reload: () => void }) {
  const { calendar, slots, courses, links } = bundle
  const [ss, setSs] = useState<SlotSettings>(calendar.slotSettings)
  const [capOn, setCapOn] = useState(calendar.slotSettings.defaultCapacity !== null)
  const [cs, setCs] = useState<CourseSettings>(calendar.courseSettings)
  const slotSave = useSectionSave(calendar.id, 'slotSettings', reload)
  const courseSave = useSectionSave(calendar.id, 'courseSettings', reload)
  const [slotEditor, setSlotEditor] = useState<{ slot: ReserveSlot | null } | null>(null)
  const [courseEditor, setCourseEditor] = useState<{ course: ReserveCourse | null } | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set(links.map((l) => `${l.slotId}:${l.courseId}`)))
  const [linkMsg, setLinkMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setError('')
    try {
      const res = await fn()
      if (!res.success) throw new Error(res.error)
      reload()
    } catch (err) {
      setError(errorText(err, '操作できませんでした'))
    }
  }

  const move = (list: Array<{ id: string }>, i: number, dir: -1 | 1, order: (ids: string[]) => Promise<{ success: boolean; error?: string }>) => {
    const ids = list.map((x) => x.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void run(() => order(ids))
  }

  const saveLinks = async () => {
    setLinkMsg(null)
    try {
      const pairs = [...checked].map((k) => {
        const [slotId, courseId] = k.split(':')
        return { slotId, courseId }
      })
      const res = await reserveApi.saveLinks(calendar.id, pairs)
      if (!res.success) throw new Error(res.error)
      setLinkMsg({ ok: true, text: '保存しました' })
      reload()
    } catch (err) {
      setLinkMsg({ ok: false, text: errorText(err, '保存できませんでした') })
    }
  }

  return (
    <div>
      <PageTitle>予約枠 / コース設定</PageTitle>
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <Block title={calendar.slotSettings.title} id="slots" hint="担当者・会議室など、友だちが予約するときに指定する項目です。予約枠ごとに、シフトで受付時間を変えたり、同時に予約できる人数を設定できます。">
        <Row label="予約枠タイトル"><input className={`${smallInput} w-64`} value={ss.title} maxLength={50} onChange={(e) => setSs({ ...ss, title: e.target.value })} /></Row>
        <Row label="予約時の選択設定" note="必須にすると、友だちが予約枠を選ぶまで、予約日程が表示されません。">
          <Radio checked={ss.required} onChange={() => setSs({ ...ss, required: true, autoAssign: false })} label="必須" />
          <Radio checked={!ss.required} onChange={() => setSs({ ...ss, required: false })} label="任意" />
        </Row>
        {!ss.required ? (
          <Row label="予約枠未選択時の自動振り分け設定" note="有効にするには、予約受付 > 承認 の「新規予約」を全承認にしてください。予約枠が1つ以上必要です。">
            <Radio checked={ss.autoAssign} onChange={() => setSs({ ...ss, autoAssign: true })} label="有効にする" />
            <Radio checked={!ss.autoAssign} onChange={() => setSs({ ...ss, autoAssign: false })} label="無効にする" />
          </Row>
        ) : null}
        <Row label="利用料金設定">
          <Radio checked={ss.priceEnabled} onChange={() => setSs({ ...ss, priceEnabled: true })} label="使用する" />
          <Radio checked={!ss.priceEnabled} onChange={() => setSs({ ...ss, priceEnabled: false })} label="使用しない" />
        </Row>
        <Row label="同時予約可能数(デフォルト)" note="予約枠未選択時には適用されません。">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={capOn} onChange={(e) => { setCapOn(e.target.checked); setSs({ ...ss, defaultCapacity: e.target.checked ? ss.defaultCapacity ?? 1 : null }) }} /> 設定する</label>
          {capOn ? <input type="number" min={1} className={`${smallInput} ml-3 w-24`} value={ss.defaultCapacity ?? 1} onChange={(e) => setSs({ ...ss, defaultCapacity: Number(e.target.value) })} /> : null}
        </Row>
        <Row label="シフト連動" note="利用すると、シフトが入っている時間帯だけが予約できます(シフトが無い時間は受け付けません)。">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={ss.shiftLinked} onChange={(e) => setSs({ ...ss, shiftLinked: e.target.checked })} /> 利用する</label>
        </Row>
        <div className="py-4 text-center">
          <button type="button" className={pinkBtn} disabled={slotSave.busy} onClick={() => void slotSave.save({ ...ss, defaultCapacity: capOn ? ss.defaultCapacity ?? 1 : null })}>予約枠設定を保存</button>
          {slotSave.message ? <p className={`mt-2 text-sm ${slotSave.message.ok ? 'text-green-700' : 'text-red-600'}`}>{slotSave.message.text}</p> : null}
        </div>
        <div className="py-2">
          {slots.map((s, i) => (
            <ItemRow
              key={s.id}
              name={s.name}
              visible={s.visible}
              sub={`同時予約可能数 ${s.capacity ?? (calendar.slotSettings.defaultCapacity ?? '無制限')}${s.autoAssign ? ` / 自動振り分け(優先度${s.priority})` : ''}`}
              onVisible={(v) => void run(() => reserveApi.updateSlot(s.id, { visible: v }))}
              onEdit={() => setSlotEditor({ slot: s })}
              onCopy={() => void run(() => reserveApi.duplicateSlot(s.id))}
              onDelete={() => { if (window.confirm(`「${s.name}」を削除しますか?この予約枠の予約は、予約枠なしになります。`)) void run(() => reserveApi.deleteSlot(s.id)) }}
              onUp={i > 0 ? () => move(slots, i, -1, (ids) => reserveApi.orderSlots(calendar.id, ids)) : undefined}
              onDown={i < slots.length - 1 ? () => move(slots, i, 1, (ids) => reserveApi.orderSlots(calendar.id, ids)) : undefined}
            />
          ))}
          <button type="button" className="mt-3 inline-flex w-full items-center justify-center gap-1 py-2 text-sm text-[#e8355d]" onClick={() => setSlotEditor({ slot: null })}><PlusIcon size={14} weight="bold" /> 予約枠を追加する</button>
        </div>
      </Block>

      <Block title={calendar.courseSettings.title} id="courses" hint="友だちが予約するときに選ぶ、メニュー・所要時間などです。">
        <Row label="コースタイトル"><input className={`${smallInput} w-64`} value={cs.title} maxLength={50} onChange={(e) => setCs({ ...cs, title: e.target.value })} /></Row>
        <Row label="予約時の選択設定">
          <Radio checked={cs.required} onChange={() => setCs({ ...cs, required: true })} label="必須" />
          <Radio checked={!cs.required} onChange={() => setCs({ ...cs, required: false })} label="任意" />
        </Row>
        <Row label="利用料金設定">
          <Radio checked={cs.priceEnabled} onChange={() => setCs({ ...cs, priceEnabled: true })} label="使用する" />
          <Radio checked={!cs.priceEnabled} onChange={() => setCs({ ...cs, priceEnabled: false })} label="使用しない" />
        </Row>
        <Row label="コース時間表示"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={cs.showDuration} onChange={(e) => setCs({ ...cs, showDuration: e.target.checked })} /> 表示する</label></Row>
        {!cs.required ? <Row label="コース未指定時の所要時間" note="コースを選ばずに予約したときに、確保する時間です。"><input type="number" min={5} className={`${smallInput} w-24`} value={cs.unspecifiedMinutes} onChange={(e) => setCs({ ...cs, unspecifiedMinutes: Number(e.target.value) })} /> 分</Row> : null}
        <div className="py-4 text-center">
          <button type="button" className={pinkBtn} disabled={courseSave.busy} onClick={() => void courseSave.save(cs)}>コース設定を保存</button>
          {courseSave.message ? <p className={`mt-2 text-sm ${courseSave.message.ok ? 'text-green-700' : 'text-red-600'}`}>{courseSave.message.text}</p> : null}
        </div>
        <div className="py-2">
          {courses.map((c, i) => (
            <ItemRow
              key={c.id}
              name={c.name}
              color={c.color}
              visible={c.visible}
              sub={`${c.displayMinutes ?? c.durationMinutes}分 / ${c.durationMinutes}分${calendar.courseSettings.priceEnabled ? ` / ${c.price.toLocaleString('ja-JP')}円` : ''}`}
              onVisible={(v) => void run(() => reserveApi.updateCourse(c.id, { visible: v }))}
              onEdit={() => setCourseEditor({ course: c })}
              onCopy={() => void run(() => reserveApi.duplicateCourse(c.id))}
              onDelete={() => { if (window.confirm(`「${c.name}」を削除しますか?`)) void run(() => reserveApi.deleteCourse(c.id)) }}
              onUp={i > 0 ? () => move(courses, i, -1, (ids) => reserveApi.orderCourses(calendar.id, ids)) : undefined}
              onDown={i < courses.length - 1 ? () => move(courses, i, 1, (ids) => reserveApi.orderCourses(calendar.id, ids)) : undefined}
            />
          ))}
          <button type="button" className="mt-3 inline-flex w-full items-center justify-center gap-1 py-2 text-sm text-[#e8355d]" onClick={() => setCourseEditor({ course: null })}><PlusIcon size={14} weight="bold" /> コースを追加する</button>
        </div>
      </Block>

      <Block title="予約枠とコースの紐づけ" id="links" hint="チェックが外れている組み合わせは、予約画面に出ません(予約できません)。">
        {slots.length === 0 || courses.length === 0 ? (
          <p className="py-4 text-sm text-gray-500">予約枠とコースを作ると、ここで紐づけられます。</p>
        ) : (
          <div className="overflow-x-auto py-3">
            <table className="text-sm">
              <thead>
                <tr><th className="px-3 py-2" />{slots.map((s) => <th key={s.id} className="px-3 py-2 font-medium">{s.name}</th>)}</tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id} className="border-t border-gray-200">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    {slots.map((s) => {
                      const key = `${s.id}:${c.id}`
                      return (
                        <td key={s.id} className="px-3 py-2 text-center">
                          <input type="checkbox" aria-label={`${c.name}と${s.name}`} checked={checked.has(key)} onChange={(e) => { const n = new Set(checked); if (e.target.checked) n.add(key); else n.delete(key); setChecked(n) }} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 text-center">
              <button type="button" className={pinkBtn} onClick={() => void saveLinks()}>予約枠とコースの紐づけ設定を保存</button>
              {linkMsg ? <p className={`mt-2 text-sm ${linkMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{linkMsg.text}</p> : null}
            </div>
          </div>
        )}
      </Block>

      {slotEditor ? <SlotEditor bundle={bundle} slot={slotEditor.slot} onClose={() => setSlotEditor(null)} onSaved={() => { setSlotEditor(null); reload() }} /> : null}
      {courseEditor ? <CourseEditor bundle={bundle} course={courseEditor.course} onClose={() => setCourseEditor(null)} onSaved={() => { setCourseEditor(null); reload() }} /> : null}
    </div>
  )
}
