'use client'

import { useEffect, useRef, useState } from 'react'
import type { LocationData } from '@line-crm/shared'
import MessageField from '../message-field'
import { btnLine, fieldCls } from './types'
import type { TabProps } from './types'

const TILE = 256
const toWorld = (lat: number, lng: number, z: number) => {
  const s = TILE * 2 ** z
  const x = ((lng + 180) / 360) * s
  const sin = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s
  return { x, y }
}
const fromWorld = (x: number, y: number, z: number) => {
  const s = TILE * 2 ** z
  const lng = (x / s) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / s
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat, lng }
}

/** OpenStreetMap の地図。ドラッグで動かし、クリックでピンを置く。右上の＋−で拡大・縮小 */
function PinMap({ lat, lng, onPin }: { lat: number | null; lng: number | null; onPin: (lat: number, lng: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 600, h: 320 })
  const [zoom, setZoom] = useState(lat != null ? 16 : 5)
  const [center, setCenter] = useState({ lat: lat ?? 35.681236, lng: lng ?? 139.767125 })
  const drag = useRef<{ x: number; y: number; moved: boolean; cx: number; cy: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // 外から座標が変わったら(住所検索)その場所へ
  const lastPin = useRef<string>('')
  useEffect(() => {
    if (lat == null || lng == null) return
    const key = `${lat},${lng}`
    if (key === lastPin.current) return
    lastPin.current = key
    setCenter({ lat, lng })
  }, [lat, lng])

  const c = toWorld(center.lat, center.lng, zoom)
  const left = c.x - size.w / 2
  const top = c.y - size.h / 2
  const max = 2 ** zoom
  const tiles: Array<{ key: string; x: number; y: number; tx: number; ty: number }> = []
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size.h) / TILE); ty++) {
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size.w) / TILE); tx++) {
      if (ty < 0 || ty >= max) continue
      tiles.push({ key: `${zoom}/${tx}/${ty}`, x: tx * TILE - left, y: ty * TILE - top, tx: ((tx % max) + max) % max, ty })
    }
  }
  const pin = lat != null && lng != null ? toWorld(lat, lng, zoom) : null

  return (
    <div
      ref={ref}
      className="relative h-80 w-full touch-none select-none overflow-hidden rounded border border-[#cacace] bg-[#e5e3df]"
      onPointerDown={(e) => {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, moved: false, cx: c.x, cy: c.y }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
        if (d.moved) setCenter(fromWorld(d.cx - dx, d.cy - dy, zoom))
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        if (!d || d.moved) return
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const p = fromWorld(left + (e.clientX - r.left), top + (e.clientY - r.top), zoom)
        onPin(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)))
      }}
    >
      {tiles.map((t) => (
        <img key={t.key} src={`https://tile.openstreetmap.org/${zoom}/${t.tx}/${t.ty}.png`} alt="" draggable={false} className="pointer-events-none absolute" style={{ left: t.x, top: t.y, width: TILE, height: TILE }} />
      ))}
      {pin ? (
        <svg className="pointer-events-none absolute" width="28" height="36" viewBox="0 0 28 36" style={{ left: pin.x - left - 14, top: pin.y - top - 34 }}>
          <path d="M14 0C6.3 0 0 6.2 0 13.9 0 24 14 36 14 36s14-12 14-22.1C28 6.2 21.7 0 14 0z" fill="#e5451f" stroke="#fff" strokeWidth="2" />
          <circle cx="14" cy="14" r="5" fill="#fff" />
        </svg>
      ) : null}
      <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded border border-[#cacace] bg-white shadow">
        <button type="button" aria-label="拡大" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => setZoom((z) => Math.min(19, z + 1))} className="h-8 w-8 text-lg hover:bg-[#f7f7f9]">＋</button>
        <button type="button" aria-label="縮小" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => setZoom((z) => Math.max(2, z - 1))} className="h-8 w-8 border-t border-[#cacace] text-lg hover:bg-[#f7f7f9]">−</button>
      </div>
      <span className="pointer-events-none absolute bottom-0 right-0 bg-white/80 px-1 text-[10px] text-[#414143]">© OpenStreetMap contributors</span>
    </div>
  )
}

/** 位置情報: タイトル・住所(住所から地図を検索できる)・地図のピン */
export default function LocationEditor({ value, onChange }: TabProps<LocationData>) {
  const [query, setQuery] = useState(value.address)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function search() {
    const q = query.trim()
    if (!q) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ja&q=${encodeURIComponent(q)}`)
      const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
      if (!rows.length) {
        setError('場所が見つかりませんでした')
        return
      }
      onChange({ ...value, address: value.address || q, latitude: Number(rows[0].lat), longitude: Number(rows[0].lon) })
    } catch {
      setError('住所を検索できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <label className="block text-xs">
        <span className="mb-1 flex items-center gap-1.5 font-bold">
          タイトル <span className="rounded-sm bg-[#e5451f] px-1 py-0.5 text-[10px] text-white">必須</span>
          <span className="ml-auto font-normal text-[#757578]">{value.title.length}/100</span>
        </span>
        <input value={value.title} maxLength={100} onChange={(e) => onChange({ ...value, title: e.target.value })} className={fieldCls} aria-label="タイトル" />
      </label>

      <div>
        <div className="mb-1 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search() } }}
            placeholder="住所や場所の名前で地図を検索"
            className={fieldCls}
            aria-label="地図を検索"
          />
          <button type="button" disabled={busy} onClick={() => void search()} className={`${btnLine} flex-shrink-0 disabled:opacity-50`}>検索</button>
        </div>
        {error ? <p className="mb-1 text-xs text-[#e5451f]">{error}</p> : null}
        <PinMap lat={value.latitude} lng={value.longitude} onPin={(latitude, longitude) => onChange({ ...value, latitude, longitude })} />
      </div>

      <MessageField
        label="表示する住所"
        required
        value={value.address}
        onChange={(address) => onChange({ ...value, address })}
        maxLength={100}
        rows={3}
        toolbar={['emoji']}
      />
    </div>
  )
}
