'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Modal } from '@/components/ui/modal'
import { useDialogs } from '@/components/ui/dialogs'

export interface MediaItem {
  key: string
  url: string
  name: string
  mimeType: string
  size: number
  uploadedAt: string
}

function formatSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

/** 登録メディアの一覧・アップロード・削除(登録メディア一覧の画面と、選択ポップアップで共通)。 */
export function useMedia() {
  const dialogs = useDialogs()
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api.media.list()
      if (res.success) setItems(res.data)
      else setError('読み込みに失敗しました')
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function upload(files: FileList | File[]): Promise<MediaItem[]> {
    const uploaded: MediaItem[] = []
    setUploading(true)
    setError('')
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) { setError(`「${file.name}」は10MBを超えています`); continue }
        const res = await api.uploads.image(file)
        if (!res.success) { setError(`「${file.name}」のアップロードに失敗しました(画像はpng/jpg/gif/webpのみ)`); continue }
        uploaded.push({ key: res.data.key, url: res.data.url, name: file.name, mimeType: res.data.mimeType, size: res.data.size, uploadedAt: new Date().toISOString() })
      }
      await load()
    } finally {
      setUploading(false)
    }
    return uploaded
  }

  async function remove(item: MediaItem): Promise<boolean> {
    const ok = await dialogs.confirm(
      `「${item.name}」を削除しますか?\nこの画像を使っている配信・フォーム等では表示されなくなります。`,
      { title: 'メディアの削除', okLabel: '削除', danger: true },
    )
    if (!ok) return false
    await api.media.delete(item.key)
    await load()
    return true
  }

  return { items, loading, uploading, error, upload, remove, reload: load }
}

function Grid({
  items,
  selectedUrl,
  onPick,
  onDelete,
}: {
  items: MediaItem[]
  selectedUrl?: string
  onPick?: (m: MediaItem) => void
  onDelete?: (m: MediaItem) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((m) => (
        <div
          key={m.key}
          className={`group relative overflow-hidden rounded border bg-white ${selectedUrl === m.url ? 'border-2 border-[#069e04]' : 'border-[#dcdce0]'}`}
        >
          <button type="button" onClick={() => onPick?.(m)} className="block w-full" title={m.name}>
            <span className="flex h-32 items-center justify-center bg-[#f4f4f4]">
              <img src={m.url} alt={m.name} loading="lazy" className="max-h-32 max-w-full object-contain" />
            </span>
            <span className="block truncate px-2 pt-1.5 text-left text-xs font-bold">{m.name}</span>
            <span className="block px-2 pb-1.5 text-left text-[11px] text-[#757578]">
              {formatSize(m.size)} ・ {new Date(m.uploadedAt).toLocaleDateString('ja-JP')}
            </span>
          </button>
          {onDelete && (
            <button
              type="button"
              aria-label={`${m.name}を削除`}
              onClick={() => onDelete(m)}
              className="absolute right-1 top-1 hidden h-6 w-6 rounded-full bg-white/90 text-sm text-[#e5451f] shadow group-hover:block"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function UploadButton({ uploading, onFiles }: { uploading: boolean; onFiles: (f: FileList) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files && e.target.files.length > 0) onFiles(e.target.files); e.target.value = '' }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => ref.current?.click()}
        className="inline-flex h-9 items-center gap-1 rounded bg-[#069e04] px-4 text-xs font-bold text-white hover:bg-[#058503] disabled:opacity-60"
      >
        <span className="text-base leading-none">＋</span> {uploading ? 'アップロード中...' : '画像をアップロード'}
      </button>
    </>
  )
}

/** 画像を選ぶポップアップ(フォームの画像ブロックなどから開く)。 */
export function MediaPickerModal({
  open,
  selectedUrl,
  onClose,
  onPick,
}: {
  open: boolean
  selectedUrl?: string
  onClose: () => void
  onPick: (m: MediaItem) => void
}) {
  const media = useMedia()
  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-4xl">
      <div className="flex items-center justify-between border-b border-[#e3e3e6] px-6 py-4">
        <h2 className="text-base font-bold text-[#069e04]">メディアを選択</h2>
        <div className="flex items-center gap-3">
          <UploadButton
            uploading={media.uploading}
            onFiles={async (files) => {
              const uploaded = await media.upload(files)
              if (uploaded.length === 1) onPick(uploaded[0])
            }}
          />
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-2xl leading-none">×</button>
        </div>
      </div>
      <div className="max-h-[calc(100vh-14rem)] min-h-[16rem] overflow-y-auto bg-[#f7f7f9] p-5">
        {media.error && <p className="mb-3 text-sm text-[#e5451f]">{media.error}</p>}
        {media.loading ? (
          <p className="py-10 text-center text-sm text-[#757578]">読み込み中...</p>
        ) : media.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-[#757578]">登録されているメディアがありません。「画像をアップロード」から追加してください。</p>
        ) : (
          <Grid items={media.items} selectedUrl={selectedUrl} onPick={onPick} />
        )}
      </div>
      <div className="flex justify-end border-t border-[#e3e3e6] px-6 py-3">
        <button type="button" onClick={onClose} className="h-10 w-28 rounded border border-[#cacace] bg-white text-sm hover:bg-[#f7f7f9]">閉じる</button>
      </div>
    </Modal>
  )
}

/** 登録メディア一覧の画面本体。 */
export function MediaLibrary() {
  const media = useMedia()
  const dialogs = useDialogs()
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#757578]">{media.loading ? '' : `${media.items.length}件`}</p>
        <UploadButton uploading={media.uploading} onFiles={(f) => void media.upload(f)} />
      </div>
      {media.error && <p className="mb-3 text-sm text-[#e5451f]">{media.error}</p>}
      {media.loading ? (
        <p className="py-10 text-center text-sm text-[#757578]">読み込み中...</p>
      ) : media.items.length === 0 ? (
        <p className="border-y border-[#e3e3e6] py-10 text-center text-sm text-[#757578]">登録されているメディアがありません</p>
      ) : (
        <Grid
          items={media.items}
          onPick={(m) => { void navigator.clipboard?.writeText(m.url).then(() => dialogs.alert('画像のURLをコピーしました。')) }}
          onDelete={(m) => void media.remove(m)}
        />
      )}
    </div>
  )
}
