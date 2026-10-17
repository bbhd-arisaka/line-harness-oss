'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import type { HomeAlert, HomeSummary } from '@/lib/api'
import { getApiBase } from '@/lib/api-base'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import TrendChart from '@/components/home/trend-chart'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { Table } from '@cloudflare/kumo/components/table'

const ccPrompts = [
  {
    title: 'ダッシュボードのKPI分析',
    prompt: `LINE CRM ダッシュボードのデータを分析してください。
1. 友だち数の推移を確認
2. 対応状況(未対応・対応中・対応済み)と返信までの時間を評価
3. 流入経路ごとの友だち追加を分析
改善提案を含めてレポートしてください。`,
  },
]

const n = (v: number) => v.toLocaleString('ja-JP')

/** 分 → 「32分」「1時間20分」 */
function minutesLabel(min: number): string {
  if (min < 60) return `${min}分`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}時間` : `${h}時間${m}分`
}

function Card({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-kumo-line bg-white ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-kumo-line px-4 py-2.5">
        <h2 className="text-sm font-semibold text-[#414143]">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-100 ${className}`} />
}

/** 現在の対応状況。押すと、その状態に絞ったトーク一覧へ */
function StatusTiles({ s }: { s: HomeSummary }) {
  const tiles = [
    { key: 'unread', label: '未対応', value: s.chatStatus.unread, tone: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' },
    { key: 'in_progress', label: '対応中', value: s.chatStatus.in_progress, tone: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' },
    { key: 'resolved', label: '対応済み', value: s.chatStatus.resolved, tone: 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100' },
  ]
  return (
    <div className="grid grid-cols-3 gap-3">
      {tiles.map((t) => (
        <Link key={t.key} href={`/chats?status=${t.key}`} className={`rounded-lg border px-3 py-4 text-center transition-colors ${t.tone}`} aria-label={`${t.label} ${t.value}人。トーク一覧を開く`}>
          <p className="text-xs font-semibold">{t.label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{n(t.value)}</p>
        </Link>
      ))}
    </div>
  )
}

const ALERT_STYLE: Record<HomeAlert['severity'], { box: string; dot: string }> = {
  critical: { box: 'border-red-200 bg-red-50', dot: 'bg-red-500' },
  warning: { box: 'border-amber-200 bg-amber-50', dot: 'bg-amber-500' },
  info: { box: 'border-sky-200 bg-sky-50', dot: 'bg-sky-500' },
}

function alertHref(a: HomeAlert): string | null {
  if (!a.target) return null
  if (a.target.kind === 'chats') return `/chats?status=${a.target.status}`
  if (a.target.kind === 'broadcasts') return '/broadcasts'
  return '/friends'
}

function AlertList({ alerts }: { alerts: HomeAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span>お知らせはありません</span>
      </div>
    )
  }
  return (
    <ul className="space-y-2">
      {alerts.map((a) => {
        const style = ALERT_STYLE[a.severity]
        const href = alertHref(a)
        const body = (
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${style.box} ${href ? 'transition-opacity hover:opacity-80' : ''}`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#414143]">{a.title}</p>
              {a.detail ? <p className="text-xs text-[#757578]">{a.detail}</p> : null}
            </div>
            {href ? <span className="self-center text-[#757578]" aria-hidden="true">›</span> : null}
          </div>
        )
        return <li key={a.id}>{href ? <Link href={href}>{body}</Link> : body}</li>
      })}
    </ul>
  )
}

function Stat({ title, value, sub, href }: { title: string; value: string; sub?: string; href?: string }) {
  const inner = (
    <div className="rounded-lg border border-kumo-line bg-kumo-tint p-3">
      <p className="text-xs font-medium text-kumo-subtle">{title}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-kumo-strong">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-kumo-subtle">{sub}</p> : null}
    </div>
  )
  return href ? <Link href={href} className="block transition-opacity hover:opacity-80">{inner}</Link> : inner
}

function signed(v: number): string {
  return v > 0 ? `+${n(v)}` : v < 0 ? `−${n(Math.abs(v))}` : '±0'
}

function FriendAddLinkCard() {
  const { selectedAccount } = useAccount()
  const [copied, setCopied] = useState(false)
  const base = (getApiBase() ?? '').replace(/\/$/, '')
  const link = selectedAccount ? `${base}/r/dashboard?account=${encodeURIComponent(selectedAccount.channelId)}` : `${base}/r/dashboard`
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard requires a secure context
    }
  }
  return (
    <Card title="友だち追加リンク">
      <div className="flex items-stretch gap-2">
        <Input aria-label="友だち追加リンク" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" />
        <Button type="button" onClick={onCopy} variant="primary" size="sm" className="shrink-0">
          {copied ? 'コピーしました ✓' : 'コピー'}
        </Button>
      </div>
    </Card>
  )
}

export default function HomePage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [summary, setSummary] = useState<HomeSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const loadedAt = useRef(0)
  const seq = useRef(0)

  const load = useCallback(
    async (fresh: boolean) => {
      if (!selectedAccountId) return
      const mine = ++seq.current
      setLoading(true)
      setError('')
      try {
        const res = await api.lineAccounts.home(selectedAccountId, fresh)
        if (mine !== seq.current) return
        if (res.success) {
          setSummary(res.data)
          loadedAt.current = Date.now()
        } else {
          setError('読み込めませんでした')
        }
      } catch {
        if (mine === seq.current) setError('読み込めませんでした')
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    },
    [selectedAccountId],
  )

  useEffect(() => {
    setSummary(null)
    void load(false)
  }, [load])

  // 別のタブから戻ったとき、1分以上たっていれば、取り直す(定期的には取りに行かない)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > 60_000) void load(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const reload = (
    <Button type="button" variant="ghost" size="xs" onClick={() => void load(true)} disabled={loading}>
      {loading ? '読み込み中…' : '再読み込み'}
    </Button>
  )

  const s = summary
  const trendDesc = s ? [...s.trend].reverse() : []

  return (
    <div>
      <Header title="ホーム" product="LINE" description={selectedAccount ? selectedAccount.displayName || selectedAccount.name : undefined} />

      {error ? <Banner className="mb-4" variant="error" title={error} /> : null}

      {!selectedAccountId ? (
        <Banner variant="alert" title="公式アカウントを選んでください" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="現在の対応状況" className="xl:col-span-2" action={reload}>
              {s ? <StatusTiles s={s} /> : <Skeleton className="h-24" />}
            </Card>
            <Card title="重要なお知らせ">{s ? <AlertList alerts={s.alerts} /> : <Skeleton className="h-24" />}</Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="友だち数">
              {s ? (
                <div className="grid grid-cols-2 gap-3">
                  <Link href="/friends" className="block rounded-lg border border-kumo-line p-3 text-center transition-colors hover:bg-gray-50">
                    <p className="text-xs font-medium text-kumo-subtle">有効友だち数</p>
                    <p className="mt-1 text-3xl font-bold tabular-nums text-kumo-strong">{n(s.friends.active)}<span className="ml-0.5 text-sm font-normal">人</span></p>
                    <p className="mt-0.5 text-[11px] text-kumo-subtle">友だち総数 {n(s.friends.total)}</p>
                  </Link>
                  <div className="rounded-lg border border-kumo-line p-3 text-center">
                    <p className="text-xs font-medium text-kumo-subtle">ブロック数</p>
                    <p className="mt-1 text-3xl font-bold tabular-nums text-kumo-strong">{n(s.friends.blocked)}<span className="ml-0.5 text-sm font-normal">人</span></p>
                    <p className="mt-0.5 text-[11px] text-kumo-subtle">{s.ops.blockRatePct !== null ? `${s.ops.blockRatePct}%` : '—'}</p>
                  </div>
                </div>
              ) : (
                <Skeleton className="h-28" />
              )}
            </Card>

            <Card title={`${s ? Number(s.generatedAt.slice(5, 7)) : new Date().getMonth() + 1}月の送信可能数`}>
              {s ? (
                s.quota === null ? (
                  <p className="text-sm text-red-600">取得できませんでした。「再読み込み」を押してください</p>
                ) : s.quota.type === 'none' ? (
                  <div className="text-center">
                    <p className="text-3xl font-bold text-kumo-strong">∞</p>
                    <p className="text-[11px] text-kumo-subtle">上限なし ・ 今月 {s.quota.consumption !== null ? `${n(s.quota.consumption)}通` : '—'}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-medium text-kumo-subtle">残り</p>
                    <p className={`text-3xl font-bold tabular-nums ${s.quota.remaining === 0 ? 'text-red-600' : 'text-kumo-strong'}`}>{s.quota.remaining !== null ? n(s.quota.remaining) : '—'}<span className="ml-0.5 text-sm font-normal">通</span></p>
                    {s.quota.limit ? (
                      <>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={s.quota.limit} aria-valuenow={s.quota.consumption ?? 0}>
                          <div className="h-full rounded-full bg-kumo-brand" style={{ width: `${Math.min(100, ((s.quota.consumption ?? 0) / s.quota.limit) * 100)}%` }} />
                        </div>
                        <p className="mt-1 text-[11px] text-kumo-subtle">消費 {n(s.quota.consumption ?? 0)} / 上限 {n(s.quota.limit)}</p>
                      </>
                    ) : null}
                  </div>
                )
              ) : (
                <Skeleton className="h-28" />
              )}
            </Card>
          </div>

          <Card title="友だち数の推移(14日)">
            {s ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <TrendChart rows={s.trend} />
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-kumo-subtle">
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#16a34a]" />登録</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#ef4444]" />ブロック</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[#2563eb]" />有効友だち数</span>
                  </div>
                </div>
                <div className="max-h-72 overflow-auto rounded-lg border border-kumo-line">
                  <Table className="min-w-[420px] text-right tabular-nums">
                    <Table.Header>
                      <Table.Row>
                        <Table.Head>日付</Table.Head>
                        <Table.Head className="text-right">前日比</Table.Head>
                        <Table.Head className="text-right">登録数</Table.Head>
                        <Table.Head className="text-right">ブロック</Table.Head>
                        <Table.Head className="text-right">有効友だち数</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {trendDesc.map((r, i) => (
                        <Table.Row key={r.date} className={i === 0 ? 'bg-amber-50' : undefined}>
                          <Table.Cell className="text-left">{Number(r.date.slice(5, 7))}月{Number(r.date.slice(8, 10))}日</Table.Cell>
                          <Table.Cell className={r.delta > 0 ? 'text-green-700' : r.delta < 0 ? 'text-red-600' : 'text-kumo-subtle'}>{signed(r.delta)}</Table.Cell>
                          <Table.Cell>{n(r.added)}</Table.Cell>
                          <Table.Cell>{n(r.blocked)}</Table.Cell>
                          <Table.Cell className="font-medium">{n(r.active)}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              </div>
            ) : (
              <Skeleton className="h-56" />
            )}
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="運用の指標" className="xl:col-span-2">
              {s ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <Stat title="返信までの平均時間(7日)" value={s.ops.avgFirstReplyMinutes !== null ? minutesLabel(s.ops.avgFirstReplyMinutes) : '—'} sub={s.ops.repliedCount > 0 ? `${n(s.ops.repliedCount)}件の平均` : undefined} />
                  <Stat title="今月の受信メッセージ" value={`${n(s.ops.receivedThisMonth)}件`} href="/chats" />
                  <Stat title="今月のフォーム回答" value={`${n(s.ops.formAnswersThisMonth)}件`} href="/form-submissions" />
                  <Stat title="今月の新しい友だち" value={`${n(s.ops.addedThisMonth)}人`} />
                  <Stat title="今月のブロック" value={`${n(s.ops.blockedThisMonth)}人`} />
                  <Stat title="今月の送信数" value={`${n(s.sentThisMonth)}通`} href="/broadcasts" />
                </div>
              ) : (
                <Skeleton className="h-36" />
              )}
            </Card>
            <Card title="流入経路(今月の新しい友だち)">
              {s ? (
                s.routes.length === 0 ? (
                  <p className="text-sm text-kumo-subtle">—</p>
                ) : (
                  <ul className="space-y-2">
                    {s.routes.map((r) => {
                      const max = Math.max(1, ...s.routes.map((x) => x.count))
                      return (
                        <li key={r.key}>
                          <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate text-[#414143]">{r.label}</span>
                            <span className="shrink-0 tabular-nums font-medium">{n(r.count)}</span>
                          </div>
                          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full bg-kumo-brand" style={{ width: `${(r.count / max) * 100}%` }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )
              ) : (
                <Skeleton className="h-36" />
              )}
            </Card>
          </div>

          <FriendAddLinkCard />
        </div>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
