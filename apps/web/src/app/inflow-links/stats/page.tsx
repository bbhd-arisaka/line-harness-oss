'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useActionLookups } from '@/components/friend-add/use-action-lookups'
import { btnWhite } from '@/components/lstep/ui'
import { api, apiUrl } from '@/lib/api'
import { errorText } from '@/lib/error-text'
import { describeAction } from '@/lib/friend-add-actions'
import { formatInflowDateTime } from '@/lib/inflow-routes'
import type { InflowStats } from '@/lib/inflow-routes'

const PAGE_SIZE = 50

const MARK_STYLE: Record<string, string> = {
  未対応: 'bg-[#ffe9e5] text-[#c4371a]',
  対応中: 'bg-[#fff1d6] text-[#8a5a00]',
  対応済み: 'bg-[#e0f3df] text-[#0a6a08]',
}

/** Lステップの「流入経路分析 > 集計」と同じ画面: 流入経路を読み取った友だちと日時、クエリパラメータ */
export default function InflowStatsPage() {
  const [id, setId] = useState('')
  const [group, setGroup] = useState('')
  const [page, setPage] = useState(1)
  const [stats, setStats] = useState<InflowStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const lookups = useActionLookups(stats?.route.lineAccountId ?? '')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setId(params.get('id') ?? '')
    setGroup(params.get('group') ?? '')
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const res = await api.inflow.stats(id, page, PAGE_SIZE)
      if (res.success) setStats(res.data)
    } catch (err) {
      setError(errorText(err, '読み込めませんでした。時間をおいてもう一度お試しください'))
    } finally {
      setLoading(false)
    }
  }, [id, page])

  useEffect(() => {
    void load()
  }, [load])

  const exportCsv = async () => {
    if (!stats) return
    setExporting(true)
    try {
      const res = await fetch(`${apiUrl()}${api.inflow.exportPath(id)}`, { credentials: 'include' })
      if (!res.ok) throw new Error('csv')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `流入経路_${stats.route.name}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      setError('CSVをダウンロードできませんでした')
    } finally {
      setExporting(false)
    }
  }

  const backHref = `/inflow-links${group ? `?group=${group}` : ''}`
  const pageCount = stats ? Math.max(1, Math.ceil(stats.total / PAGE_SIZE)) : 1
  const route = stats?.route
  const actionLines = route
    ? [
        ...(route.scenarioId ? [`シナリオ[${lookups.scenarios.find((s) => s.id === route.scenarioId)?.name ?? '未選択'}]を開始`] : []),
        ...route.actions.map((a) => describeAction(a, lookups)),
      ]
    : []
  const paramKeys = stats ? Array.from(new Set(stats.rows.flatMap((r) => Object.keys(r.queryParams)))) : []

  return (
    <div>
      <p className="mb-4 text-xs text-[#414143]">
        <Link href={backHref} className="text-[#2b7bb9] underline">流入経路一覧</Link>
        <span className="mx-1">&gt;</span>
        {route?.name ?? '集計'}
      </p>
      <Header title={route ? `${route.name}の集計` : '集計'} />
      {error && <p className="mb-3 text-sm text-[#e5451f]">{error}</p>}

      {route ? (
        <>
          {actionLines.length > 0 ? (
            <div className="mb-4 max-w-[54rem] rounded border border-[#cacace] bg-white">
              <p className="border-b border-[#cacace] bg-[#f1f1f4] px-4 py-2 text-xs font-bold text-[#414143]">アクション</p>
              <ul className="space-y-0.5 px-4 py-3 text-xs">
                {actionLines.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-bold">{stats.people.toLocaleString('ja-JP')}</span>人
              <span className="ml-1 text-[#757578]">({stats.total.toLocaleString('ja-JP')}回)</span>
            </p>
            <div className="flex items-center gap-2">
              <Link href={`/friends?inflow=${encodeURIComponent(route.refCode)}`} className={btnWhite}>友だちリストで表示</Link>
              <button type="button" disabled={exporting} onClick={() => void exportCsv()} className={btnWhite}>
                {exporting ? '作成中...' : 'CSVエクスポート'}
              </button>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="bg-[#f1f1f4] text-left text-xs text-[#757578]" style={{ height: 40 }}>
                  <th className="px-3 font-normal">対応マーク</th>
                  <th className="px-3 font-normal">名前</th>
                  <th className="px-3 font-normal">日時</th>
                  <th className="px-3 font-normal">クエリパラメータ</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="border-b border-[#e3e3e6] py-6 text-center text-[#757578]">読み込み中...</td></tr>
                ) : stats.rows.length === 0 ? (
                  <tr><td colSpan={4} className="border-b border-[#e3e3e6] py-6 text-center text-[#757578]">まだ誰も読み取っていません</td></tr>
                ) : (
                  stats.rows.map((r) => (
                    <tr key={r.id} className="border-b border-[#e3e3e6] bg-white hover:bg-[#fafafb]" style={{ height: 47 }}>
                      <td className="px-3">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs ${MARK_STYLE[r.mark] ?? ''}`}>{r.mark}</span>
                      </td>
                      <td className="px-3">
                        {r.friendId ? (
                          <Link href={`/friends/detail?id=${r.friendId}`} className="font-bold text-[#2b7bb9] underline">{r.friendName}</Link>
                        ) : (
                          <span className="text-[#757578]">{r.friendName}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3">{formatInflowDateTime(r.at)}</td>
                      <td className="px-3 text-xs">
                        {paramKeys.length === 0 ? '' : Object.entries(r.queryParams).map(([k, v]) => `${k}=${v}`).join('&')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex justify-end gap-1 text-sm">
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="h-8 w-8 rounded border border-[#cacace] disabled:opacity-40">&lt;</button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => setPage(n)} className={`h-8 w-8 rounded border ${n === page ? 'border-[#069e04] bg-[#069e04] font-bold text-white' : 'border-[#cacace]'}`}>{n}</button>
              ))}
              <button type="button" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)} className="h-8 w-8 rounded border border-[#cacace] disabled:opacity-40">&gt;</button>
            </div>
          )}

          <div className="mt-6">
            <Link href={backHref} className="text-xs text-[#2b7bb9] underline">戻る</Link>
          </div>
        </>
      ) : loading ? (
        <p className="text-sm text-[#757578]">読み込み中...</p>
      ) : null}
    </div>
  )
}
