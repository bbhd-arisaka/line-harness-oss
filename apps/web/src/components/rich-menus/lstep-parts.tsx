'use client'

import { useEffect, useMemo, useState } from 'react'
import { LightningIcon } from '@phosphor-icons/react'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { api, fetchApi } from '@/lib/api'
import { describeAction } from '@/lib/friend-add-actions'
import type { FriendAddActionItem } from '@/lib/friend-add-actions'
import type { Area } from './canvas-editor'
import ActionSettingsModal, { type ModalLookups } from '@/components/friend-add/action-settings-modal'

// ─────────────────────────────────────────────
// ボタンの「動き」の種類(Lステップの「URL / TEL / ユーザーメッセージ / アクション / 回答フォーム / その他」)
// ─────────────────────────────────────────────

export type ButtonKind = 'url' | 'tel' | 'message' | 'actions' | 'form' | 'other'

export const BUTTON_KINDS: Array<{ value: ButtonKind; label: string }> = [
  { value: 'url', label: 'URL' },
  { value: 'tel', label: 'TEL' },
  { value: 'message', label: 'ユーザーメッセージ' },
  { value: 'actions', label: 'アクション' },
  { value: 'form', label: '回答フォーム' },
  { value: 'other', label: 'その他' },
]

export const INPUT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '何もしない' },
  { value: 'closeRichMenu', label: 'リッチメニューを閉じる' },
  { value: 'openKeyboard', label: 'キーボードを開く' },
  { value: 'openVoice', label: 'ボイスメッセージ入力画面を開く' },
]

/** 保存済みの形を、画面で使う形に。以前の「店舗からメッセージを送る」「テンプレートを送る」は、「アクション」に統合して見せる */
export function normalizeArea(a: Area): Area {
  const d = (a.actionData ?? {}) as Record<string, unknown>
  if (a.actionType === 'postback' && d.kind === 'reply') {
    const text = typeof d.replyText === 'string' ? d.replyText : ''
    return { ...a, actionData: { kind: 'actions', actions: [{ type: 'text', params: { content: text }, condition: null }], displayText: '', inputOption: '' } }
  }
  if (a.actionType === 'postback' && d.kind === 'template') {
    const templateId = typeof d.templateId === 'string' ? d.templateId : ''
    return { ...a, actionData: { kind: 'actions', actions: [{ type: 'template', params: { templateId }, condition: null }], displayText: '', inputOption: '' } }
  }
  return a
}

export function kindOf(a: Area): ButtonKind {
  const d = (a.actionData ?? {}) as Record<string, unknown>
  if (a.actionType === 'uri') {
    if (typeof d.formId === 'string' && d.formId) return 'form'
    if (typeof d.uri === 'string' && d.uri.startsWith('tel:')) return 'tel'
    return 'url'
  }
  if (a.actionType === 'message') return 'message'
  if (a.actionType === 'postback' && d.kind === 'actions') return 'actions'
  return 'other'
}

export function defaultFor(kind: ButtonKind): Pick<Area, 'actionType' | 'actionData'> {
  switch (kind) {
    case 'url': return { actionType: 'uri', actionData: { uri: '' } }
    case 'tel': return { actionType: 'uri', actionData: { uri: 'tel:' } }
    case 'message': return { actionType: 'message', actionData: { text: '' } }
    case 'actions': return { actionType: 'postback', actionData: { kind: 'actions', actions: [], displayText: '', inputOption: '' } }
    case 'form': return { actionType: 'uri', actionData: { formId: '', uri: '' } }
    case 'other': return { actionType: 'richmenuswitch', actionData: { targetPageId: '' } }
  }
}

// ─────────────────────────────────────────────
// 「テンプレート」(ボタンの配置のひな形)
// ─────────────────────────────────────────────

type Cell = { x: number; y: number; w: number; h: number }
const L = { w: 2500, h: 1686 }
const C = { w: 2500, h: 843 }

export const LAYOUTS: Array<{ key: string; size: 'large' | 'compact'; cells: Cell[] }> = [
  { key: 'l-3x2', size: 'large', cells: Array.from({ length: 6 }, (_, i) => ({ x: (i % 3) * (L.w / 3), y: Math.floor(i / 3) * (L.h / 2), w: L.w / 3, h: L.h / 2 })) },
  { key: 'l-2x2', size: 'large', cells: Array.from({ length: 4 }, (_, i) => ({ x: (i % 2) * (L.w / 2), y: Math.floor(i / 2) * (L.h / 2), w: L.w / 2, h: L.h / 2 })) },
  { key: 'l-1+3', size: 'large', cells: [{ x: 0, y: 0, w: L.w, h: L.h / 2 }, ...[0, 1, 2].map((i) => ({ x: i * (L.w / 3), y: L.h / 2, w: L.w / 3, h: L.h / 2 }))] },
  { key: 'l-1|2', size: 'large', cells: [{ x: 0, y: 0, w: L.w / 2, h: L.h }, { x: L.w / 2, y: 0, w: L.w / 2, h: L.h / 2 }, { x: L.w / 2, y: L.h / 2, w: L.w / 2, h: L.h / 2 }] },
  { key: 'l-1+2', size: 'large', cells: [{ x: 0, y: 0, w: L.w, h: L.h / 2 }, { x: 0, y: L.h / 2, w: L.w / 2, h: L.h / 2 }, { x: L.w / 2, y: L.h / 2, w: L.w / 2, h: L.h / 2 }] },
  { key: 'l-2col', size: 'large', cells: [{ x: 0, y: 0, w: L.w / 2, h: L.h }, { x: L.w / 2, y: 0, w: L.w / 2, h: L.h }] },
  { key: 'l-1', size: 'large', cells: [{ x: 0, y: 0, w: L.w, h: L.h }] },
  { key: 'c-3', size: 'compact', cells: [0, 1, 2].map((i) => ({ x: i * (C.w / 3), y: 0, w: C.w / 3, h: C.h })) },
  { key: 'c-2', size: 'compact', cells: [0, 1].map((i) => ({ x: i * (C.w / 2), y: 0, w: C.w / 2, h: C.h })) },
  { key: 'c-1+2', size: 'compact', cells: [{ x: 0, y: 0, w: C.w / 2, h: C.h }, { x: C.w / 2, y: 0, w: C.w / 2, h: C.h / 2 }, { x: C.w / 2, y: C.h / 2, w: C.w / 2, h: C.h / 2 }] },
  { key: 'c-1', size: 'compact', cells: [{ x: 0, y: 0, w: C.w, h: C.h }] },
]

/** ひな形の1枚(色分けしたマスで、配置を見せる) */
export function LayoutThumb({ cells, size, active, onClick }: { cells: Cell[]; size: 'large' | 'compact'; active?: boolean; onClick: () => void }) {
  const dims = size === 'large' ? L : C
  const W = 88
  const H = Math.round((W * dims.h) / dims.w) + 12
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden rounded border bg-white ${active ? 'border-[#069e04] ring-1 ring-[#069e04]' : 'border-[#cacace] hover:border-[#9c9ca0]'}`}
      style={{ width: W + 8, height: H + 8 }}
      aria-label="配置のひな形"
    >
      <span className="absolute left-1 top-1 h-2 w-[calc(100%-8px)] rounded-sm bg-[#e8e8ea]" />
      <span className="absolute left-1 right-1 top-4 bottom-1">
        {cells.map((c, i) => (
          <span
            key={i}
            className="absolute border border-white"
            style={{
              left: `${(c.x / dims.w) * 100}%`,
              top: `${(c.y / dims.h) * 100}%`,
              width: `${(c.w / dims.w) * 100}%`,
              height: `${(c.h / dims.h) * 100}%`,
              background: i % 2 === 0 ? '#fdf6cf' : '#d6eaf6',
            }}
          />
        ))}
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────
// 右側のプレビュー(トーク画面の下に出るメニューの見え方)
// ─────────────────────────────────────────────

export function MenuPreview({ areas, size, imageUrl, chatBarText, selectedId, onSelect }: { areas: Area[]; size: 'large' | 'compact'; imageUrl: string | null; chatBarText: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const dims = size === 'large' ? L : C
  return (
    <div className="w-full select-none rounded border border-[#cacace] bg-[#8da6c9] p-3">
      <div className="mb-3 flex items-end gap-2">
        <span className="h-9 w-9 shrink-0 rounded-full bg-white/70" />
        <span className="rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-xs text-[#333]">トーク画面下にメニューが表示されます</span>
      </div>
      <div className="overflow-hidden rounded-t bg-white">
        <div className="relative w-full bg-[#e8e8ea]" style={{ aspectRatio: `${dims.w} / ${dims.h}` }}>
          {imageUrl ? <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-fill" /> : null}
          {areas.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              className={`absolute flex items-center justify-center border text-lg font-bold ${selectedId === a.id ? 'border-[#e0483c] bg-[#e0483c]/20 text-[#e0483c]' : 'border-[#1d4e89]/60 bg-[#1d4e89]/10 text-[#1d4e89]'}`}
              style={{ left: `${(a.boundsX / dims.w) * 100}%`, top: `${(a.boundsY / dims.h) * 100}%`, width: `${(a.boundsWidth / dims.w) * 100}%`, height: `${(a.boundsHeight / dims.h) * 100}%` }}
              aria-label={`ボタン${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="flex items-center border-t border-[#e3e3e6] bg-[#f7f7f9] text-xs text-[#555]">
          <span className="flex h-9 w-11 items-center justify-center border-r border-[#e3e3e6] text-base">⌨</span>
          <span className="flex-1 truncate py-2 text-center">{chatBarText || ' '}</span>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// ボタン1つ分の設定
// ─────────────────────────────────────────────

export type Lookups = ModalLookups

export function useActionLookups(accountId: string): { lookups: Lookups; ready: boolean } {
  const [lookups, setLookups] = useState<Lookups>({ tags: [], templates: [], menus: [], fields: [], reminders: [], conversions: [], forms: [], scenarios: [] })
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [sc, tg, tp, mn, fd, rm, cv, fm] = await Promise.all([
        api.scenarios.list({ accountId }).catch(() => null),
        api.tags.list().catch(() => null),
        api.templates.list().catch(() => null),
        api.richMenuGroups.list(accountId).catch(() => null),
        fetchApi<{ success: boolean; data: Array<{ field_key?: string; fieldKey?: string; label: string }> }>('/api/friend-fields/definitions').catch(() => null),
        api.reminders.list().catch(() => null),
        api.conversions.points().catch(() => null),
        fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>('/api/forms').catch(() => null),
      ])
      if (cancelled) return
      const tplItems = await api.tpl.items({ lineAccountId: accountId, folder: 'all', pageSize: 100 }).catch(() => null)
      if (cancelled) return
      setLookups({
        scenarios: sc && sc.success ? sc.data.map((x) => ({ id: x.id, name: x.name })) : [],
        tags: tg && tg.success ? tg.data.map((x) => ({ id: x.id, name: x.name })) : [],
        // テンプレート(ライブラリ)。取れなければ、従来のメッセージテンプレート
        templates: tplItems && tplItems.success ? tplItems.data.items.map((x) => ({ id: x.id, name: x.name })) : tp && tp.success ? tp.data.map((x) => ({ id: x.id, name: x.name })) : [],
        menus: mn && mn.success ? mn.data.filter((x) => x.status === 'published').map((x) => ({ id: x.id, name: x.name })) : [],
        fields: fd && fd.success ? fd.data.map((f) => ({ fieldKey: (f.fieldKey ?? f.field_key) as string, label: f.label })) : [],
        reminders: rm && rm.success ? rm.data.map((x) => ({ id: x.id, name: x.name })) : [],
        conversions: cv && cv.success ? cv.data.map((x) => ({ id: x.id, name: x.name })) : [],
        forms: fm && fm.success ? fm.data.map((x) => ({ id: x.id, name: x.name })) : [],
      })
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [accountId])
  return { lookups, ready }
}

const field = 'h-9 w-full rounded border border-[#cacace] bg-white px-3 text-sm outline-none focus:border-[#069e04]'

export function ButtonCard({
  index,
  area,
  pages,
  lookups,
  accountId,
  onChange,
  onMove,
  onCopy,
  onDelete,
  onEditRegion,
  selected,
  canMoveUp,
  canMoveDown,
}: {
  index: number
  area: Area
  pages: Array<{ id: string; name: string }>
  lookups: Lookups
  accountId: string
  onChange: (patch: Partial<Area>) => void
  onMove: (dir: -1 | 1) => void
  onCopy: () => void
  onDelete: () => void
  onEditRegion: () => void
  selected: boolean
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const kind = kindOf(area)
  const d = (area.actionData ?? {}) as Record<string, unknown>
  const [actionOpen, setActionOpen] = useState(false)
  const actions = (Array.isArray(d.actions) ? d.actions : []) as FriendAddActionItem[]
  const describeCtx = useMemo(() => lookups, [lookups])
  const setKind = (k: ButtonKind) => { if (k !== kind) onChange(defaultFor(k)) }
  const setData = (patch: Record<string, unknown>) => onChange({ actionData: { ...d, ...patch } })

  return (
    <div id={`rm-button-${area.id}`} className={`rounded border ${selected ? 'border-[#069e04]' : 'border-[#cacace]'} bg-white`}>
      <div className="flex items-center justify-between border-b border-[#cacace] bg-[#f1f1f4] px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-bold text-[#333]">
          ボタン{index + 1}
          <button type="button" onClick={onEditRegion} className="rounded bg-[#f0ad4e] px-2 py-0.5 text-[11px] font-bold text-white hover:bg-[#ec9f35]">領域編集</button>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button type="button" disabled={!canMoveUp} onClick={() => onMove(-1)} className="rounded border border-[#cacace] bg-white px-2 py-1 hover:bg-[#f7f7f9] disabled:opacity-40">↑ 上へ</button>
          <button type="button" disabled={!canMoveDown} onClick={() => onMove(1)} className="rounded border border-[#cacace] bg-white px-2 py-1 hover:bg-[#f7f7f9] disabled:opacity-40">↓ 下へ</button>
          <button type="button" onClick={onCopy} className="rounded border border-[#cacace] bg-white px-2 py-1 hover:bg-[#f7f7f9]">コピー</button>
          <button type="button" onClick={onDelete} className="rounded border border-[#cacace] bg-white px-2 py-1 text-[#d92d20] hover:bg-[#fef3f2]">✕ 削除</button>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {BUTTON_KINDS.map((k) => (
            <label key={k.value} className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name={`kind-${area.id}`} checked={kind === k.value} onChange={() => setKind(k.value)} />
              {k.label}
            </label>
          ))}
        </div>

        {kind === 'url' && (
          <input className={field} placeholder="https://" value={(d.uri as string) ?? ''} onChange={(e) => setData({ uri: e.target.value })} aria-label="URL" />
        )}

        {kind === 'tel' && (
          <input
            className={field}
            placeholder="03-1234-5678"
            value={String(d.uri ?? '').replace(/^tel:/, '')}
            onChange={(e) => setData({ uri: `tel:${e.target.value.replace(/[^0-9+*#]/g, '')}` })}
            aria-label="電話番号"
          />
        )}

        {kind === 'message' && (
          <textarea className="w-full rounded border border-[#cacace] px-3 py-2 text-sm outline-none focus:border-[#069e04]" rows={3} maxLength={300} value={(d.text as string) ?? ''} onChange={(e) => setData({ text: e.target.value })} aria-label="ユーザーメッセージ" />
        )}

        {kind === 'form' && (
          <select className={field} value={(d.formId as string) ?? ''} onChange={(e) => setData({ formId: e.target.value })} aria-label="回答フォーム">
            <option value="">フォームを選択</option>
            {lookups.forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}

        {kind === 'other' && (
          <div className="space-y-2">
            {area.actionType === 'richmenuswitch' ? (
              <select className={field} value={(d.targetPageId as string) ?? ''} onChange={(e) => setData({ targetPageId: e.target.value })} aria-label="切り替え先のページ">
                <option value="">切り替え先のページを選択</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <input className={field} value={(d.data as string) ?? ''} onChange={(e) => setData({ data: e.target.value })} aria-label="postback data" />
            )}
            <div className="flex gap-4 text-xs text-[#555]">
              <label className="flex items-center gap-1"><input type="radio" checked={area.actionType === 'richmenuswitch'} onChange={() => onChange({ actionType: 'richmenuswitch', actionData: { targetPageId: '' } })} />ページを切り替える</label>
              <label className="flex items-center gap-1"><input type="radio" checked={area.actionType === 'postback'} onChange={() => onChange({ actionType: 'postback', actionData: { data: '', displayText: '' } })} />上級者向け(postback)</label>
            </div>
          </div>
        )}

        {kind === 'actions' && (
          <>
            <button type="button" onClick={() => setActionOpen(true)} className="flex w-full items-center justify-center gap-1.5 rounded bg-[#f0ad4e] px-3 py-2 text-sm font-medium text-white hover:bg-[#ec9f35]">
              <LightningIcon size={14} weight="fill" /> アクション設定
            </button>
            {actions.length > 0 && (
              <ul className="space-y-0.5 text-xs text-[#333]">
                {actions.map((a, i) => <li key={i}>{describeAction(a, describeCtx)}</li>)}
              </ul>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-xs text-[#757578]">
                ユーザーメッセージ(任意)
                <input className={`${field} mt-1`} maxLength={60} placeholder="60文字以内" value={(d.displayText as string) ?? ''} disabled={!!d.inputOption} onChange={(e) => setData({ displayText: e.target.value })} />
              </label>
              <label className="block text-xs text-[#757578]">
                LINEアプリ側動作
                <select className={`${field} mt-1`} value={(d.inputOption as string) ?? ''} onChange={(e) => setData({ inputOption: e.target.value, ...(e.target.value ? { displayText: '' } : {}) })}>
                  {INPUT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
            <ActionSettingsModal
              key={actionOpen ? 'open' : 'closed'}
              open={actionOpen}
              initial={actions}
              lookups={lookups}
              accountId={accountId}
              onClose={() => setActionOpen(false)}
              onSave={(next) => { setData({ actions: next }); setActionOpen(false) }}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** 「領域編集」: 画像の上で、ボタンの範囲をドラッグして決める */
export function RegionDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="lg" className="!w-[min(1100px,96vw)] !max-w-none p-0">
        <div className="flex items-center justify-between border-b border-[#e3e3e6] px-5 py-3">
          <Dialog.Title className="text-base font-normal">領域編集</Dialog.Title>
          <button type="button" onClick={onClose} className="rounded bg-[#069e04] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#058503]">決定</button>
        </div>
        <div className="max-h-[78vh] overflow-auto bg-[#f7f7f9] p-4">{children}</div>
      </Dialog>
    </Dialog.Root>
  )
}
