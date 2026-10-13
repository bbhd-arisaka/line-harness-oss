'use client'

import { useState } from 'react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { api } from '@/lib/api'

/**
 * Lステップとの並行運用(アカウントごと)。
 * LINE の Webhook URL を beyond line にして、受け取った内容を、そのままLステップにも転送する。
 * 並行運用中は、beyond line からの自動送信(自動応答・あいさつ・シナリオ・リッチメニュー切替)をしない(二重送信を防ぐ)。
 */
export default function LstepForwardSetting({
  accountId,
  initialUrl,
  onUpdated,
}: {
  accountId: string
  initialUrl: string | null
  onUpdated: () => void | Promise<void>
}) {
  const [value, setValue] = useState(initialUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const active = Boolean(initialUrl)

  async function save(url: string | null) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await api.lineAccounts.setLstepForward(accountId, url)
      if (res.success) {
        setMessage({ ok: true, text: url ? '並行運用を開始しました(受信をLステップにも転送します)。' : '並行運用を解除しました。' })
        if (!url) setValue('')
        await onUpdated()
      } else {
        setMessage({ ok: false, text: res.error || '保存できませんでした' })
      }
    } catch {
      setMessage({ ok: false, text: '保存できませんでした。時間をおいてもう一度お試しください。' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-kumo-line p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-kumo-strong">Lステップとの並行運用</h4>
        <span className={`text-xs font-semibold ${active ? 'text-kumo-warning' : 'text-kumo-subtle'}`}>{active ? '並行運用中(送信停止)' : '使っていない'}</span>
      </div>
      <p className="mb-2 text-xs leading-5 text-kumo-subtle">
        LINEのWebhook URLを、このシステムのURL(https://beyond-line.cms-manager.jp/webhook)にして、下に
        <b>Lステップの受信URL</b>(切り替える前にLINE Developersで控えたもの)を入れると、受け取った内容をLステップにも転送します。
        並行運用中は、このアカウントからの自動送信(自動応答・あいさつ・シナリオ・一斉配信)は行いません。
      </p>
      <div className="flex items-start gap-2">
        <Input
          className="min-w-0 flex-1"
          aria-label="Lステップの受信URL"
          type="url"
          value={value}
          onValueChange={setValue}
          placeholder="https://rcv.linestep.net/v3/call/..."
        />
        <Button type="button" variant="secondary" loading={busy} disabled={!value.trim()} onClick={() => void save(value.trim())}>
          {active ? '更新' : '開始'}
        </Button>
        {active ? (
          <Button type="button" variant="secondary-destructive" loading={busy} onClick={() => void save(null)}>
            解除
          </Button>
        ) : null}
      </div>
      {message ? (
        <div className="mt-2">
          <Banner variant={message.ok ? 'default' : 'error'} description={message.text} />
        </div>
      ) : null}
    </div>
  )
}
