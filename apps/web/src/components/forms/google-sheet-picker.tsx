'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchApi, ApiError } from '@/lib/api'
import type { GoogleSheetLink } from './editor-types'

interface Connection { id: string; email: string; status: string }
interface Spreadsheet { id: string; name: string }
interface Tab { sheetId: number; title: string }

const control = 'h-10 w-full rounded border border-[#cacace] bg-white px-3 text-sm outline-none focus:border-[#069e04]'
const smallBtn = 'inline-flex h-8 items-center rounded border border-[#cacace] bg-white px-3 text-xs hover:bg-[#f5f5f5]'

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.serverMessage ? e.serverMessage : fallback
}

/** 回答を書き出すスプレッドシート・シートの選択。Googleアカウントはここから紐づける。 */
export function GoogleSheetPicker({
  value,
  onChange,
}: {
  value: GoogleSheetLink | null
  onChange: (next: GoogleSheetLink | null) => void
}) {
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [configured, setConfigured] = useState(true)
  const [sheets, setSheets] = useState<Spreadsheet[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const popupRef = useRef<Window | null>(null)

  const connectionId = value?.connectionId ?? ''
  const current = connections?.find((c) => c.id === connectionId) ?? null

  const loadConnections = useCallback(async () => {
    try {
      const res = await fetchApi<{ success: boolean; data: { configured: boolean; connections: Connection[] } }>(
        '/api/integrations/google-sheets/connections',
      )
      setConfigured(res.data.configured)
      setConnections(res.data.connections)
      return res.data.connections
    } catch (e) {
      setError(errorText(e, 'Google連携の状態を取得できませんでした'))
      setConnections([])
      return []
    }
  }, [])

  useEffect(() => { void loadConnections() }, [loadConnections])

  // 連携ウィンドウが閉じたら(または結果が届いたら)連携一覧を更新し、新しいアカウントを選ぶ
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data as { type?: string; result?: string } | null
      if (!data || data.type !== 'google-sheets-oauth') return
      void (async () => {
        if (data.result === 'connected') {
          const before = new Set((connections ?? []).map((c) => c.id))
          const list = await loadConnections()
          const added = list.find((c) => !before.has(c.id)) ?? list.find((c) => c.id === connectionId) ?? list[list.length - 1]
          if (added) onChange({ connectionId: added.id, spreadsheetId: '', spreadsheetTitle: '', sheetTitle: '' })
          setError('')
        } else if (data.result === 'error') {
          setError('Googleアカウントを連携できませんでした')
        }
      })()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [connections, connectionId, loadConnections, onChange])

  async function connect() {
    setError('')
    // クリックと同時に窓を開く(あとでURLを入れる)。非同期のあとに開くとブロックされる。
    const popup = window.open('', 'google-sheets-oauth', 'width=520,height=680')
    popupRef.current = popup
    try {
      const res = await fetchApi<{ success: boolean; data: { authorizationUrl: string } }>(
        '/api/integrations/google-sheets/oauth/start',
        { method: 'POST', body: JSON.stringify({}) },
      )
      if (popup) popup.location.href = res.data.authorizationUrl
      else window.location.href = res.data.authorizationUrl
    } catch (e) {
      popup?.close()
      setError(errorText(e, 'Google連携を開始できませんでした'))
    }
  }

  async function disconnect() {
    if (!current) return
    if (!window.confirm(`${current.email} の連携を解除します。このアカウントで設定したフォームの書き出しも止まります。`)) return
    setBusy(true)
    try {
      await fetchApi(`/api/integrations/google-sheets/connections/${current.id}`, { method: 'DELETE' })
      onChange(null)
      await loadConnections()
    } catch (e) {
      setError(errorText(e, '連携を解除できませんでした'))
    } finally {
      setBusy(false)
    }
  }

  // スプレッドシート一覧(検索語は少し待ってから)
  useEffect(() => {
    if (!connectionId || current?.status === 'error') { setSheets([]); return }
    const timer = setTimeout(async () => {
      try {
        const res = await fetchApi<{ success: boolean; data: Spreadsheet[] }>(
          `/api/integrations/google-sheets/connections/${connectionId}/spreadsheets?q=${encodeURIComponent(query)}`,
        )
        setSheets(res.data)
        setError('')
      } catch (e) {
        setError(errorText(e, 'スプレッドシートの一覧を取得できませんでした'))
      }
    }, query ? 400 : 0)
    return () => clearTimeout(timer)
  }, [connectionId, query, current?.status])

  // シート(タブ)一覧
  const spreadsheetId = value?.spreadsheetId ?? ''
  useEffect(() => {
    if (!connectionId || !spreadsheetId) { setTabs([]); return }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchApi<{ success: boolean; data: { title: string; sheets: Tab[] } }>(
          `/api/integrations/google-sheets/connections/${connectionId}/spreadsheets/${encodeURIComponent(spreadsheetId)}/sheets`,
        )
        if (!cancelled) setTabs(res.data.sheets)
      } catch (e) {
        if (!cancelled) setError(errorText(e, 'シートの一覧を取得できませんでした'))
      }
    })()
    return () => { cancelled = true }
  }, [connectionId, spreadsheetId])

  if (connections === null) return <div className="text-sm text-[#757578]">…</div>

  if (!configured) {
    return <div className="text-sm text-[#e53935]">Google連携の設定(OAuthクライアント)が未登録です</div>
  }

  if (connections.length === 0) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => void connect()} className="inline-flex h-10 items-center gap-2 rounded border border-[#cacace] bg-white px-4 text-sm font-bold hover:bg-[#f5f5f5]">
          <GoogleMark /> Googleアカウントを連携
        </button>
        {error && <div className="text-xs text-[#e53935]">{error}</div>}
      </div>
    )
  }

  const known = sheets.some((s) => s.id === spreadsheetId)
  const knownTab = tabs.some((t) => t.title === value?.sheetTitle)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          className={control}
          aria-label="Googleアカウント"
          value={connectionId}
          onChange={(e) => onChange(e.target.value ? { connectionId: e.target.value, spreadsheetId: '', spreadsheetTitle: '', sheetTitle: '' } : null)}
        >
          <option value="">アカウントを選択</option>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.email}{c.status === 'error' ? '(要再連携)' : ''}</option>)}
        </select>
        <button type="button" className={`${smallBtn} shrink-0`} onClick={() => void connect()}>
          {current?.status === 'error' ? '再連携' : '追加'}
        </button>
        {current && (
          <button type="button" className={`${smallBtn} shrink-0 text-[#e53935]`} disabled={busy} onClick={() => void disconnect()}>
            解除
          </button>
        )}
      </div>

      {current && current.status !== 'error' && (
        <>
          <input className={control} placeholder="スプレッドシート名で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select
            className={control}
            aria-label="スプレッドシート"
            value={spreadsheetId}
            onChange={(e) => {
              const s = sheets.find((x) => x.id === e.target.value)
              onChange({ connectionId, spreadsheetId: e.target.value, spreadsheetTitle: s?.name ?? '', sheetTitle: '' })
            }}
          >
            <option value="">スプレッドシートを選択</option>
            {spreadsheetId && !known ? <option value={spreadsheetId}>{value?.spreadsheetTitle || '(選択中のスプレッドシート)'}</option> : null}
            {sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {spreadsheetId && (
            <select
              className={control}
              aria-label="シート"
              value={value?.sheetTitle ?? ''}
              onChange={(e) => onChange({ ...(value as GoogleSheetLink), sheetTitle: e.target.value })}
            >
              <option value="">シートを選択</option>
              {value?.sheetTitle && !knownTab ? <option value={value.sheetTitle}>{value.sheetTitle}</option> : null}
              {tabs.map((t) => <option key={t.sheetId} value={t.title}>{t.title}</option>)}
            </select>
          )}
        </>
      )}
      {current?.status === 'error' && <div className="text-xs text-[#e53935]">連携が切れています</div>}
      {value?.lastError && <div className="text-xs text-[#e53935]">直近の書き出しに失敗しました: {value.lastError}</div>}
      {error && <div className="text-xs text-[#e53935]">{error}</div>}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}
