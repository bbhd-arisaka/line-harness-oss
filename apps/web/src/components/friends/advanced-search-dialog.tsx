'use client'

import { useEffect, useMemo, useState } from 'react'
import { TrashIcon, XIcon, PlusIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'
import { api, fetchApi } from '@/lib/api'
import { reserveApi } from '@/lib/reserve'
import {
  CHAT_STATUS_LABEL,
  FIELD_OP_LABEL,
  MEMO_OP_LABEL,
  RESERVE_STATE_LABEL,
  SCENARIO_STATE_LABEL,
  TAG_MODE_LABEL,
  cleanFilter,
  emptyFilter,
  type ChatStatusValue,
  type DescribeContext,
  type FieldOp,
  type FriendCondition,
  type FriendFilter,
  type MemoOp,
  type NameTarget,
  type ReserveState,
  type ScenarioState,
  type TagMode,
} from '@/lib/friend-filter'

// Lステップの友だちリスト「詳細検索」(絞り込み条件を設定)を模倣したモーダル。
// 「すべて満たす」条件(and)と、「いずれか1つ以上を満たす」条件(or)のグループを組み合わせて検索する。

type Draft = FriendCondition & { uid: number }
type OrGroup = { uid: number; items: Draft[] }

export type SortMode = 'recent' | 'oldest'

export interface FieldDef {
  fieldKey: string
  label: string
  fieldType: string
  options: string[]
}

const ADD_CHIPS: Array<{ type: FriendCondition['type']; label: string }> = [
  { type: 'name', label: '名前' },
  { type: 'memo', label: '個別メモ' },
  { type: 'statusMessage', label: 'ステータスメッセージ' },
  { type: 'addedDate', label: '友だち登録日' },
  { type: 'chatStatus', label: '対応マーク' },
  { type: 'tag', label: 'タグ' },
  { type: 'field', label: '友だち情報' },
  { type: 'scenario', label: 'シナリオ' },
  { type: 'form', label: '回答フォーム' },
  { type: 'lastReaction', label: '最終反応日' },
  { type: 'inflow', label: '流入経路' },
  { type: 'reserve', label: 'カレンダー予約' },
]

const TYPE_LABEL: Record<FriendCondition['type'], string> = Object.fromEntries(ADD_CHIPS.map((c) => [c.type, c.label])) as Record<FriendCondition['type'], string>

let seq = 1
const nextUid = () => seq++

function newCondition(type: FriendCondition['type']): FriendCondition {
  switch (type) {
    case 'name': return { type, value: '', targets: ['display', 'real', 'system'] }
    case 'memo': return { type, op: 'contains', value: '' }
    case 'statusMessage': return { type, value: '' }
    case 'addedDate': return { type, from: null, to: null }
    case 'chatStatus': return { type, statuses: [] }
    case 'tag': return { type, tagIds: [], mode: 'any' }
    case 'field': return { type, fieldKey: '', op: 'contains', value: '' }
    case 'scenario': return { type, scenarioId: '', state: 'active' }
    case 'form': return { type, formId: '', answered: true }
    case 'lastReaction': return { type, from: null, to: null }
    case 'inflow': return { type, value: '' }
    case 'reserve': return { type, calendarId: '', state: 'booked', slotId: null, courseId: null }
  }
}

const draft = (c: FriendCondition): Draft => ({ ...c, uid: nextUid() })
const strip = (d: Draft): FriendCondition => {
  const { uid: _uid, ...rest } = d
  void _uid
  return rest as FriendCondition
}

function toItems<T extends string>(labels: Record<T, string>): Array<{ value: T; label: string }> {
  return (Object.keys(labels) as T[]).map((k) => ({ value: k, label: labels[k] }))
}

interface Ctx extends DescribeContext {
  fields: FieldDef[]
}

function ConditionRow({
  cond,
  ctx,
  onChange,
  onRemove,
}: {
  cond: Draft
  ctx: Ctx
  onChange: (next: Draft) => void
  onRemove: () => void
}) {
  const set = (patch: Partial<FriendCondition>) => onChange({ ...cond, ...patch } as Draft)

  let body: React.ReactNode = null
  if (cond.type === 'name') {
    const toggle = (t: NameTarget, on: boolean) => set({ targets: on ? [...cond.targets, t] : cond.targets.filter((x) => x !== t) } as Partial<FriendCondition>)
    body = (
      <div className="space-y-2">
        <Input aria-label="名前" value={cond.value} onValueChange={(v) => set({ value: v } as Partial<FriendCondition>)} />
        <p className="text-xs text-kumo-subtle">半角スペースで区切るといずれかにあてはまる友だちを絞り込めます</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Checkbox label="LINE登録名" checked={cond.targets.includes('display')} onCheckedChange={(v) => toggle('display', v)} />
          <Checkbox label="本名" checked={cond.targets.includes('real')} onCheckedChange={(v) => toggle('real', v)} />
          <Checkbox label="システム表示名" checked={cond.targets.includes('system')} onCheckedChange={(v) => toggle('system', v)} />
          <span className="text-xs text-kumo-subtle">から検索</span>
        </div>
      </div>
    )
  } else if (cond.type === 'memo') {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="個別メモの条件" value={cond.op} onValueChange={(v) => set({ op: (v ?? 'contains') as MemoOp } as Partial<FriendCondition>)} items={toItems(MEMO_OP_LABEL)} />
        {cond.op === 'contains' || cond.op === 'not_contains' ? (
          <Input aria-label="個別メモ" className="min-w-0 flex-1" value={cond.value} onValueChange={(v) => set({ value: v } as Partial<FriendCondition>)} />
        ) : null}
      </div>
    )
  } else if (cond.type === 'statusMessage') {
    body = <Input aria-label="ステータスメッセージ" value={cond.value} onValueChange={(v) => set({ value: v } as Partial<FriendCondition>)} />
  } else if (cond.type === 'addedDate' || cond.type === 'lastReaction') {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="開始日" type="date" value={cond.from ?? ''} onChange={(e) => set({ from: e.target.value || null } as Partial<FriendCondition>)} />
        <span className="text-sm text-kumo-subtle">〜</span>
        <Input aria-label="終了日" type="date" value={cond.to ?? ''} onChange={(e) => set({ to: e.target.value || null } as Partial<FriendCondition>)} />
      </div>
    )
  } else if (cond.type === 'chatStatus') {
    body = (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(Object.keys(CHAT_STATUS_LABEL) as ChatStatusValue[]).map((s) => (
          <Checkbox
            key={s}
            label={CHAT_STATUS_LABEL[s]}
            checked={cond.statuses.includes(s)}
            onCheckedChange={(v) => set({ statuses: v ? [...cond.statuses, s] : cond.statuses.filter((x) => x !== s) } as Partial<FriendCondition>)}
          />
        ))}
      </div>
    )
  } else if (cond.type === 'tag') {
    const available = ctx.tags.filter((t) => !cond.tagIds.includes(t.id))
    body = (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {cond.tagIds.map((id) => (
            <Button key={id} type="button" size="xs" variant="secondary" icon={XIcon} onClick={() => set({ tagIds: cond.tagIds.filter((x) => x !== id) } as Partial<FriendCondition>)}>
              {ctx.tags.find((t) => t.id === id)?.name ?? '(削除されたタグ)'}
            </Button>
          ))}
        </div>
        <Select
          aria-label="タグを追加"
          placeholder="タグ名を選んで追加"
          value=""
          onValueChange={(v) => { if (v) set({ tagIds: [...cond.tagIds, v] } as Partial<FriendCondition>) }}
          items={available.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Select aria-label="タグの条件" value={cond.mode} onValueChange={(v) => set({ mode: (v ?? 'any') as TagMode } as Partial<FriendCondition>)} items={toItems(TAG_MODE_LABEL)} />
      </div>
    )
  } else if (cond.type === 'field') {
    const def = ctx.fields.find((f) => f.fieldKey === cond.fieldKey)
    const hasOptions = !!def && ['select', 'radio', 'checkbox'].includes(def.fieldType) && def.options.length > 0
    const needsValue = cond.op !== 'exists' && cond.op !== 'missing'
    body = (
      <div className="space-y-2">
        <Select
          aria-label="友だち情報欄"
          placeholder="友だち情報欄を選ぶ"
          value={cond.fieldKey}
          onValueChange={(v) => set({ fieldKey: v ?? '', value: '' } as Partial<FriendCondition>)}
          items={ctx.fields.map((f) => ({ value: f.fieldKey, label: f.label }))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="比較" value={cond.op} onValueChange={(v) => set({ op: (v ?? 'contains') as FieldOp } as Partial<FriendCondition>)} items={toItems(FIELD_OP_LABEL)} />
          {needsValue ? (
            hasOptions && (cond.op === 'eq' || cond.op === 'neq') ? (
              <Select aria-label="値" placeholder="値を選ぶ" value={cond.value} onValueChange={(v) => set({ value: v ?? '' } as Partial<FriendCondition>)} items={def!.options.map((o) => ({ value: o, label: o }))} />
            ) : (
              <Input
                aria-label="値"
                className="min-w-0 flex-1"
                type={def?.fieldType === 'date' ? 'date' : 'text'}
                value={cond.value}
                onValueChange={(v) => set({ value: v } as Partial<FriendCondition>)}
              />
            )
          ) : null}
        </div>
      </div>
    )
  } else if (cond.type === 'scenario') {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="シナリオ" placeholder="シナリオを選ぶ" value={cond.scenarioId} onValueChange={(v) => set({ scenarioId: v ?? '' } as Partial<FriendCondition>)} items={ctx.scenarios.map((s) => ({ value: s.id, label: s.name }))} />
        <Select aria-label="シナリオの状態" value={cond.state} onValueChange={(v) => set({ state: (v ?? 'active') as ScenarioState } as Partial<FriendCondition>)} items={toItems(SCENARIO_STATE_LABEL)} />
      </div>
    )
  } else if (cond.type === 'form') {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="回答フォーム" placeholder="フォームを選ぶ" value={cond.formId} onValueChange={(v) => set({ formId: v ?? '' } as Partial<FriendCondition>)} items={ctx.forms.map((f) => ({ value: f.id, label: f.name }))} />
        <Select
          aria-label="回答の有無"
          value={cond.answered ? 'yes' : 'no'}
          onValueChange={(v) => set({ answered: v !== 'no' } as Partial<FriendCondition>)}
          items={[{ value: 'yes', label: '回答した人' }, { value: 'no', label: '回答していない人' }]}
        />
      </div>
    )
  } else if (cond.type === 'reserve') {
    const cal = ctx.reserves?.find((x) => x.id === cond.calendarId)
    body = (
      <div className="space-y-2">
        <Select aria-label="カレンダー" placeholder="カレンダーを選ぶ" value={cond.calendarId} onValueChange={(v) => set({ calendarId: v ?? '', slotId: null, courseId: null } as Partial<FriendCondition>)} items={(ctx.reserves ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <Select aria-label="予約の状態" value={cond.state} onValueChange={(v) => set({ state: (v ?? 'booked') as ReserveState } as Partial<FriendCondition>)} items={toItems(RESERVE_STATE_LABEL)} />
        {cal && cal.slots.length > 0 ? <Select aria-label="予約枠" placeholder="予約枠を問わない" value={cond.slotId ?? ''} onValueChange={(v) => set({ slotId: v || null } as Partial<FriendCondition>)} items={[{ value: '', label: '予約枠を問わない' }, ...cal.slots.map((s) => ({ value: s.id, label: s.name }))]} /> : null}
        {cal && cal.courses.length > 0 ? <Select aria-label="コース" placeholder="コースを問わない" value={cond.courseId ?? ''} onValueChange={(v) => set({ courseId: v || null } as Partial<FriendCondition>)} items={[{ value: '', label: 'コースを問わない' }, ...cal.courses.map((s) => ({ value: s.id, label: s.name }))]} /> : null}
      </div>
    )
  } else if (cond.type === 'inflow') {
    body = <Input aria-label="流入経路" placeholder="流入経路名・コード" value={cond.value} onValueChange={(v) => set({ value: v } as Partial<FriendCondition>)} />
  }

  return (
    <div className="grid gap-2 border-b border-kumo-line px-4 py-3 sm:grid-cols-[150px_1fr]">
      <div className="flex items-start gap-2">
        <Button type="button" size="xs" shape="square" variant="secondary" icon={TrashIcon} aria-label={`${TYPE_LABEL[cond.type]}の条件を削除`} onClick={onRemove} />
        <span className="pt-0.5 text-sm font-semibold text-kumo-strong">{TYPE_LABEL[cond.type]}</span>
      </div>
      <div className="min-w-0">{body}</div>
    </div>
  )
}

function AddChips({ onAdd }: { onAdd: (type: FriendCondition['type']) => void }) {
  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-center text-xs text-kumo-subtle">絞り込む項目を更に追加できます</p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {ADD_CHIPS.map((c) => (
          <Button key={c.type} type="button" size="xs" variant="secondary" onClick={() => onAdd(c.type)}>
            {c.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function AdvancedSearchDialog({
  open,
  onClose,
  accountId,
  initial,
  initialSort,
  initialPageSize,
  onApply,
  title = '絞り込み条件を設定',
  conditionOnly = false,
}: {
  open: boolean
  onClose: () => void
  accountId: string | null
  initial: FriendFilter
  initialSort: SortMode
  initialPageSize: number
  onApply: (filter: FriendFilter, sort: SortMode, pageSize: number, ctx: DescribeContext) => void
  /** 見出し。既定は「絞り込み条件を設定」 */
  title?: string
  /** 条件だけを決める画面にする(友だちの表示設定・並び替え・表示数を出さない。アクションの条件ONなどで使う) */
  conditionOnly?: boolean
}) {
  const [andItems, setAndItems] = useState<Draft[]>([])
  const [orGroups, setOrGroups] = useState<OrGroup[]>([])
  const [showFollowing, setShowFollowing] = useState(true)
  const [showBlocked, setShowBlocked] = useState(false)
  const [sort, setSort] = useState<SortMode>('recent')
  const [pageSize, setPageSize] = useState(50)
  const [tags, setTags] = useState<Ctx['tags']>([])
  const [fields, setFields] = useState<FieldDef[]>([])
  const [scenarios, setScenarios] = useState<Ctx['scenarios']>([])
  const [forms, setForms] = useState<Ctx['forms']>([])
  const [reserves, setReserves] = useState<NonNullable<Ctx['reserves']>>([])
  const [error, setError] = useState('')

  // 開くたびに、いまの条件から作り直す(条件が無いときは、Lステップと同じく 名前・タグ・友だち情報 の行から始める)
  useEffect(() => {
    if (!open) return
    const f = initial
    const hasAny = f.and.length > 0 || f.or.length > 0
    setAndItems(hasAny ? f.and.map(draft) : [draft(newCondition('name')), draft(newCondition('tag')), draft(newCondition('field'))])
    setOrGroups(f.or.map((g) => ({ uid: nextUid(), items: g.map(draft) })))
    setShowFollowing(f.showFollowing)
    setShowBlocked(f.showBlocked)
    setSort(initialSort)
    setPageSize(initialPageSize)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 選べる候補(タグ・友だち情報欄・シナリオ・フォーム)は、開いたときに読み込む
  useEffect(() => {
    if (!open) return
    api.tags.list().then((r) => { if (r.success) setTags(r.data.map((t) => ({ id: t.id, name: t.name }))) }).catch(() => undefined)
    fetchApi<{ success: boolean; data: FieldDef[] }>('/api/friend-fields/definitions').then((r) => { if (r.success) setFields(r.data) }).catch(() => undefined)
    api.scenarios.list({ accountId: accountId ?? undefined }).then((r) => { if (r.success) setScenarios(r.data.map((s) => ({ id: s.id, name: s.name }))) }).catch(() => undefined)
    fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>('/api/forms').then((r) => { if (r.success) setForms(r.data.map((f) => ({ id: f.id, name: f.name }))) }).catch(() => undefined)
    if (accountId) {
      reserveApi.list(accountId).then(async (r) => {
        if (!r.success) return
        const bundles = await Promise.all(r.data.slice(0, 10).map((x) => reserveApi.get(x.id).catch(() => null)))
        setReserves(bundles.flatMap((b) => (b && b.success ? [{ id: b.data.calendar.id, name: b.data.calendar.name, slots: b.data.slots.map((s) => ({ id: s.id, name: s.name })), courses: b.data.courses.map((s) => ({ id: s.id, name: s.name })) }] : [])))
      }).catch(() => undefined)
    }
  }, [open, accountId])

  const ctx: Ctx = useMemo(() => ({ tags, fields, scenarios, forms, reserves }), [tags, fields, scenarios, forms, reserves])

  const apply = () => {
    if (!showFollowing && !showBlocked) {
      setError('表示設定を1つ以上選んでください(表示中・ブロックした人)')
      return
    }
    const next: FriendFilter = cleanFilter({
      and: andItems.map(strip),
      or: orGroups.map((g) => g.items.map(strip)),
      showFollowing,
      showBlocked,
    })
    onApply(next, sort, pageSize, ctx)
  }

  const reset = () => {
    const f = emptyFilter()
    setAndItems([draft(newCondition('name')), draft(newCondition('tag')), draft(newCondition('field'))])
    setOrGroups([])
    setShowFollowing(f.showFollowing)
    setShowBlocked(f.showBlocked)
  }

  const updateItem = (items: Draft[], uid: number, next: Draft) => items.map((i) => (i.uid === uid ? next : i))

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="lg" className="p-0">
        <div className="flex items-center justify-between border-b border-kumo-line px-5 py-3">
          <Dialog.Title className="text-base font-semibold text-kumo-strong">{title}</Dialog.Title>
          <Button type="button" size="xs" shape="square" variant="ghost" icon={XIcon} aria-label="閉じる" onClick={onClose} />
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          <div className="rounded-lg border border-kumo-line">
            <div className="border-b border-kumo-line bg-kumo-tint px-4 py-2 text-sm font-semibold text-kumo-strong">「すべて満たす」必要がある条件 (and条件)</div>
            {andItems.map((it) => (
              <ConditionRow
                key={it.uid}
                cond={it}
                ctx={ctx}
                onChange={(n) => setAndItems((items) => updateItem(items, it.uid, n))}
                onRemove={() => setAndItems((items) => items.filter((x) => x.uid !== it.uid))}
              />
            ))}
            <AddChips onAdd={(t) => setAndItems((items) => [...items, draft(newCondition(t))])} />
          </div>

          {orGroups.map((g, gi) => (
            <div key={g.uid} className="rounded-lg border border-kumo-line">
              <div className="flex items-center justify-between border-b border-kumo-line bg-kumo-tint px-4 py-2">
                <span className="text-sm font-semibold text-kumo-strong">「いずれか1つ以上を満たす」必要がある条件 (or条件 {gi + 1})</span>
                <Button type="button" size="xs" variant="secondary" icon={TrashIcon} onClick={() => setOrGroups((gs) => gs.filter((x) => x.uid !== g.uid))}>
                  このグループを削除
                </Button>
              </div>
              {g.items.map((it) => (
                <ConditionRow
                  key={it.uid}
                  cond={it}
                  ctx={ctx}
                  onChange={(n) => setOrGroups((gs) => gs.map((x) => (x.uid === g.uid ? { ...x, items: updateItem(x.items, it.uid, n) } : x)))}
                  onRemove={() => setOrGroups((gs) => gs.map((x) => (x.uid === g.uid ? { ...x, items: x.items.filter((i) => i.uid !== it.uid) } : x)))}
                />
              ))}
              <AddChips onAdd={(t) => setOrGroups((gs) => gs.map((x) => (x.uid === g.uid ? { ...x, items: [...x.items, draft(newCondition(t))] } : x)))} />
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            className="w-full"
            icon={PlusIcon}
            onClick={() => setOrGroups((gs) => [...gs, { uid: nextUid(), items: [draft(newCondition('tag'))] }])}
          >
            「いずれか1つ以上を満たす」必要がある条件(or条件)を追加
          </Button>

          {conditionOnly ? null : (
          <div className="grid gap-3 rounded-lg border border-kumo-line p-4 sm:grid-cols-[150px_1fr]">
            <span className="text-sm font-semibold text-kumo-strong">友だちの絞り込み</span>
            <div className="space-y-2">
              <p className="text-xs text-kumo-subtle">表示設定</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Checkbox label="表示中" checked={showFollowing} onCheckedChange={setShowFollowing} />
                <Checkbox label="ブロックした人" checked={showBlocked} onCheckedChange={setShowBlocked} />
              </div>
            </div>
          </div>

          )}

          {conditionOnly ? null : (
          <div className="grid gap-3 rounded-lg border border-kumo-line p-4 sm:grid-cols-[150px_1fr]">
            <span className="text-sm font-semibold text-kumo-strong">並び替え・表示数</span>
            <div className="flex flex-wrap gap-3">
              <Select
                label="表示順"
                value={sort}
                onValueChange={(v) => setSort((v ?? 'recent') as SortMode)}
                items={[{ value: 'recent', label: '友だち追加の新しい順' }, { value: 'oldest', label: '友だち追加の古い順' }]}
              />
              <Select
                label="表示数"
                value={String(pageSize)}
                onValueChange={(v) => setPageSize(Number(v ?? 50))}
                items={[20, 50, 100].map((n) => ({ value: String(n), label: `${n}人ずつ` }))}
              />
            </div>
          </div>
          )}

          {error ? <p className="text-sm text-kumo-danger" role="alert">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-kumo-line px-5 py-3">
          <Button type="button" variant="ghost" onClick={reset}>条件をクリア</Button>
          <Button type="button" variant="primary" onClick={apply}>決定する</Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
