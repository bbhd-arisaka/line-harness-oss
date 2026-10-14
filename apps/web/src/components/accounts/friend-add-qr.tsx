'use client'

import { useState } from 'react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { api } from '@/lib/api'
import { copyText, qrFileName } from '@/lib/friend-add-qr'

/**
 * 友だち追加用の QR コードと URL(アカウントごと)。QR は画像として保存でき、URL はワンタップでコピーできる。
 * LINE から、この公式アカウントの ID を取得して作る。開いたときに1回だけ取得する。
 */
export default function FriendAddQr({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<{ url: string; basicId: string; qrPngBase64: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.lineAccounts.friendAdd(accountId)
      if (res.success && res.data) setData(res.data)
      else setError((res as { error?: string }).error || '取得できませんでした')
    } catch {
      setError('取得できませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && !data && !busy) void load()
  }

  async function copy() {
    if (!data) return
    const ok = await copyText(data.url)
    setCopied(ok)
    if (ok) window.setTimeout(() => setCopied(false), 2000)
    else setError('コピーできませんでした。URLを選んで、手でコピーしてください。')
  }

  const src = data ? `data:image/png;base64,${data.qrPngBase64}` : ''

  return (
    <div className="mt-3 rounded-lg border border-kumo-line p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-kumo-strong">友だち追加のQRコード・URL</h4>
        <Button type="button" variant="secondary" size="sm" onClick={toggle}>
          {open ? '閉じる' : '表示'}
        </Button>
      </div>
      {open ? (
        <div className="mt-3">
          {busy && !data ? <p className="text-xs text-kumo-subtle">読み込み中…</p> : null}
          {data ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`${accountName} の友だち追加QRコード`} width={192} height={192} className="rounded border border-kumo-line bg-white" />
                <a href={src} download={qrFileName(accountName, data.basicId)} className="mt-2 block text-center text-xs font-semibold text-kumo-link underline">
                  QRコードを画像で保存
                </a>
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs text-kumo-subtle">友だち追加URL(ID: {data.basicId})</p>
                <div className="flex items-start gap-2">
                  <Input className="min-w-0 flex-1" aria-label="友だち追加URL" readOnly value={data.url} onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="secondary" onClick={() => void copy()}>
                    {copied ? 'コピーしました' : 'コピー'}
                  </Button>
                </div>
                <p className="mt-2 text-xs leading-5 text-kumo-subtle">お客様にこのURLを送るか、QRコードを読み取ってもらうと、このアカウントを友だち追加できます。</p>
              </div>
            </div>
          ) : null}
          {error ? (
            <div className="mt-2">
              <Banner variant="error" description={error} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
