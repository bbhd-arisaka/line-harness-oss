'use client'

import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { api } from '@/lib/api'
import { errorText } from '@/lib/error-text'
import type { TemplateSender } from '@/lib/template-library'

/**
 * 「公式アイコンで送信 [変更 >]」と「送信時のアイコンの上書きを許可する」。
 * 変更 → ダイアログ「送信名・アイコンを選択」: 公式アカウント(既定)と、登録した送信名・アイコン。[＋新しく登録]。
 */
export default function SenderField({
  accountId,
  senderId,
  onSender,
  allowOverride,
  onAllowOverride,
  accountName,
  accountIcon,
}: {
  accountId: string
  senderId: string | null
  onSender: (id: string | null) => void
  allowOverride: boolean
  onAllowOverride: (v: boolean) => void
  accountName?: string
  accountIcon?: string | null
}) {
  const [senders, setSenders] = useState<TemplateSender[]>([])
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<string | null>(senderId)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!accountId) return
    api.tpl.senders(accountId).then((r) => { if (r.success) setSenders(r.data) }).catch(() => {})
  }, [accountId])

  const current = senders.find((s) => s.id === senderId) ?? null
  const choiceSender = senders.find((s) => s.id === choice) ?? null

  const Avatar = ({ src }: { src: string | null | undefined }) =>
    src ? <img src={src} alt="" className="h-6 w-6 rounded-full object-cover" /> : <span className="h-6 w-6 rounded-full bg-[#e3e3e6]" />

  async function uploadIcon(file: File) {
    setBusy(true)
    setError('')
    try {
      const res = await api.uploads.image(file)
      if (res.success) setIcon(res.data.url)
      else setError('アイコンをアップロードできませんでした')
    } catch (err) {
      setError(errorText(err, 'アイコンをアップロードできませんでした'))
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    setBusy(true)
    setError('')
    try {
      const res = await api.tpl.createSender(accountId, name.trim(), icon)
      if (res.success) {
        setSenders((prev) => [...prev, res.data])
        setChoice(res.data.id)
        setCreating(false)
        setName('')
        setIcon(null)
      }
    } catch (err) {
      setError(errorText(err, '登録できませんでした'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => { setChoice(senderId); setOpen(true) }}
        className="flex h-10 w-full max-w-[22rem] items-center justify-between rounded border border-[#cacace] bg-white px-3 text-sm hover:bg-[#f7f7f9]"
      >
        <span className="flex items-center gap-2">
          <Avatar src={current ? current.iconUrl : accountIcon} />
          {current ? `${current.name}で送信` : '公式アイコンで送信'}
        </span>
        <span className="text-xs text-[#757578]">変更 ›</span>
      </button>
      <label className="mt-2 flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={allowOverride} onChange={(e) => onAllowOverride(e.target.checked)} className="accent-[#069e04]" />
        送信時のアイコンの上書きを許可する
      </label>

      <Modal open={open} onClose={() => setOpen(false)} maxWidthClass="max-w-lg" align="center">
        <div className="flex items-center justify-between border-b border-[#e3e3e6] px-5 py-3">
          <h2 className="text-sm font-bold">送信名・アイコンを選択</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="閉じる" className="text-xl leading-none">×</button>
        </div>
        <div className="space-y-2 px-5 py-4">
          {error ? <p className="text-sm text-[#e5451f]">{error}</p> : null}
          <button type="button" onClick={() => setChoice(null)} className={`flex w-full items-center gap-2 rounded border px-3 py-2 text-sm ${choice === null ? 'border-[#f2a100] bg-[#fff4de]' : 'border-[#e3e3e6] hover:bg-[#f7f7f9]'}`}>
            <Avatar src={accountIcon} />
            公式アカウント{accountName ? `(${accountName})` : ''}
          </button>
          {senders.map((s) => (
            <div key={s.id} className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${choice === s.id ? 'border-[#f2a100] bg-[#fff4de]' : 'border-[#e3e3e6] hover:bg-[#f7f7f9]'}`}>
              <button type="button" onClick={() => setChoice(s.id)} className="flex flex-1 items-center gap-2 text-left">
                <Avatar src={s.iconUrl} />
                {s.name}
              </button>
              <button
                type="button"
                aria-label={`${s.name}を削除`}
                onClick={async () => {
                  await api.tpl.deleteSender(s.id).catch(() => {})
                  setSenders((prev) => prev.filter((x) => x.id !== s.id))
                  if (choice === s.id) setChoice(null)
                }}
                className="px-1 text-[#e5451f]"
              >
                ×
              </button>
            </div>
          ))}
          {creating ? (
            <div className="space-y-2 rounded border border-[#cacace] p-3 text-xs">
              <label className="block">
                <span className="mb-1 block font-bold">送信名(20文字まで)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} className="h-9 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]" />
              </label>
              <div className="flex items-center gap-3">
                <Avatar src={icon} />
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadIcon(f); e.target.value = '' }} />
                <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="h-8 rounded border border-[#cacace] px-3 hover:bg-[#f7f7f9]">アイコンを選ぶ</button>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCreating(false)} className="h-8 rounded border border-[#cacace] px-3">キャンセル</button>
                <button type="button" disabled={busy || !name.trim()} onClick={() => void create()} className="h-8 rounded bg-[#069e04] px-3 font-bold text-white disabled:bg-[#cacace]">登録</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setCreating(true)} className="h-10 w-full rounded border border-[#cacace] text-sm hover:bg-[#f7f7f9]">＋ 新しく登録</button>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-[#e3e3e6] px-5 py-3 text-xs">
          <span className="flex items-center gap-2">選択中: <Avatar src={choiceSender ? choiceSender.iconUrl : accountIcon} /> {choiceSender ? choiceSender.name : '公式アカウント'}</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="h-9 w-24 rounded border border-[#cacace] bg-white hover:bg-[#f7f7f9]">キャンセル</button>
            <button type="button" onClick={() => { onSender(choice); setOpen(false) }} className="h-9 w-24 rounded bg-[#069e04] font-bold text-white hover:bg-[#058503]">決定</button>
          </span>
        </div>
      </Modal>
    </div>
  )
}
