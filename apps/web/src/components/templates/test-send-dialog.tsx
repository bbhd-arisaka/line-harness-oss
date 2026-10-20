'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Modal } from '@/components/ui/modal'
import { api } from '@/lib/api'
import { errorText } from '@/lib/error-text'

interface Candidate {
  id: string
  displayName: string
  pictureUrl: string | null
  recent: boolean
}

/** テスト送信: 前回使った友だち→登録済みのテスト送信先、から選んで送る(Lステップの「テスト送信アカウントの選択」) */
export default function TestSendDialog({
  open,
  accountId,
  onClose,
  onSend,
}: {
  open: boolean
  accountId: string
  onClose: () => void
  onSend: (friendIds: string[]) => Promise<{ sent: number; failed: number }>
}) {
  const [list, setList] = useState<Candidate[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !accountId) return
    setResult('')
    setError('')
    api.accountSettings
      .getTestRecipientsWithHistory(accountId)
      .then((r) => {
        if (!r.success) return
        setList(r.data)
        setPicked(new Set(r.data.filter((c) => c.recent).map((c) => c.id)))
      })
      .catch(() => setList([]))
  }, [open, accountId])

  async function send() {
    setBusy(true)
    setError('')
    setResult('')
    try {
      const r = await onSend([...picked])
      setResult(r.failed > 0 ? `${r.sent}人に送信、${r.failed}人は送れませんでした` : `${r.sent}人に送信しました`)
    } catch (err) {
      setError(errorText(err, '送信できませんでした'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose() }} maxWidthClass="max-w-md" align="center">
      <div className="flex items-center justify-between border-b border-[#e3e3e6] px-5 py-3">
        <h2 className="text-sm font-bold">テスト送信</h2>
        <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl leading-none">×</button>
      </div>
      <div className="max-h-[22rem] space-y-1 overflow-y-auto px-5 py-4">
        {list === null ? <p className="text-sm text-[#757578]">読み込み中...</p> : null}
        {list && list.length === 0 ? (
          <p className="text-sm text-[#757578]">
            テスト送信先がありません。<Link href="/accounts" className="text-[#2b7bb9] underline">公式アカウント設定</Link>で登録してください。
          </p>
        ) : null}
        {(list ?? []).map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[#f7f7f9]">
            <input
              type="checkbox"
              checked={picked.has(c.id)}
              onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n })}
              className="accent-[#069e04]"
            />
            {c.pictureUrl ? <img src={c.pictureUrl} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="h-7 w-7 rounded-full bg-[#e3e3e6]" />}
            <span className="min-w-0 flex-1 truncate">{c.displayName}</span>
            {c.recent ? <span className="rounded-sm bg-[#f1f1f4] px-1 text-[10px] text-[#757578]">前回</span> : null}
          </label>
        ))}
        {result ? <p className="pt-2 text-sm font-bold text-[#069e04]">{result}</p> : null}
        {error ? <p className="pt-2 text-sm text-[#e5451f]">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-[#e3e3e6] px-5 py-3">
        <button type="button" onClick={onClose} className="h-9 w-24 rounded border border-[#cacace] bg-white text-xs hover:bg-[#f7f7f9]">閉じる</button>
        <button type="button" disabled={busy || picked.size === 0} onClick={() => void send()} className="h-9 w-24 rounded bg-[#069e04] text-xs font-bold text-white hover:bg-[#058503] disabled:bg-[#cacace]">送信</button>
      </div>
    </Modal>
  )
}
