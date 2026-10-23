'use client'

import { useRef, useState } from 'react'
import { fetchApi, ApiError } from '@/lib/api'
import { FieldValue } from './field-value'

/**
 * 友だち情報の「画像」「PDF」項目の値。サムネイル(PDFはリンク)と、ファイルの選択・差し替え・削除。
 * 選んだファイルはその場でアップロードされ、友だち情報に保存される。
 */
export function FieldFileInput({
  friendId,
  fieldKey,
  fieldType,
  value,
  onChanged,
}: {
  friendId: string
  fieldKey: string
  fieldType: 'image' | 'pdf'
  value: unknown
  onChanged: (url: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hasValue = typeof value === 'string' && value !== ''

  async function upload(file: File) {
    setBusy(true)
    setError('')
    try {
      const res = await fetchApi<{ success: boolean; data: { url: string } }>(
        `/api/friends/${friendId}/field-image?key=${encodeURIComponent(fieldKey)}`,
        { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: file },
      )
      onChanged(res.data.url)
    } catch (e) {
      setError(e instanceof ApiError && e.serverMessage ? e.serverMessage : 'アップロードできませんでした')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await fetchApi(`/api/friends/${friendId}/metadata`, { method: 'PUT', body: JSON.stringify({ [fieldKey]: null }) })
      onChanged(null)
    } catch (e) {
      setError(e instanceof ApiError && e.serverMessage ? e.serverMessage : '削除できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5">
      {hasValue && <FieldValue value={value} />}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={inputRef}
          type="file"
          accept={fieldType === 'pdf' ? 'application/pdf' : 'image/*'}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-7 items-center rounded border border-gray-300 bg-white px-2.5 text-[11px] hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? '…' : hasValue ? '差し替え' : fieldType === 'pdf' ? 'PDFを選択' : '画像を選択'}
        </button>
        {hasValue && !busy && (
          <button type="button" onClick={() => void remove()} className="inline-flex h-7 items-center rounded px-2 text-[11px] text-red-600 hover:bg-red-50">
            削除
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
