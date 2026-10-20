'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { api } from '@/lib/api'
import { errorText } from '@/lib/error-text'

export type MediaKind = 'image' | 'audio' | 'video'

export interface PickedMedia {
  key: string
  url: string
  name: string
  mimeType: string
  size: number
  /** 画像: 元画像の大きさ(画像リンクの領域の計算に使う) */
  width?: number
  height?: number
  /** 音声: ミリ秒 */
  durationMs?: number
}

interface MediaRow {
  key: string
  url: string
  name: string
  mimeType: string
  size: number
  uploadedAt: string
}

const ACCEPT: Record<MediaKind, string> = {
  image: 'image/png,image/jpeg,image/gif,image/webp',
  audio: 'audio/mp4,audio/x-m4a,audio/m4a,.m4a',
  video: 'video/mp4,.mp4',
}
const TITLE: Record<MediaKind, string> = { image: '画像を追加', audio: '音声を追加', video: '動画を追加' }
const PAGE = 8

const kindOf = (mime: string): MediaKind | null => (mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : null)

function imageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function audioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio()
    a.preload = 'metadata'
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : null)
    a.onerror = () => resolve(null)
    a.src = url
  })
}

/** ファイルの付加情報(画像の大きさ・音声の長さ)を読む */
async function describe(kind: MediaKind, m: MediaRow): Promise<PickedMedia> {
  const base: PickedMedia = { key: m.key, url: m.url, name: m.name, mimeType: m.mimeType, size: m.size }
  if (kind === 'image') {
    const s = await imageSize(m.url)
    return s ? { ...base, ...s } : base
  }
  if (kind === 'audio') {
    const d = await audioDuration(m.url)
    return d ? { ...base, durationMs: d } : base
  }
  return base
}

/**
 * Lステップの「画像を追加」ダイアログ(音声・動画も同じ形)。
 * タブ「新規アップロード」(ドロップ領域+ファイルを選択する)と「登録メディア」(検索・一覧・ページ送り。カードを押すと選択、プレビュー)。
 */
export default function MediaDialog({
  open,
  kind,
  onClose,
  onPick,
}: {
  open: boolean
  kind: MediaKind
  onClose: () => void
  onPick: (m: PickedMedia) => void
}) {
  const [tab, setTab] = useState<'upload' | 'library'>('upload')
  const [items, setItems] = useState<MediaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<MediaRow | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [lightbox, setLightbox] = useState<MediaRow | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.media.list()
      if (res.success) setItems(res.data.filter((m) => kindOf(m.mimeType) === kind))
    } catch (err) {
      setError(errorText(err, '読み込めませんでした'))
    } finally {
      setLoading(false)
    }
  }, [kind])

  useEffect(() => {
    if (!open) return
    setTab('upload')
    setSelected(null)
    setError('')
    setQuery('')
    setPage(1)
    void load()
  }, [open, load])

  const upload = async (files: FileList | File[]) => {
    const file = Array.from(files)[0]
    if (!file) return
    setError('')
    setUploading(true)
    try {
      if (kind === 'image') {
        if (file.size > 10 * 1024 * 1024) throw new Error('画像は10MBまでです')
        const res = await api.uploads.image(file)
        if (!res.success) throw new Error('アップロードできませんでした(png/jpg/gif/webp のみ)')
        setSelected({ key: res.data.key, url: res.data.url, name: file.name, mimeType: res.data.mimeType, size: res.data.size, uploadedAt: new Date().toISOString() })
      } else {
        const res = await api.uploads.mediaFile(file, kind)
        if (!res.success) throw new Error('アップロードできませんでした')
        setSelected({ key: res.data.key, url: res.data.url, name: file.name, mimeType: res.data.mimeType, size: res.data.size, uploadedAt: new Date().toISOString() })
      }
      await load()
    } catch (err) {
      setError(errorText(err, 'アップロードできませんでした'))
    } finally {
      setUploading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? items.filter((m) => m.name.toLowerCase().includes(q)) : items
  }, [items, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE))
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE)

  const decide = async () => {
    if (!selected) return
    onPick(await describe(kind, selected))
  }

  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-3xl" align="center">
      <div className="flex items-center justify-between border-b border-[#e3e3e6] px-5 py-3">
        <h2 className="text-sm font-bold">{TITLE[kind]}</h2>
        <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl leading-none">×</button>
      </div>
      <div className="px-5 pt-3">
        <div className="grid grid-cols-2 text-center text-xs">
          {(['upload', 'library'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`h-9 border border-[#cacace] ${tab === t ? 'border-b-2 border-b-[#069e04] bg-white font-bold' : 'bg-[#f1f1f4] text-[#757578]'}`}
            >
              {t === 'upload' ? '新規アップロード' : '登録メディア'}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-4" style={{ minHeight: 280 }}>
        {error ? <p className="mb-2 text-sm text-[#e5451f]">{error}</p> : null}
        {tab === 'upload' ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void upload(e.dataTransfer.files) }}
            className={`flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed px-4 py-10 text-center text-sm transition-colors ${dragOver ? 'border-[#069e04] bg-[#f3fbf3]' : 'border-[#cacace]'}`}
          >
            <p className="font-bold">ここにファイルをドロップ</p>
            <p className="text-xs text-[#757578]">または</p>
            <input ref={fileRef} type="file" accept={ACCEPT[kind]} className="hidden" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = '' }} />
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="h-9 rounded border border-[#069e04] px-4 text-xs font-bold text-[#069e04] hover:bg-[#f3fbf3] disabled:opacity-60">
              {uploading ? 'アップロード中...' : 'ファイルを選択する'}
            </button>
            {selected ? <p className="mt-2 text-xs text-[#069e04]">「{selected.name}」を選択しています</p> : null}
          </div>
        ) : (
          <div>
            <div className="mb-3 flex justify-center">
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1) }}
                placeholder="検索"
                aria-label="メディアを検索"
                className="h-9 w-64 rounded-full border border-[#cacace] px-4 text-sm outline-none focus:border-[#069e04]"
              />
            </div>
            {loading ? (
              <p className="py-10 text-center text-sm text-[#757578]">読み込み中...</p>
            ) : shown.length === 0 ? (
              <p className="py-10 text-center text-sm text-[#757578]">登録されているメディアがありません</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {shown.map((m) => (
                  <div
                    key={m.key}
                    onClick={() => setSelected(m)}
                    className={`group cursor-pointer rounded border bg-white p-1.5 text-[11px] ${selected?.key === m.key ? 'border-2 border-[#069e04]' : 'border-[#e3e3e6]'}`}
                  >
                    <div className="relative flex h-24 items-center justify-center overflow-hidden bg-[#f4f4f4]">
                      {kind === 'image' ? <img src={m.url} alt={m.name} loading="lazy" className="max-h-24 max-w-full object-contain" /> : <span className="text-2xl">{kind === 'audio' ? '🎤' : '🎬'}</span>}
                      {kind === 'image' ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setLightbox(m) }}
                          className="absolute inset-0 hidden items-center justify-center bg-black/50 text-xs font-bold text-white group-hover:flex"
                        >
                          プレビューを開く
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 break-all leading-4">{m.name}</p>
                  </div>
                ))}
              </div>
            )}
            {pageCount > 1 ? (
              <div className="mt-3 flex justify-center gap-1 text-xs">
                <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="h-7 w-7 rounded border border-[#cacace] disabled:opacity-40">‹</button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" onClick={() => setPage(n)} className={`h-7 w-7 rounded border ${n === page ? 'border-[#069e04] bg-[#069e04] font-bold text-white' : 'border-[#cacace]'}`}>{n}</button>
                ))}
                <button type="button" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)} className="h-7 w-7 rounded border border-[#cacace] disabled:opacity-40">›</button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-[#e3e3e6] px-5 py-3">
        <button type="button" onClick={onClose} className="h-9 w-24 rounded border border-[#cacace] bg-white text-xs hover:bg-[#f7f7f9]">閉じる</button>
        <button type="button" disabled={!selected} onClick={() => void decide()} className="h-9 w-24 rounded bg-[#069e04] text-xs font-bold text-white hover:bg-[#058503] disabled:bg-[#cacace]">決定</button>
      </div>

      {lightbox ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6" onClick={() => setLightbox(null)}>
          <img src={lightbox.url} alt={lightbox.name} className="max-h-full max-w-full rounded bg-white object-contain" />
        </div>
      ) : null}
    </Modal>
  )
}
