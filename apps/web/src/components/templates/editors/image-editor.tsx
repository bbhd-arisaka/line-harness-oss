'use client'

import { useRef, useState } from 'react'
import { IMAGE_LAYOUT_LABELS, imageLayoutAreas } from '@line-crm/shared'
import type { ImageArea, ImageData, ImageLayout } from '@line-crm/shared'
import MediaDialog from '../media-dialog'
import MessageField from '../message-field'
import UrlSettingsSection from '../url-settings'
import { btnLine, fieldCls } from './types'
import type { TabProps } from './types'

const AREA_COLORS = ['#d9636b', '#5d4f92', '#f2a94b', '#3e9b78', '#c05599', '#3a8fd1']

const LAYOUTS: Array<{ id: ImageLayout; label: string }> = [
  { id: 'none', label: 'なし' },
  { id: 'link1', label: 'リンク1' },
  { id: 'link2', label: 'リンク2' },
  { id: 'link3', label: 'リンク3' },
  { id: 'link4', label: 'リンク4' },
  { id: 'link5', label: 'リンク5' },
  { id: 'link6', label: 'リンク6' },
  { id: 'link7', label: 'リンク7' },
  { id: 'link8', label: 'リンク8' },
  { id: 'custom', label: 'カスタム' },
]

/** 画像リンクの形の見本(Lステップと同じ並び・色) */
function LayoutThumb({ layout }: { layout: ImageLayout }) {
  if (layout === 'none') {
    return <div className="flex h-14 w-14 items-center justify-center rounded border border-[#cacace] bg-white text-lg text-[#9a9a9e]">⛓︎</div>
  }
  if (layout === 'custom') {
    return (
      <div className="relative h-14 w-14 rounded border border-dashed border-[#757578] bg-white">
        <div className="absolute inset-2 bg-[#d9636b]" />
      </div>
    )
  }
  const areas = imageLayoutAreas(layout)
  return (
    <div className="relative h-14 w-14 overflow-hidden rounded border border-[#cacace] bg-white">
      {areas.map(([x, y, w, h], i) => (
        <div
          key={i}
          className="absolute flex items-center justify-center text-[11px] font-bold text-white"
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, background: AREA_COLORS[i % AREA_COLORS.length], boxShadow: 'inset 0 0 0 1px #fff' }}
        >
          {IMAGE_LAYOUT_LABELS[i]}
        </div>
      ))}
    </div>
  )
}

function newArea(kind: ImageArea['kind'], rect: [number, number, number, number]): ImageArea {
  return { kind, url: '', text: '', x: rect[0], y: rect[1], w: rect[2], h: rect[3] }
}

/** カスタムの領域: プレビューの上で、ドラッグして動かし、右下の取っ手で大きさを変える */
function CustomAreas({ imageUrl, areas, onChange }: { imageUrl: string; areas: ImageArea[]; onChange: (a: ImageArea[]) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ i: number; mode: 'move' | 'resize'; sx: number; sy: number; area: ImageArea } | null>(null)

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    const el = box.current
    if (!d || !el) return
    const r = el.getBoundingClientRect()
    const dx = (e.clientX - d.sx) / r.width
    const dy = (e.clientY - d.sy) / r.height
    const next = areas.map((a, i) => {
      if (i !== d.i) return a
      if (d.mode === 'move') {
        return { ...a, x: Math.min(Math.max(0, d.area.x + dx), 1 - a.w), y: Math.min(Math.max(0, d.area.y + dy), 1 - a.h) }
      }
      return { ...a, w: Math.min(Math.max(0.05, d.area.w + dx), 1 - a.x), h: Math.min(Math.max(0.05, d.area.h + dy), 1 - a.y) }
    })
    onChange(next)
  }

  return (
    <div ref={box} className="relative w-full select-none overflow-hidden rounded border border-[#cacace]" onPointerMove={onMove} onPointerUp={() => { drag.current = null }} onPointerLeave={() => { drag.current = null }}>
      <img src={imageUrl} alt="" className="block w-full" draggable={false} />
      {areas.map((a, i) => (
        <div
          key={i}
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { i, mode: 'move', sx: e.clientX, sy: e.clientY, area: a } }}
          className="absolute cursor-move border-2 border-dashed border-white"
          style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%`, background: `${AREA_COLORS[i % AREA_COLORS.length]}99` }}
        >
          <span className="absolute left-1 top-0.5 text-xs font-bold text-white">{IMAGE_LAYOUT_LABELS[i]}</span>
          <span
            onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { i, mode: 'resize', sx: e.clientX, sy: e.clientY, area: a } }}
            className="absolute -bottom-1 -right-1 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-[#757578] bg-white"
          />
        </div>
      ))}
    </div>
  )
}

/** 画像: 画像の選択+プレビュー・リンク設定(なし/リンク1〜8/カスタム)・領域ごとの動作・PC版の代替テキスト・URL設定 */
export default function ImageEditor({ value, onChange, env }: TabProps<ImageData>) {
  const [picker, setPicker] = useState(false)
  const areas = value.areas ?? []

  const setLayout = (layout: ImageLayout) => {
    if (layout === value.layout) return
    if (layout === 'none') return onChange({ ...value, layout, areas: [] })
    if (layout === 'custom') return onChange({ ...value, layout, areas: [newArea('none', [0.1, 0.1, 0.5, 0.4])] })
    // 形を変えても、同じ番号の領域の設定(URL・文章)は引き継ぐ
    onChange({ ...value, layout, areas: imageLayoutAreas(layout).map((rect, i) => ({ ...newArea(areas[i]?.kind ?? 'none', rect), url: areas[i]?.url ?? '', text: areas[i]?.text ?? '' })) })
  }
  const setArea = (i: number, patch: Partial<ImageArea>) => onChange({ ...value, areas: areas.map((a, j) => (j === i ? { ...a, ...patch } : a)) })

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="space-y-5">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-bold">
              画像をアップロード、または選択する <span className="rounded-sm bg-[#e5451f] px-1 py-0.5 text-[10px] text-white">必須</span>
            </div>
            <button type="button" onClick={() => setPicker(true)} className={btnLine}>画像を選択する</button>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-bold">リンク設定</h3>
            <p className="mb-2 text-xs text-[#757578]">画像領域に対するリンクを設定することができます。</p>
            <div className="flex flex-wrap gap-3">
              {LAYOUTS.map((l) => (
                <label key={l.id} className="flex cursor-pointer flex-col items-center gap-1 text-xs">
                  <LayoutThumb layout={l.id} />
                  <span className="flex items-center gap-1">
                    <input type="radio" name="image-layout" checked={value.layout === l.id} onChange={() => setLayout(l.id)} className="accent-[#069e04]" />
                    {l.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {value.layout === 'custom' && value.imageUrl ? (
            <div>
              <CustomAreas imageUrl={value.imageUrl} areas={areas} onChange={(a) => onChange({ ...value, areas: a })} />
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={areas.length >= 6} onClick={() => onChange({ ...value, areas: [...areas, newArea('none', [0.2, 0.2, 0.4, 0.3])] })} className={btnLine}>＋ 領域を追加</button>
                {areas.length > 1 ? <button type="button" onClick={() => onChange({ ...value, areas: areas.slice(0, -1) })} className="h-9 rounded border border-[#cacace] px-4 text-xs hover:bg-[#f7f7f9]">最後の領域を削除</button> : null}
              </div>
            </div>
          ) : null}

          {areas.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {areas.map((a, i) => (
                <div key={i} className="rounded border border-[#e3e3e6]">
                  <div className="flex items-center gap-1.5 bg-[#f1f1f4] px-3 py-2 text-xs font-bold">
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ background: AREA_COLORS[i % AREA_COLORS.length] }} />
                    領域{IMAGE_LAYOUT_LABELS[i]} <span className="rounded-sm bg-[#757578] px-1 py-0.5 text-[10px] font-bold text-white">短縮URL対応</span>
                  </div>
                  <div className="space-y-2 p-3 text-xs">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {([['none', '使用しない'], ['url', 'URLを開く'], ['message', 'ユーザーメッセージ送信']] as const).map(([k, l]) => (
                        <label key={k} className="flex items-center gap-1">
                          <input type="radio" name={`area-${i}`} checked={a.kind === k} onChange={() => setArea(i, { kind: k })} className="accent-[#069e04]" />
                          {l}
                        </label>
                      ))}
                    </div>
                    {a.kind === 'url' ? <input value={a.url ?? ''} onChange={(e) => setArea(i, { url: e.target.value })} placeholder="https://example.com" className={fieldCls} aria-label={`領域${IMAGE_LAYOUT_LABELS[i]}のURL`} /> : null}
                    {a.kind === 'message' ? (
                      <div>
                        <input value={a.text ?? ''} onChange={(e) => setArea(i, { text: e.target.value })} className={fieldCls} aria-label={`領域${IMAGE_LAYOUT_LABELS[i]}のユーザーメッセージ`} />
                        <p className="mt-1 text-[11px] text-[#757578]">ボタンを押したときに友だちの発言として送信される文章を設定します。</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <MessageField
            label="PC版・通知欄での代替テキスト"
            value={value.altText ?? ''}
            onChange={(altText) => onChange({ ...value, altText })}
            maxLength={400}
            rows={3}
            toolbar={['name', 'friend', 'emoji']}
            placeholder="[LINEアプリよりご覧下さい]"
            note="環境によって「スマートフォンでのみ確認可能なメッセージです。」などの文章が追加される場合があります。"
          />
        </div>

        <div>
          <h3 className="mb-1 text-xs font-bold">プレビュー</h3>
          <div className="relative overflow-hidden rounded border border-[#cacace] bg-[#f4f4f4]">
            {value.imageUrl ? (
              <>
                <img src={value.imageUrl} alt="" className="block w-full" />
                {value.layout !== 'custom'
                  ? areas.map((a, i) => (
                      <div key={i} className="absolute flex items-center justify-center border border-white text-sm font-bold text-white" style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%`, background: `${AREA_COLORS[i % AREA_COLORS.length]}88` }}>
                        {IMAGE_LAYOUT_LABELS[i]}
                      </div>
                    ))
                  : null}
              </>
            ) : (
              <div className="flex h-40 items-center justify-center text-xs text-[#9a9a9e]">未選択</div>
            )}
          </div>
        </div>
      </div>

      <UrlSettingsSection
        value={value.urlSettings}
        onChange={(urlSettings) => onChange({ ...value, urlSettings })}
        sourceText={() => areas.filter((a) => a.kind === 'url').map((a) => a.url ?? '').join('\n')}
        lookups={env.lookups}
        accountId={env.accountId}
      />

      <MediaDialog
        open={picker}
        kind="image"
        onClose={() => setPicker(false)}
        onPick={(m) => {
          onChange({ ...value, imageUrl: m.url, width: m.width, height: m.height })
          setPicker(false)
        }}
      />
    </div>
  )
}
