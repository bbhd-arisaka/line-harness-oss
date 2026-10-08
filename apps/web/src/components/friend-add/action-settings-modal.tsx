'use client'

import { useMemo, useRef, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, DotsSixVerticalIcon, FunnelIcon, SmileyIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'
import { AdvancedSearchDialog } from '@/components/friends/advanced-search-dialog'
import { EmojiPicker } from '@/components/rich-menus/emoji-picker'
import { describeFilter, emptyFilter, isFilterEmpty } from '@/lib/friend-filter'
import type { DescribeContext } from '@/lib/friend-filter'
import {
  ACTION_BUTTONS,
  ACTION_TYPE_LABEL,
  describeAction,
  newAction,
} from '@/lib/friend-add-actions'
import type { ActionLookups, FriendAddActionItem, FriendAddTimingItem } from '@/lib/friend-add-actions'

const TEXT_LIMIT = 4500

export interface ModalLookups extends ActionLookups {
  forms: Array<{ id: string; name: string }>
  scenarios: Array<{ id: string; name: string }>
  /** カレンダー予約のアクションのとき: テキスト送信に、予約情報(予約者名・予約日時など)を差し込める。change=変更前の情報も選べる */
  reserve?: { change: boolean }
}

/** Lステップの「アクション設定」。上から順に実行する。決定すると、onSave に並びを返す。 */
export default function ActionSettingsModal({
  open,
  initial,
  lookups,
  accountId,
  onClose,
  onSave,
}: {
  open: boolean
  initial: FriendAddActionItem[]
  lookups: ModalLookups
  accountId: string
  onClose: () => void
  onSave: (actions: FriendAddActionItem[]) => void
}) {
  // 開くたびに、いまの設定から作り直す(外側の key で作り直される)
  const [items, setItems] = useState<FriendAddActionItem[]>(initial)
  const [active, setActive] = useState<number>(-1)
  const [conditionFor, setConditionFor] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)

  const describeCtx: DescribeContext = useMemo(
    () => ({ tags: lookups.tags, fields: lookups.fields, scenarios: lookups.scenarios, forms: lookups.forms }),
    [lookups],
  )

  const update = (i: number, next: FriendAddActionItem) => setItems((prev) => prev.map((a, j) => (j === i ? next : a)))
  const move = (from: number, to: number) =>
    setItems((prev) => {
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [x] = next.splice(from, 1)
      next.splice(to, 0, x)
      return next
    })

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="lg" className="p-0 !w-[min(920px,94vw)] !max-w-none">
        <div className="flex items-center justify-between border-b border-kumo-line px-5 py-3">
          <Dialog.Title className="text-base font-normal text-kumo-strong">アクション設定</Dialog.Title>
          <Button type="button" size="xs" shape="square" variant="ghost" icon={XIcon} aria-label="閉じる" onClick={onClose} />
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto bg-white p-4">
          {items.map((a, i) => (
            <div
              key={i}
              className="rounded border border-gray-300"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragFrom.current !== null) move(dragFrom.current, i)
                dragFrom.current = null
              }}
            >
              <div className={`flex items-center gap-2 border-b border-gray-300 px-2 py-1.5 ${active === i ? 'bg-yellow-100' : 'bg-gray-100'}`}>
                <span
                  draggable
                  onDragStart={() => { dragFrom.current = i }}
                  className="cursor-grab text-gray-400"
                  aria-label="ドラッグして並べ替え"
                  title="ドラッグして並べ替え"
                >
                  <DotsSixVerticalIcon size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                  {i + 1}. {ACTION_TYPE_LABEL[a.type]} <b className="ml-1">{describeAction(a, lookups)}</b>
                </span>
                <button
                  type="button"
                  onClick={() => setConditionFor(i)}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${a.condition ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-300 bg-white text-gray-700'}`}
                >
                  <FunnelIcon size={12} weight="fill" /> 条件{a.condition ? 'ON' : 'OFF'}
                </button>
                <Button type="button" size="xs" shape="square" variant="ghost" icon={ArrowUpIcon} aria-label="上へ" disabled={i === 0} onClick={() => move(i, i - 1)} />
                <Button type="button" size="xs" shape="square" variant="ghost" icon={ArrowDownIcon} aria-label="下へ" disabled={i === items.length - 1} onClick={() => move(i, i + 1)} />
                <Button type="button" size="xs" shape="square" variant="ghost" icon={TrashIcon} aria-label="このアクションを削除" onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))} />
              </div>
              {a.condition ? (
                <p className="border-b border-gray-200 bg-green-50 px-3 py-1 text-xs text-green-800">
                  条件: {describeFilter(a.condition, describeCtx) || '(条件なし)'}
                </p>
              ) : null}
              <div className="p-3">
                <ActionBody action={a} lookups={lookups} onChange={(next) => update(i, next)} />
              </div>
            </div>
          ))}

          <div className="pt-2 text-center">
            <p className="mb-2 text-xs text-gray-500">動作を更に追加できます</p>
            <div className="flex flex-wrap justify-center gap-2">
              {ACTION_BUTTONS.map((b) => (
                <button
                  key={b.type}
                  type="button"
                  disabled={!b.available}
                  title={b.available ? undefined : '準備中です'}
                  onClick={() => {
                    if (!b.available) return
                    setItems((prev) => [...prev, newAction(b.type as FriendAddActionItem['type'])])
                    setActive(items.length)
                  }}
                  className={`rounded border px-3 py-1 text-xs ${b.available ? 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50' : 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'}`}
                >
                  {b.label}
                  {b.available ? '' : '（準備中）'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-kumo-line px-5 py-3">
          <button
            type="button"
            onClick={() => onSave(items)}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            この条件で決定する
          </button>
        </div>
      </Dialog>

      {conditionFor !== null && items[conditionFor] ? (
        <AdvancedSearchDialog
          open
          onClose={() => setConditionFor(null)}
          accountId={accountId}
          initial={items[conditionFor].condition ?? emptyFilter()}
          initialSort="recent"
          initialPageSize={50}
          title={`${conditionFor + 1}. [${ACTION_TYPE_LABEL[items[conditionFor].type]}] ${describeAction(items[conditionFor], lookups)} の条件設定`}
          conditionOnly
          onApply={(filter) => {
            update(conditionFor, { ...items[conditionFor], condition: isFilterEmpty(filter) ? null : filter })
            setConditionFor(null)
          }}
        />
      ) : null}
    </Dialog.Root>
  )
}

// ── 種類ごとの入力 ──────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3 py-1.5">
      <span className="w-28 shrink-0 pt-2 text-right text-sm font-semibold text-gray-800">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function ActionBody({ action: a, lookups, onChange }: { action: FriendAddActionItem; lookups: ModalLookups; onChange: (a: FriendAddActionItem) => void }) {
  const set = (params: Record<string, unknown>) => onChange({ ...a, params: { ...a.params, ...params } })
  const p = a.params

  switch (a.type) {
    case 'rich_menu':
      return (
        <Row label="メニュー変更">
          <Select
            className="w-full"
            value={String(p.menu ?? 'default')}
            onValueChange={(v) => set({ menu: v ?? 'default' })}
            aria-label="メニュー変更"
            items={[{ value: 'default', label: 'デフォルトメニュー' }, ...lookups.menus.map((m) => ({ value: m.id, label: m.name }))]}
          />
          <p className="mt-1 text-xs text-gray-500">「デフォルトメニュー」は、この友だち個人に設定したメニューを外して、アカウントのデフォルトに戻します。</p>
        </Row>
      )
    case 'text':
      return (
        <>
          <Row label="メッセージ">
            <MessageEditor value={String(p.content ?? '')} onChange={(content) => set({ content })} lookups={lookups} />
          </Row>
          <Row label="送信タイミング">
            <TimingEditor value={a.timing} onChange={(timing) => onChange({ ...a, timing })} />
          </Row>
        </>
      )
    case 'template':
      return (
        <>
          <Row label="テンプレート">
            <Select
              className="w-full"
              value={String(p.templateId ?? '')}
              onValueChange={(v) => set({ templateId: v ?? '' })}
              aria-label="テンプレート"
              items={[{ value: '', label: 'テンプレート名を入力' }, ...lookups.templates.map((t) => ({ value: t.id, label: t.name }))]}
            />
          </Row>
          <Row label="送信タイミング">
            <TimingEditor value={a.timing} onChange={(timing) => onChange({ ...a, timing })} />
          </Row>
        </>
      )
    case 'tag': {
      const ids = (p.tagIds as string[] | undefined) ?? []
      return (
        <>
          <Row label="タグ操作">
            <div className="flex gap-4 pt-1.5 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" name={`tag-op-${a.params.op}-${ids.join()}`} checked={p.op !== 'remove'} onChange={() => set({ op: 'add' })} /> タグを追加
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name={`tag-op-${a.params.op}-${ids.join()}`} checked={p.op === 'remove'} onChange={() => set({ op: 'remove' })} /> タグをはずす
              </label>
            </div>
          </Row>
          <Row label="タグ選択">
            <div className="mb-1 flex flex-wrap gap-1.5">
              {ids.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-800">
                  {lookups.tags.find((t) => t.id === id)?.name ?? '(削除されたタグ)'}
                  <button type="button" aria-label="このタグを外す" onClick={() => set({ tagIds: ids.filter((x) => x !== id) })}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <Select
              className="w-full"
              value=""
              onValueChange={(v) => { if (v) set({ tagIds: [...ids, v] }) }}
              aria-label="タグ選択"
              items={[{ value: '', label: 'タグ名を入力' }, ...lookups.tags.filter((t) => !ids.includes(t.id)).map((t) => ({ value: t.id, label: t.name }))]}
            />
          </Row>
        </>
      )
    }
    case 'friend_field':
      return (
        <>
          <Row label="友だち情報欄選択">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  className="w-full"
                  value={String(p.fieldKey ?? '')}
                  onValueChange={(v) => set({ fieldKey: v ?? '' })}
                  aria-label="友だち情報欄選択"
                  items={[{ value: '', label: '友だち情報欄名を入力' }, ...lookups.fields.map((f) => ({ value: f.fieldKey, label: f.label }))]}
                />
              </div>
              <span className="text-sm">に</span>
            </div>
          </Row>
          <Row label="操作内容">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-700">定数</span>
              <div className="w-48">
                <Input aria-label="定数" value={String(p.value ?? '')} onChange={(e) => set({ value: e.target.value })} />
              </div>
              <span className="text-sm">を</span>
              <div className="w-36">
                <Select
                  className="w-full"
                  value={String(p.op ?? 'set')}
                  onValueChange={(v) => set({ op: v ?? 'set' })}
                  aria-label="操作"
                  items={[
                    { value: 'set', label: '← (代入)' },
                    { value: 'add', label: '＋ (加算)' },
                    { value: 'sub', label: '－ (減算)' },
                  ]}
                />
              </div>
              <span className="text-sm">する</span>
            </div>
          </Row>
        </>
      )
    case 'reminder':
      return (
        <>
          <Row label="操作種別">
            <div className="flex gap-4 pt-1.5 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" name={`rem-op-${String(p.reminderId)}-${a.type}`} checked={p.op !== 'cancel'} onChange={() => set({ op: 'start' })} /> リマインダを開始
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name={`rem-op-${String(p.reminderId)}-${a.type}`} checked={p.op === 'cancel'} onChange={() => set({ op: 'cancel' })} /> リマインダをキャンセル
              </label>
            </div>
          </Row>
          <Row label="リマインダ選択">
            <Select
              className="w-full"
              value={String(p.reminderId ?? '')}
              onValueChange={(v) => set({ reminderId: v ?? '' })}
              aria-label="リマインダ選択"
              items={[{ value: '', label: 'リマインダ名を入力' }, ...lookups.reminders.map((r) => ({ value: r.id, label: r.name }))]}
            />
          </Row>
        </>
      )
    case 'conversion':
      return (
        <>
          <p className="mb-2 rounded bg-sky-50 px-3 py-2 text-xs text-sky-800">広告連携しているコンバージョンを通過すると、自動的に広告媒体に送信されます。</p>
          <Row label="コンバージョン">
            <Select
              className="w-full"
              value={String(p.conversionPointId ?? '')}
              onValueChange={(v) => set({ conversionPointId: v ?? '' })}
              aria-label="コンバージョン"
              items={[{ value: '', label: 'コンバージョン名を入力' }, ...lookups.conversions.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </Row>
        </>
      )
  }
}

/** 送信タイミング(すぐに／遅らせる／時刻を指定) */
function TimingEditor({ value, onChange }: { value: FriendAddTimingItem | undefined; onChange: (t: FriendAddTimingItem) => void }) {
  const t: FriendAddTimingItem = value ?? { mode: 'now' }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-48">
        <Select
          className="w-full"
          value={t.mode}
          onValueChange={(v) => {
            if (v === 'delay') onChange({ mode: 'delay', amount: 10, unit: 'minutes' })
            else if (v === 'at') onChange({ mode: 'at', days: 1, time: '10:00' })
            else onChange({ mode: 'now' })
          }}
          aria-label="送信タイミング"
          items={[
            { value: 'now', label: 'すぐに送信する' },
            { value: 'delay', label: '送信を遅らせる' },
            { value: 'at', label: '時刻を指定する' },
          ]}
        />
      </div>
      {t.mode === 'delay' ? (
        <>
          <div className="w-24">
            <Input aria-label="遅らせる時間" type="number" min={1} value={String(t.amount)} onChange={(e) => onChange({ ...t, amount: Number(e.target.value) })} />
          </div>
          <div className="w-28">
            <Select
              className="w-full"
              value={t.unit}
              onValueChange={(v) => onChange({ ...t, unit: (v ?? 'minutes') as 'minutes' | 'hours' | 'days' })}
              aria-label="単位"
              items={[
                { value: 'minutes', label: '分後' },
                { value: 'hours', label: '時間後' },
                { value: 'days', label: '日後' },
              ]}
            />
          </div>
          <span className="text-sm">に送信する</span>
        </>
      ) : null}
      {t.mode === 'at' ? (
        <>
          <div className="w-24">
            <Input aria-label="日数" type="number" min={0} value={String(t.days)} onChange={(e) => onChange({ ...t, days: Number(e.target.value) })} />
          </div>
          <span className="text-sm">日後の</span>
          <div className="w-32">
            <Input aria-label="時刻" type="time" value={t.time} onChange={(e) => onChange({ ...t, time: e.target.value })} />
          </div>
          <span className="text-sm">に送信する</span>
          <p className="basis-full text-xs text-gray-500">0日後は当日です(すでに過ぎた時刻なら翌日)。時刻は日本時間です。</p>
        </>
      ) : null}
    </div>
  )
}

/** メッセージ入力。名前・友だち情報などの差し込みと絵文字を、カーソルの位置に入れられる。 */
function MessageEditor({ value, onChange, lookups }: { value: string; onChange: (v: string) => void; lookups: ModalLookups }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [history, setHistory] = useState<{ stack: string[]; at: number }>({ stack: [value], at: 0 })

  const commit = (next: string) => {
    onChange(next)
    setHistory((h) => ({ stack: [...h.stack.slice(0, h.at + 1), next].slice(-50), at: Math.min(h.at + 1, 49) }))
  }
  const step = (d: -1 | 1) => {
    const at = history.at + d
    if (at < 0 || at >= history.stack.length) return
    setHistory({ ...history, at })
    onChange(history.stack[at])
  }
  const insert = (text: string) => {
    const el = ref.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    commit(value.slice(0, start) + text + value.slice(end))
    const pos = start + text.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }
  const length = [...value].length

  const mini = 'inline-flex h-7 items-center rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 hover:bg-gray-50'
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <button type="button" className={mini} onClick={() => step(-1)} aria-label="元に戻す">↶</button>
        <button type="button" className={mini} onClick={() => step(1)} aria-label="やり直す">↷</button>
        <button type="button" className={mini} onClick={() => insert('{{name}}')}>名前</button>
        {lookups.reserve ? (
          <InsertMenu
            label="予約"
            items={[
              { label: '予約者名', text: '{{reserve.name}}' },
              { label: '料金', text: '{{reserve.price}}' },
              { label: '予約日時', text: '{{reserve.datetime}}' },
              { label: 'コース名', text: '{{reserve.course}}' },
              { label: '予約枠', text: '{{reserve.slot}}' },
              { label: '予約確認URL', text: '{{reserve.url}}' },
              ...(lookups.reserve.change
                ? [
                    { label: '変更前の予約日時', text: '{{reserve.before.datetime}}' },
                    { label: '変更前のコース名', text: '{{reserve.before.course}}' },
                    { label: '変更前の予約枠', text: '{{reserve.before.slot}}' },
                    { label: '変更前の料金', text: '{{reserve.before.price}}' },
                  ]
                : []),
            ]}
            onPick={insert}
          />
        ) : null}
        <InsertMenu label="友だち情報" items={lookups.fields.map((f) => ({ label: f.label, text: `{{metadata.${f.fieldKey}}}` }))} onPick={insert} />
        <InsertMenu label="共通情報" items={[]} onPick={insert} disabledNote="準備中" />
        <InsertMenu label="回答フォーム" items={lookups.forms.map((f) => ({ label: f.name, text: `{{form_url:${f.id}}}` }))} onPick={insert} />
        <InsertMenu label="配信日" items={[]} onPick={insert} disabledNote="準備中" />
        <InsertMenu
          label="その他"
          items={[
            { label: '友だちID', text: '{{friend_id}}' },
            { label: 'ユーザーID', text: '{{uid}}' },
          ]}
          onPick={insert}
        />
        <button type="button" className={mini} onClick={() => setEmojiOpen((v) => !v)} aria-expanded={emojiOpen} aria-label="絵文字">
          <SmileyIcon size={14} />
        </button>
      </div>
      {emojiOpen ? <EmojiPicker onPick={(e) => insert(e)} /> : null}
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => commit(e.target.value)}
        rows={8}
        aria-label="メッセージ"
        className="w-full rounded border border-gray-300 p-2 text-sm"
      />
      <p className={`text-right text-xs ${length > TEXT_LIMIT ? 'text-red-600' : 'text-gray-500'}`}>
        {length}/{TEXT_LIMIT}
      </p>
    </div>
  )
}

function InsertMenu({ label, items, onPick, disabledNote }: { label: string; items: Array<{ label: string; text: string }>; onPick: (text: string) => void; disabledNote?: string }) {
  const [open, setOpen] = useState(false)
  const mini = 'inline-flex h-7 items-center gap-1 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 hover:bg-gray-50'
  return (
    <span className="relative">
      <button type="button" className={mini} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {label} ▾
      </button>
      {open ? (
        <ul className="absolute left-0 z-20 mt-1 max-h-56 min-w-[10rem] overflow-y-auto rounded border border-gray-300 bg-white py-1 text-xs shadow">
          {items.length === 0 ? <li className="px-3 py-1.5 text-gray-400">{disabledNote ?? '選べるものがありません'}</li> : null}
          {items.map((it) => (
            <li key={it.text}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-gray-100"
                onClick={() => {
                  onPick(it.text)
                  setOpen(false)
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  )
}

