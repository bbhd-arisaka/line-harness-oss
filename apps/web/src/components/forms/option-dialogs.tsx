'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Modal } from '@/components/ui/modal'
import type { OptionAction } from './editor-types'

function Shell({
  open,
  title,
  onClose,
  onSave,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  onSave: () => void
  children: ReactNode
}) {
  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-lg" align="center">
      <div className="flex items-center justify-between border-b border-[#e3e3e6] px-6 py-4">
        <h2 className="text-base font-bold text-[#069e04]">{title}</h2>
        <button type="button" onClick={onClose} aria-label="閉じる" className="text-2xl leading-none text-[#414143]">×</button>
      </div>
      <div className="space-y-4 px-6 py-5">{children}</div>
      <div className="flex justify-end gap-3 border-t border-[#e3e3e6] px-6 py-4">
        <button type="button" onClick={onClose} className="h-10 w-28 rounded border border-[#cacace] bg-white text-sm hover:bg-[#f7f7f9]">閉じる</button>
        <button type="button" onClick={onSave} className="h-10 w-28 rounded bg-[#069e04] text-sm font-bold text-white hover:bg-[#058503]">保存する</button>
      </div>
    </Modal>
  )
}

const selectCls = 'h-10 w-full rounded border border-[#cacace] bg-white px-2 text-sm outline-none focus:border-[#069e04]'

// ─────────────────────────────────────────────────────────────
// 選択肢ごとの設定(初期表示・定員数)
// ─────────────────────────────────────────────────────────────

export function OptionSettingsDialog({
  open,
  optionName,
  initialSelected,
  capacity,
  onClose,
  onSave,
}: {
  open: boolean
  optionName: string
  initialSelected: boolean
  capacity: number | null
  onClose: () => void
  onSave: (v: { initialSelected: boolean; capacity: number | null }) => void
}) {
  const [sel, setSel] = useState(initialSelected)
  const [capOn, setCapOn] = useState(capacity !== null)
  const [cap, setCap] = useState(String(capacity ?? 10))

  useEffect(() => {
    if (!open) return
    setSel(initialSelected)
    setCapOn(capacity !== null)
    setCap(String(capacity ?? 10))
  }, [open, initialSelected, capacity])

  return (
    <Shell
      open={open}
      title={`選択肢「${optionName || '名称未設定'}」の設定`}
      onClose={onClose}
      onSave={() => onSave({ initialSelected: sel, capacity: capOn && Number(cap) > 0 ? Number(cap) : null })}
    >
      <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
        <span className="text-sm font-bold">初期表示</span>
        <select className={`${selectCls} max-w-[10rem]`} value={sel ? 'on' : 'off'} onChange={(e) => setSel(e.target.value === 'on')}>
          <option value="off">未選択</option>
          <option value="on">選択済み</option>
        </select>
      </div>
      <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
        <span className="text-sm font-bold">定員数</span>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={capOn} onChange={(e) => setCapOn(e.target.checked)} />
            有効にする
          </label>
          {capOn && (
            <div className="flex items-center gap-2 text-sm">
              <input type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} className={`${selectCls} max-w-[8rem]`} />
              名まで(満員になるとこの選択肢は選べなくなります)
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}

// ─────────────────────────────────────────────────────────────
// 選択肢ごとのアクション設定(タグ追加・削除・シナリオ開始)
// ─────────────────────────────────────────────────────────────

function TagChips({
  label,
  tags,
  value,
  onChange,
}: {
  label: string
  tags: Array<{ id: string; name: string }>
  value: string[]
  onChange: (v: string[]) => void
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-bold">{label}</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-xs text-[#757578]">設定なし</span>}
        {value.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded bg-[#e6f5e5] px-2 py-0.5 text-xs font-bold text-[#069e04]">
            {tags.find((t) => t.id === id)?.name ?? '?'}
            <button type="button" aria-label="外す" onClick={() => onChange(value.filter((v) => v !== id))}>×</button>
          </span>
        ))}
      </div>
      <select
        className={selectCls}
        value=""
        onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]) }}
      >
        <option value="">タグを選んで追加</option>
        {tags.filter((t) => !value.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  )
}

export function OptionActionDialog({
  open,
  optionName,
  action,
  tags,
  scenarios,
  onClose,
  onSave,
}: {
  open: boolean
  optionName: string
  action: OptionAction
  tags: Array<{ id: string; name: string }>
  scenarios: Array<{ id: string; name: string }>
  onClose: () => void
  onSave: (a: OptionAction) => void
}) {
  const [a, setA] = useState<OptionAction>(action)
  useEffect(() => { if (open) setA(action) }, [open, action])

  return (
    <Shell open={open} title={`選択肢「${optionName || '名称未設定'}」のアクション設定`} onClose={onClose} onSave={() => onSave(a)}>
      <TagChips label="タグを追加" tags={tags} value={a.addTagIds} onChange={(v) => setA({ ...a, addTagIds: v })} />
      <TagChips label="タグを削除" tags={tags} value={a.removeTagIds} onChange={(v) => setA({ ...a, removeTagIds: v })} />
      <div>
        <p className="mb-1 text-sm font-bold">シナリオを開始</p>
        <select className={selectCls} value={a.scenarioId} onChange={(e) => setA({ ...a, scenarioId: e.target.value })}>
          <option value="">(設定しない)</option>
          {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
    </Shell>
  )
}
