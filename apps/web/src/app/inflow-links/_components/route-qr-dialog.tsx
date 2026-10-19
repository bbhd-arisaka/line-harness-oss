'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { XIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { copyText } from '@/lib/friend-add-qr'
import { adInsertTag } from '@/lib/inflow-routes'
import type { InflowRoute } from '@/lib/inflow-routes'

const SIZE = 480
const TEXT_H = 64

/** QRコードの画像。「QRコード表示用テキスト」があれば、QRの下に入れる */
async function renderQr(url: string, text: string | null): Promise<string> {
  const qr = document.createElement('canvas')
  await QRCode.toCanvas(qr, url, { width: SIZE, margin: 2, errorCorrectionLevel: 'M' })
  if (!text) return qr.toDataURL('image/png')
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE + TEXT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return qr.toDataURL('image/png')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(qr, 0, 0)
  ctx.fillStyle = '#222222'
  ctx.font = 'bold 36px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, SIZE / 2, SIZE + TEXT_H / 2 - 6)
  return canvas.toDataURL('image/png')
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-[#414143]">{label}</p>
      <div className="flex items-start gap-2">
        <Input className="min-w-0 flex-1" aria-label={label} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            const ok = await copyText(value)
            setCopied(ok)
            if (ok) window.setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? 'コピーしました' : 'コピー'}
        </Button>
      </div>
    </div>
  )
}

/** 流入経路のURLのコピーと、QRコードの保存(Lステップの「URLコピー・QRコード」) */
export default function RouteQrDialog({ route, onClose }: { route: InflowRoute; onClose: () => void }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let cancelled = false
    void renderQr(route.url, route.qrText).then((s) => {
      if (!cancelled) setSrc(s)
    })
    return () => {
      cancelled = true
    }
  }, [route.url, route.qrText])

  const origin = (() => {
    try {
      return new URL(route.url).origin
    } catch {
      return ''
    }
  })()
  const safeName = route.name.replace(/[\/:*?"<>|\s]+/g, '').slice(0, 40) || route.refCode

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog className="p-0 !w-[min(560px,94vw)] !max-w-none">
        <div className="flex items-center justify-between border-b border-kumo-line px-5 py-3">
          <Dialog.Title className="text-base font-normal text-kumo-strong">{route.name}</Dialog.Title>
          <Button type="button" size="xs" shape="square" variant="ghost" icon={XIcon} aria-label="閉じる" onClick={onClose} />
        </div>
        <div className="space-y-4 p-5">
          <div className="flex flex-col items-center gap-2">
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={`${route.name}のQRコード`} width={240} className="rounded border border-[#e3e3e6] bg-white" />
            ) : (
              <div className="h-60 w-60 rounded border border-[#e3e3e6] bg-[#f7f7f9]" />
            )}
            {src ? (
              <a href={src} download={`流入経路QR_${safeName}.png`} className="text-xs font-bold text-[#2b7bb9] underline">
                QRコードをダウンロード
              </a>
            ) : null}
          </div>
          <CopyRow label="URL" value={route.url} />
          <a href={`${route.url}${route.url.includes('?') ? '&' : '?'}preview=1`} target="_blank" rel="noreferrer" className="inline-block text-xs font-bold text-[#2b7bb9] underline">
            ページを見る
          </a>
          {route.adParamMap.length > 0 && origin ? <CopyRow label="広告挿入タグ" value={adInsertTag(origin, route.refCode)} /> : null}
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
