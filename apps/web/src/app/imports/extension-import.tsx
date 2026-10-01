'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchApi } from '@/lib/api'
import { buildAll, type BeyondForm, type BeyondFriend, type LstepPackage } from '@/lib/lstep-migrate'

// Chrome拡張機能(apps/lstep-extension)が Lステップから集めたデータを受け取り、突き合わせ・変換して、
// 取り込み画面(既存の「計画を確認 → 反映 → 元に戻す」)に渡す。

export interface ExtensionLoaded {
  fileName: string
  definitions: { source: 'lstep'; accountId: string; accountName?: string; folders: unknown[]; fields: unknown[]; tags: unknown[] }
  friends: unknown[]
  forms: { configs: unknown[]; submissions: unknown[] }
  messages: unknown[]
}

interface PackageMeta { id: string; accountName: string; collectedAt: string }
interface Targets { friends: BeyondFriend[]; forms: BeyondForm[] }
interface LineAccountRow { id: string; name: string }

type Bridge = { ok: boolean; error?: string; packages?: PackageMeta[]; data?: LstepPackage }

let seq = 0
function callExtension(type: 'list' | 'get' | 'delete', pkg?: string, timeout = 60000): Promise<Bridge> {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${++seq}`
    const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ ok: false, error: 'timeout' }) }, timeout)
    function onMsg(e: MessageEvent) {
      const d = e.data as { source?: string; id?: string } & Bridge
      if (e.source !== window || !d || d.source !== 'beyond-line-extension' || d.id !== id) return
      clearTimeout(timer)
      window.removeEventListener('message', onMsg)
      resolve(d)
    }
    window.addEventListener('message', onMsg)
    window.postMessage({ source: 'beyond-line-page', id, type, pkg }, window.location.origin)
  })
}

const HOW_LABEL: Record<string, string> = {
  none: '手がかりなし', 'name:multi': '同じ名前が複数', 'pic≠name': '画像と名前が別の人を指す',
}

export function ExtensionImport({ disabled, onLoaded }: { disabled: boolean; onLoaded: (loaded: ExtensionLoaded) => void }) {
  const [status, setStatus] = useState<'checking' | 'missing' | 'ready'>('checking')
  const [packages, setPackages] = useState<PackageMeta[]>([])
  const [accounts, setAccounts] = useState<LineAccountRow[]>([])
  const [pkgId, setPkgId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pkg, setPkg] = useState<LstepPackage | null>(null)
  const [targets, setTargets] = useState<Targets | null>(null)
  const [manualPicks, setManualPicks] = useState<Record<string, string>>({})
  const [formPicks, setFormPicks] = useState<Record<string, string>>({})
  const [passed, setPassed] = useState(false)
  const loadedFor = useRef('')

  const refresh = useCallback(async () => {
    const res = await callExtension('list', undefined, 2500)
    if (!res.ok) { setStatus('missing'); return }
    setStatus('ready')
    setPackages(res.packages ?? [])
    setPkgId((cur) => cur || res.packages?.[0]?.id || '')
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    void fetchApi<{ success: boolean; data: LineAccountRow[] }>('/api/line-accounts')
      .then((r) => { if (r.success) setAccounts(r.data) })
      .catch(() => { /* アカウントが読めなければ、選べないだけ */ })
  }, [])

  const load = async () => {
    setError(null); setPassed(false); setPkg(null); setTargets(null); setManualPicks({}); setFormPicks({})
    setBusy('集めたデータと、beyond line の友だち・フォームを読み込んでいます…')
    try {
      const [got, t] = await Promise.all([
        callExtension('get', pkgId, 120000),
        fetchApi<{ success: boolean; data: { friends: BeyondFriend[]; forms: BeyondForm[] }; error?: string }>(`/api/imports/lstep/targets?accountId=${encodeURIComponent(accountId)}`),
      ])
      if (!got.ok || !got.data) throw new Error(`拡張機能からデータを読めませんでした(${got.error ?? '不明'})`)
      if (!t.success) throw new Error(t.error ?? '取り込み先の情報を読めませんでした')
      setPkg(got.data); setTargets(t.data); loadedFor.current = `${pkgId}|${accountId}`
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込めませんでした')
    } finally { setBusy(null) }
  }

  const accountName = accounts.find((a) => a.id === accountId)?.name ?? accountId
  const result = useMemo(() => {
    if (!pkg || !targets) return null
    try {
      return buildAll(pkg, { friends: targets.friends, forms: targets.forms, accountId, accountName }, { manualPicks, formPicks })
    } catch (e) {
      return { error: e instanceof Error ? e.message : '変換に失敗しました' } as const
    }
  }, [pkg, targets, accountId, accountName, manualPicks, formPicks])

  const pass = () => {
    if (!result || 'error' in result) return
    const d = result.datasets
    onLoaded({
      fileName: `拡張機能: ${pkg?.accountName ?? ''}`,
      definitions: { source: 'lstep', accountId, accountName, folders: d.friends.folders, fields: d.friends.fields, tags: d.friends.tags },
      friends: d.friends.friends,
      forms: { configs: d.forms.forms?.configs ?? [], submissions: d.forms.forms?.submissions ?? [] },
      messages: d.messages.messages ?? [],
    })
    setPassed(true)
  }

  const removeCollected = async () => {
    if (!pkgId) return
    await callExtension('delete', pkgId)
    setPkg(null); setTargets(null); setPassed(false); setPkgId('')
    await refresh()
  }

  const btn = 'rounded px-4 py-2 text-sm font-bold disabled:opacity-50'
  const sel = 'rounded border border-[#d0d0d3] bg-white px-2 py-1 text-sm'
  const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ja-JP') }
  const s = result && !('error' in result) ? result.summary : null

  return (
    <section className="mb-6 rounded border border-[#e0e0e3] bg-white p-5">
      <h2 className="text-sm font-bold text-[#333]">ワンクリック引き継ぎ(Chrome拡張機能)</h2>
      {status === 'checking' && <p className="mt-2 text-xs text-[#757578]">拡張機能を確認しています…</p>}
      {status === 'missing' && (
        <p className="mt-2 text-xs text-[#757578]">
          拡張機能「beyond line 引き継ぎ」が見つかりません。入れ方は <code>apps/lstep-extension/README.md</code> を見てください(Chromeで最初の1回だけ)。入れたあと、この画面を再読み込みしてください。
          <button type="button" className="ml-2 underline" onClick={() => { setStatus('checking'); void refresh() }}>もう一度確認</button>
        </p>
      )}
      {status === 'ready' && packages.length === 0 && (
        <p className="mt-2 text-xs text-[#757578]">集めたデータがありません。Lステップを開いて、右下のパネルで「収集を開始」を押してください。</p>
      )}
      {status === 'ready' && packages.length > 0 && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[#757578]">集めたデータ</span>
            <select className={sel} value={pkgId} onChange={(e) => setPkgId(e.target.value)} disabled={!!busy}>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.accountName}(収集 {fmt(p.collectedAt)})</option>)}
            </select>
            <span className="text-[#757578]">取り込み先</span>
            <select className={sel} value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!!busy}>
              <option value="">選んでください</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button type="button" className={`${btn} border border-[#069e04] text-[#069e04] hover:bg-[#f1fbf1]`} disabled={!pkgId || !accountId || !!busy || disabled} onClick={() => void load()}>
              読み込んで確認する
            </button>
          </div>
          {busy && <p className="text-xs text-[#757578]">{busy}</p>}
          {error && <p className="text-xs text-red-700">{error}</p>}

          {result && 'error' in result && <p className="text-xs text-red-700">{result.error}</p>}
          {s && result && !('error' in result) && (
            <div className="space-y-3 text-sm text-[#333]">
              <table className="w-full text-sm">
                <tbody>
                  <tr><td>Lステップの友だち</td><td className="text-right">{s.friends.lstepTotal}人(beyond line と対応づいた {s.friends.matched}人)</td></tr>
                  <tr><td>取り込む友だち情報・タグ</td><td className="text-right">{s.friends.importable}人(タグあり {s.friends.withTags}人・友だち情報あり {s.friends.withValues}人)</td></tr>
                  <tr><td>決まらなかった有効な友だち</td><td className="text-right">{s.friends.needsReview}人(うち情報あり {s.friends.needsReviewWithData}人)</td></tr>
                  <tr className="text-[#757578]"><td>　ブロック済みで対象外</td><td className="text-right">{s.friends.blockedUnmatched}人</td></tr>
                  <tr><td>回答フォーム</td><td className="text-right">{s.forms.mapped}/{s.forms.lstepForms}件が対応(回答 {s.forms.answers}件・持ち主なし {s.forms.answersWithoutFriend}件)</td></tr>
                  <tr><td>トーク履歴</td><td className="text-right">{s.messages.total}件({s.messages.friends}人分)</td></tr>
                </tbody>
              </table>
              {s.warnings.length > 0 && <p className="text-xs text-amber-700">注意: {s.warnings.slice(0, 5).join(' / ')}{s.warnings.length > 5 ? ` ほか${s.warnings.length - 5}件` : ''}</p>}

              {result.unmatchedForms.length > 0 && (
                <div>
                  <p className="font-bold">対応するフォームが決まらなかったもの(選ぶと、回答も取り込みます)</p>
                  <ul className="mt-1 space-y-1">
                    {result.unmatchedForms.map((f) => (
                      <li key={f.lid} className="flex flex-wrap items-center gap-2">
                        <span>{f.name || f.lid}(回答 {f.answers}件)</span>
                        <select className={sel} value={formPicks[f.lid] ?? ''} onChange={(e) => setFormPicks((p) => ({ ...p, [f.lid]: e.target.value }))}>
                          <option value="">取り込まない</option>
                          {(targets?.forms ?? []).map((bf) => <option key={bf.id} value={bf.id}>{bf.name}</option>)}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.review.length > 0 && (
                <div>
                  <p className="font-bold">どの友だちか決まらなかった人(確実な人だけ選んでください。迷うときは「決めない」)</p>
                  <ul className="mt-1 max-h-72 space-y-1 overflow-auto">
                    {result.review.map((r) => (
                      <li key={r.lstepId} className="flex flex-wrap items-center gap-2">
                        <span>{r.name || r.listName || r.lstepId}<span className="text-xs text-[#757578]">({HOW_LABEL[r.how] ?? r.how}{r.hasData ? '・情報あり' : ''})</span></span>
                        <select className={sel} value={manualPicks[r.lstepId] ?? ''} onChange={(e) => setManualPicks((p) => { const n = { ...p }; if (e.target.value) n[r.lstepId] = e.target.value; else delete n[r.lstepId]; return n })}>
                          <option value="">決めない</option>
                          {r.candidates.map((c) => <option key={c.id} value={c.id}>{c.displayName ?? c.id}</option>)}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={`${btn} bg-[#06c755] text-white`} disabled={disabled || !!busy} onClick={pass}>
                  この内容で、下の「計画を確認する」に進む
                </button>
                {passed && <span className="text-xs text-[#069e04]">読み込みました。下の「計画を確認する」を押してください。</span>}
                <button type="button" className="text-xs text-[#757578] underline" onClick={() => void removeCollected()}>この収集データを拡張機能から削除する</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
