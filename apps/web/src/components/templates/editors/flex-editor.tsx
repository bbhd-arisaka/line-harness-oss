'use client'

import { useRef, useState } from 'react'
import type { FlexBlock, FlexBlockAction, FlexEditorData, TapLimit } from '@line-crm/shared'
import ActionSettingsModal from '@/components/friend-add/action-settings-modal'
import { describeAction } from '@/lib/friend-add-actions'
import type { FriendAddActionItem } from '@/lib/friend-add-actions'
import MediaDialog from '../media-dialog'
import MessageField from '../message-field'
import { btnLine, fieldCls } from './types'
import type { TabProps } from './types'

const THEMES = [
  { id: '#06C755', label: '緑' },
  { id: '#1E6FEB', label: '青' },
  { id: '#F2994A', label: '橙' },
  { id: '#E5453B', label: '赤' },
  { id: '#FFFFFF', label: '白' },
]
const SIZES: Array<{ id: NonNullable<FlexEditorData['size']>; label: string; px: number }> = [
  { id: 'nano', label: '極小', px: 120 },
  { id: 'micro', label: '小', px: 180 },
  { id: 'kilo', label: 'やや小', px: 220 },
  { id: 'mega', label: '標準', px: 260 },
  { id: 'giga', label: '大', px: 300 },
]
const MARGINS: Array<{ id: NonNullable<FlexBlock['margin']>; label: string; px: number }> = [
  { id: 'none', label: 'なし', px: 0 },
  { id: 'sm', label: '小', px: 6 },
  { id: 'md', label: '普通', px: 12 },
  { id: 'lg', label: '大', px: 20 },
]
const SHAPES: Array<{ id: 'fit' | 'square' | 'wide' | 'tall'; label: string; ratio: string }> = [
  { id: 'fit', label: '画像に合わせる', ratio: '' },
  { id: 'square', label: '正方形', ratio: '1 / 1' },
  { id: 'wide', label: '横長(20:13)', ratio: '20 / 13' },
  { id: 'tall', label: '縦長(2:3)', ratio: '2 / 3' },
]
const TAP_LIMITS: Array<{ id: TapLimit; label: string }> = [
  { id: 'none', label: '制限しない' },
  { id: 'carousel_once', label: '全体で1回のみ' },
  { id: 'panel_once', label: 'パネルごとに1回のみ' },
  { id: 'choice_once', label: 'ボタンごとに1回のみ' },
]
const BLOCK_LABEL: Record<FlexBlock['type'], string> = { image: '画像', title: 'タイトル', text: 'テキスト', button: 'ボタン', video: '動画' }
const selectCls = 'h-9 w-full rounded border border-[#cacace] bg-white px-2 text-sm outline-none focus:border-[#069e04]'

let seq = 0
const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`

function newBlock(type: FlexBlock['type']): FlexBlock {
  const base = { id: newId(), margin: 'md' as const, background: null }
  switch (type) {
    case 'title': return { ...base, type, title: '', subtitle: '' }
    case 'text': return { ...base, type, text: '', border: false }
    case 'button': return { ...base, type, label: '', action: { kind: 'none' }, styled: true }
    case 'image': return { ...base, type, url: '', shape: 'fit' }
    case 'video': return { ...base, type, url: '', previewUrl: '' }
  }
}

function ColorField({ value, onChange, label }: { value: string | null | undefined; onChange: (v: string | null) => void; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 flex-shrink-0 font-bold">{label}</span>
      <input type="color" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-[#cacace] p-0.5" aria-label={label} />
      {value ? <button type="button" onClick={() => onChange(null)} className="text-[#757578] underline">なし</button> : <span className="text-[#9a9a9e]">なし</span>}
    </div>
  )
}

function ActionField({ value, onChange, env, allowNone = true }: { value: FlexBlockAction | undefined; onChange: (v: FlexBlockAction) => void; env: TabProps<FlexEditorData>['env']; allowNone?: boolean }) {
  const [open, setOpen] = useState(false)
  const a = value ?? { kind: 'none' as const }
  const actions = (a.kind === 'actions' ? a.actions : []) as FriendAddActionItem[]
  return (
    <div className="space-y-1.5">
      <select
        value={a.kind}
        onChange={(e) => {
          const k = e.target.value as FlexBlockAction['kind']
          onChange(k === 'url' ? { kind: 'url', url: '' } : k === 'message' ? { kind: 'message', text: '' } : k === 'tel' ? { kind: 'tel', value: '' } : k === 'actions' ? { kind: 'actions', actions: [] } : { kind: 'none' })
        }}
        className={selectCls}
        aria-label="アクション"
      >
        {allowNone ? <option value="none">（未設定）</option> : <option value="none">選択してください</option>}
        <option value="url">URLを開く</option>
        <option value="message">ユーザーメッセージ送信</option>
        <option value="tel">電話をかける</option>
        <option value="actions">アクションを実行</option>
      </select>
      {a.kind === 'url' ? <input value={a.url} onChange={(e) => onChange({ kind: 'url', url: e.target.value })} placeholder="https://example.com" className={fieldCls} aria-label="開くURL" /> : null}
      {a.kind === 'message' ? <input value={a.text} onChange={(e) => onChange({ kind: 'message', text: e.target.value })} className={fieldCls} aria-label="送信するメッセージ" /> : null}
      {a.kind === 'tel' ? <input value={a.value} onChange={(e) => onChange({ kind: 'tel', value: e.target.value })} placeholder="03-1234-5678" className={fieldCls} aria-label="電話番号" /> : null}
      {a.kind === 'actions' ? (
        <div className="space-y-1.5">
          {actions.map((x, i) => (
            <div key={i} className="rounded bg-[#f7f7f9] px-2 py-1 text-xs">{describeAction(x, env.lookups)}</div>
          ))}
          <button type="button" onClick={() => setOpen(true)} className={btnLine}>アクション設定</button>
          {open ? <ActionSettingsModal open initial={actions} lookups={env.lookups} accountId={env.accountId} onClose={() => setOpen(false)} onSave={(next) => { onChange({ kind: 'actions', actions: next }); setOpen(false) }} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/** スマホ風プレビューの中の1ブロック(見た目の近似) */
function BlockView({ b, theme }: { b: FlexBlock; theme: string }) {
  const mt = MARGINS.find((m) => m.id === (b.margin ?? 'md'))?.px ?? 12
  const bg = b.background ? { backgroundColor: b.background } : {}
  switch (b.type) {
    case 'title':
      return (
        <div style={{ marginTop: mt, ...bg }}>
          <div className="whitespace-pre-wrap break-words text-lg font-bold leading-tight">{b.title || <span className="text-[#bbb]">タイトル</span>}</div>
          {b.subtitle ? <div className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[#888]">{b.subtitle}</div> : null}
        </div>
      )
    case 'text':
      return (
        <div style={{ marginTop: mt, ...bg }} className={b.border ? 'rounded border border-[#ddd] p-2' : ''}>
          <div className="whitespace-pre-wrap break-words text-xs">{b.text || <span className="text-[#bbb]">テキスト</span>}</div>
        </div>
      )
    case 'button':
      return (
        <div style={{ marginTop: mt }}>
          <div className="rounded-md py-2 text-center text-sm font-bold" style={b.styled ? { backgroundColor: b.background || theme, color: (b.background || theme).toLowerCase() === '#ffffff' ? '#111' : '#fff', border: '1px solid #ddd' } : { color: '#1E6FEB' }}>
            {b.label || <span className="opacity-60">ボタン</span>}
          </div>
        </div>
      )
    case 'image': {
      const ratio = SHAPES.find((s) => s.id === (b.shape ?? 'fit'))?.ratio
      return (
        <div style={{ marginTop: mt }}>
          {b.url ? <img src={b.url} alt="" className="w-full" style={ratio ? { aspectRatio: ratio, objectFit: 'cover' } : undefined} /> : <div className="flex h-24 items-center justify-center bg-[#eee] text-xs text-[#999]">画像</div>}
          {b.title ? <div className="mt-1 text-sm font-bold">{b.title}</div> : null}
          {b.subtitle ? <div className="text-xs text-[#888]">{b.subtitle}</div> : null}
        </div>
      )
    }
    case 'video':
      return (
        <div style={{ marginTop: mt }} className="relative">
          {b.previewUrl ? <img src={b.previewUrl} alt="" className="w-full" style={{ aspectRatio: '16 / 9', objectFit: 'cover' }} /> : <div className="flex items-center justify-center bg-[#222] text-xs text-white" style={{ aspectRatio: '16 / 9' }}>動画</div>}
          <span className="absolute inset-0 flex items-center justify-center text-3xl text-white drop-shadow">▶</span>
        </div>
      )
  }
}

/**
 * フレックスメッセージのビジュアルエディタ。
 * 上: パネル設定(背景・テーマカラー・サイズ)。左: スマホ風プレビュー+パネルの移動/複製/新規/削除。右: ブロック設定(画像/タイトル/テキスト/ボタン/動画)。
 */
export default function FlexEditor({ value, onChange, env }: TabProps<FlexEditorData>) {
  const [pi, setPi] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [picker, setPicker] = useState<null | { id: string; field: 'url' | 'previewUrl' | 'video' }>(null)
  // 元に戻す/やり直す
  const past = useRef<FlexEditorData[]>([])
  const future = useRef<FlexEditorData[]>([])
  const [, bump] = useState(0)

  const commit = (next: FlexEditorData) => {
    past.current.push(value)
    if (past.current.length > 50) past.current.shift()
    future.current = []
    onChange(next)
    bump((n) => n + 1)
  }
  const undo = () => {
    const p = past.current.pop()
    if (!p) return
    future.current.push(value)
    onChange(p)
    bump((n) => n + 1)
  }
  const redo = () => {
    const f = future.current.pop()
    if (!f) return
    past.current.push(value)
    onChange(f)
    bump((n) => n + 1)
  }

  const idx = Math.min(pi, value.panels.length - 1)
  const panel = value.panels[idx]
  const theme = value.themeColor || '#06C755'
  const size = SIZES.find((s) => s.id === (value.size ?? 'mega')) ?? SIZES[3]
  const sel = panel.blocks.findIndex((b) => b.id === selected)
  const block = sel >= 0 ? panel.blocks[sel] : null

  const setPanels = (panels: FlexEditorData['panels']) => commit({ ...value, panels })
  const setBlocks = (blocks: FlexBlock[]) => setPanels(value.panels.map((p, i) => (i === idx ? { ...p, blocks } : p)))
  const patchBlock = (patch: Partial<FlexBlock>) => setBlocks(panel.blocks.map((b, i) => (i === sel ? ({ ...b, ...patch } as FlexBlock) : b)))
  const moveBlock = (to: number) => {
    if (sel < 0 || to < 0 || to >= panel.blocks.length) return
    const next = [...panel.blocks]
    const [b] = next.splice(sel, 1)
    next.splice(to, 0, b)
    setBlocks(next)
  }
  const addBlock = (type: FlexBlock['type']) => {
    const b = newBlock(type)
    const at = sel >= 0 ? sel + 1 : panel.blocks.length
    const next = [...panel.blocks]
    next.splice(at, 0, b)
    setBlocks(next)
    setSelected(b.id)
    setAddOpen(false)
  }
  const movePanel = (to: number) => {
    if (to < 0 || to >= value.panels.length) return
    const next = [...value.panels]
    const [p] = next.splice(idx, 1)
    next.splice(to, 0, p)
    setPanels(next)
    setPi(to)
  }
  const copyPanel = () => {
    if (value.panels.length >= 10) return
    const copy = JSON.parse(JSON.stringify(panel)) as typeof panel
    copy.blocks = copy.blocks.map((b) => ({ ...b, id: newId() }))
    const next = [...value.panels]
    next.splice(idx + 1, 0, copy)
    setPanels(next)
    setPi(idx + 1)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded border border-[#e3e3e6] bg-[#f7f7f9] px-4 py-3">
        <ColorField label="背景" value={panel.background} onChange={(bg) => setPanels(value.panels.map((p, i) => (i === idx ? { ...p, background: bg } : p)))} />
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold">テーマカラー(共通)</span>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-label={t.label}
              aria-pressed={theme.toLowerCase() === t.id.toLowerCase()}
              onClick={() => commit({ ...value, themeColor: t.id })}
              className={`h-6 w-6 rounded-full border ${theme.toLowerCase() === t.id.toLowerCase() ? 'ring-2 ring-[#069e04] ring-offset-1' : ''} border-[#cacace]`}
              style={{ backgroundColor: t.id }}
            />
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="font-bold">サイズ(共通)</span>
          <select value={value.size ?? 'mega'} onChange={(e) => commit({ ...value, size: e.target.value as FlexEditorData['size'] })} className="h-8 rounded border border-[#cacace] bg-white px-2 text-xs" aria-label="サイズ">
            {SIZES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="font-bold">タップ回数の制限</span>
          <select value={value.tapLimit ?? 'none'} onChange={(e) => commit({ ...value, tapLimit: e.target.value as TapLimit })} className="h-8 rounded border border-[#cacace] bg-white px-2 text-xs" aria-label="タップ回数の制限">
            {TAP_LIMITS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div>
          <div className="mx-auto w-full max-w-[22rem] rounded-2xl bg-[#8cabd9] p-4">
            <div className="mx-auto overflow-hidden rounded-xl bg-white shadow" style={{ width: size.px, maxWidth: '100%', backgroundColor: panel.background || '#fff' }}>
              <div className="p-3">
                {panel.blocks.length === 0 ? (
                  <div className="py-10 text-center text-xs text-[#9a9a9e]">右の「ブロックを追加」から作成してください</div>
                ) : (
                  panel.blocks.map((b) => (
                    <div
                      key={b.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelected(b.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setSelected(b.id) }}
                      className={`-mx-1 cursor-pointer rounded px-1 ${b.id === selected ? 'outline outline-2 outline-[#069e04]' : 'hover:outline hover:outline-1 hover:outline-[#9be39b]'}`}
                    >
                      <BlockView b={b} theme={theme} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-xs">
            <span className="font-bold">パネル {idx + 1} / {value.panels.length}</span>
            <button type="button" disabled={idx === 0} onClick={() => movePanel(idx - 1)} className="h-7 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">前に移動</button>
            <button type="button" disabled={idx === value.panels.length - 1} onClick={() => movePanel(idx + 1)} className="h-7 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">後に移動</button>
            <button type="button" disabled={value.panels.length >= 10} onClick={copyPanel} className="h-7 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">複製</button>
            <button type="button" disabled={value.panels.length >= 10} onClick={() => { setPanels([...value.panels, { blocks: [] }]); setPi(value.panels.length); setSelected(null) }} className="h-7 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">新規</button>
            <button type="button" disabled={value.panels.length <= 1} onClick={() => { setPanels(value.panels.filter((_, i) => i !== idx)); setPi(Math.max(0, idx - 1)); setSelected(null) }} className="h-7 rounded border border-[#e5451f] px-2 text-[#e5451f] hover:bg-[#fff5f3] disabled:border-[#cacace] disabled:text-[#9a9a9e]">削除</button>
          </div>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-2 text-sm font-bold">ブロック設定</span>
            <button type="button" onClick={undo} disabled={past.current.length === 0} className="h-8 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">元に戻す</button>
            <button type="button" onClick={redo} disabled={future.current.length === 0} className="h-8 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">やり直し</button>
            <button type="button" disabled={sel <= 0} onClick={() => moveBlock(sel - 1)} className="h-8 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">上に移動</button>
            <button type="button" disabled={sel < 0 || sel >= panel.blocks.length - 1} onClick={() => moveBlock(sel + 1)} className="h-8 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">下に移動</button>
            <button type="button" disabled={!block} onClick={() => { if (!block) return; const c = { ...block, id: newId() } as FlexBlock; const next = [...panel.blocks]; next.splice(sel + 1, 0, c); setBlocks(next); setSelected(c.id) }} className="h-8 rounded border border-[#cacace] px-2 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">複製</button>
            <button type="button" disabled={!block} onClick={() => { setBlocks(panel.blocks.filter((_, i) => i !== sel)); setSelected(null) }} className="h-8 rounded border border-[#e5451f] px-2 text-[#e5451f] hover:bg-[#fff5f3] disabled:border-[#cacace] disabled:text-[#9a9a9e]">削除</button>
            <span className="relative ml-auto">
              <button type="button" onClick={() => setAddOpen((v) => !v)} className="h-8 rounded bg-[#069e04] px-3 font-bold text-white hover:bg-[#058503]">＋ ブロックを追加 ▾</button>
              {addOpen ? (
                <ul className="absolute right-0 z-20 mt-1 w-36 rounded border border-[#cacace] bg-white py-1 shadow-lg">
                  {(['image', 'title', 'text', 'button', 'video'] as const).map((t) => (
                    <li key={t}>
                      <button type="button" onClick={() => addBlock(t)} className="w-full px-3 py-1.5 text-left hover:bg-[#f7f7f9]">{BLOCK_LABEL[t]}</button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </span>
          </div>

          {panel.blocks.length === 0 ? <div className="rounded border border-dashed border-[#cacace] py-12 text-center text-xs text-[#9a9a9e]">右上の「＋ ブロックを追加」から作成してください</div> : null}

          <div className="space-y-2">
            {panel.blocks.map((b, i) => {
              const on = b.id === selected
              return (
                <div key={b.id} className={`rounded border ${on ? 'border-2 border-[#069e04]' : 'border-[#e3e3e6]'}`}>
                  <button type="button" onClick={() => setSelected(on ? null : b.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs">
                    <span className="rounded bg-[#069e04] px-2 py-0.5 font-bold text-white">{i + 1} {BLOCK_LABEL[b.type]}</span>
                    <span className="truncate text-[#757578]">
                      {b.type === 'title' ? b.title : b.type === 'text' ? b.text : b.type === 'button' ? b.label : ''}
                    </span>
                  </button>
                  {on ? (
                    <div className="space-y-3 border-t border-[#e3e3e6] p-3 text-xs">
                      {b.type === 'title' ? (
                        <>
                          <label className="block"><span className="mb-1 flex font-bold">タイトル<span className="ml-auto font-normal text-[#757578]">{b.title.length}/20</span></span><input value={b.title} maxLength={20} onChange={(e) => patchBlock({ title: e.target.value } as Partial<FlexBlock>)} className={fieldCls} aria-label="タイトル" /></label>
                          <label className="block"><span className="mb-1 block font-bold">サブタイトル</span><input value={b.subtitle ?? ''} maxLength={100} onChange={(e) => patchBlock({ subtitle: e.target.value } as Partial<FlexBlock>)} className={fieldCls} aria-label="サブタイトル" /></label>
                        </>
                      ) : null}
                      {b.type === 'text' ? (
                        <>
                          <MessageField label="テキスト" required value={b.text} onChange={(text) => patchBlock({ text } as Partial<FlexBlock>)} maxLength={1000} rows={5} toolbar={['name', 'friend', 'emoji']} />
                          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!b.border} onChange={(e) => patchBlock({ border: e.target.checked } as Partial<FlexBlock>)} className="accent-[#069e04]" />囲み</label>
                        </>
                      ) : null}
                      {b.type === 'button' ? (
                        <>
                          <label className="block"><span className="mb-1 flex font-bold">ボタン名<span className="ml-auto font-normal text-[#757578]">{b.label.length}/30</span></span><input value={b.label} maxLength={30} onChange={(e) => patchBlock({ label: e.target.value } as Partial<FlexBlock>)} className={fieldCls} aria-label="ボタン名" /></label>
                          <div><div className="mb-1 font-bold">アクション</div><ActionField value={b.action} onChange={(action) => patchBlock({ action } as Partial<FlexBlock>)} env={env} /></div>
                          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!b.styled} onChange={(e) => patchBlock({ styled: e.target.checked } as Partial<FlexBlock>)} className="accent-[#069e04]" />ボタンスタイル</label>
                        </>
                      ) : null}
                      {b.type === 'image' ? (
                        <>
                          <div className="flex items-center gap-3">
                            {b.url ? <img src={b.url} alt="" className="h-14 w-20 rounded border border-[#cacace] object-cover" /> : null}
                            <button type="button" onClick={() => setPicker({ id: b.id, field: 'url' })} className={btnLine}>{b.url ? '画像を変更' : '画像を選択'}</button>
                          </div>
                          <label className="block"><span className="mb-1 block font-bold">形状</span>
                            <select value={b.shape ?? 'fit'} onChange={(e) => patchBlock({ shape: e.target.value as 'fit' } as Partial<FlexBlock>)} className={selectCls} aria-label="形状">
                              {SHAPES.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
                            </select>
                          </label>
                          <label className="block"><span className="mb-1 block font-bold">タイトル</span><input value={b.title ?? ''} onChange={(e) => patchBlock({ title: e.target.value } as Partial<FlexBlock>)} className={fieldCls} aria-label="画像のタイトル" /></label>
                          <label className="block"><span className="mb-1 block font-bold">サブタイトル</span><input value={b.subtitle ?? ''} onChange={(e) => patchBlock({ subtitle: e.target.value } as Partial<FlexBlock>)} className={fieldCls} aria-label="画像のサブタイトル" /></label>
                          <div><div className="mb-1 font-bold">アクション</div><ActionField value={b.action} onChange={(action) => patchBlock({ action } as Partial<FlexBlock>)} env={env} /></div>
                          <label className="block"><span className="mb-1 block font-bold">アクションラベル</span><input value={b.actionLabel ?? ''} maxLength={12} onChange={(e) => patchBlock({ actionLabel: e.target.value } as Partial<FlexBlock>)} className={fieldCls} aria-label="アクションラベル" /></label>
                        </>
                      ) : null}
                      {b.type === 'video' ? (
                        <>
                          <div className="flex items-center gap-3">
                            <button type="button" onClick={() => setPicker({ id: b.id, field: 'video' })} className={btnLine}>{b.url ? '動画を変更' : '動画を選択'}</button>
                            {b.url ? <span className="text-[#757578]">選択済み</span> : null}
                          </div>
                          <div className="flex items-center gap-3">
                            {b.previewUrl ? <img src={b.previewUrl} alt="" className="h-12 rounded border border-[#cacace]" /> : null}
                            <button type="button" onClick={() => setPicker({ id: b.id, field: 'previewUrl' })} className={btnLine}>サムネイルを選択</button>
                          </div>
                          <div><div className="mb-1 font-bold">アクション</div><ActionField value={b.action} onChange={(action) => patchBlock({ action } as Partial<FlexBlock>)} env={env} /></div>
                        </>
                      ) : null}
                      {b.type !== 'button' && b.type !== 'image' && b.type !== 'video' ? <ColorField label="背景" value={b.background} onChange={(background) => patchBlock({ background })} /> : null}
                      {b.type === 'button' ? <ColorField label="背景" value={b.background} onChange={(background) => patchBlock({ background })} /> : null}
                      <label className="flex items-center gap-2"><span className="w-12 font-bold">余白</span>
                        <select value={b.margin ?? 'md'} onChange={(e) => patchBlock({ margin: e.target.value as 'md' })} className="h-8 rounded border border-[#cacace] bg-white px-2" aria-label="余白">
                          {MARGINS.map((m) => (<option key={m.id} value={m.id}>{m.label}</option>))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <MessageField
        label="PC版・通知欄での代替テキスト"
        value={value.altText ?? ''}
        onChange={(altText) => commit({ ...value, altText })}
        maxLength={400}
        rows={3}
        toolbar={['name', 'friend', 'emoji']}
        placeholder="[LINEアプリよりご覧下さい]"
      />

      <MediaDialog
        open={!!picker}
        kind={picker?.field === 'video' ? 'video' : 'image'}
        onClose={() => setPicker(null)}
        onPick={(m) => {
          if (!picker) return
          const field = picker.field === 'video' ? 'url' : picker.field
          setBlocks(panel.blocks.map((b) => (b.id === picker.id ? ({ ...b, [field]: m.url } as FlexBlock) : b)))
          setPicker(null)
        }}
      />
    </div>
  )
}
