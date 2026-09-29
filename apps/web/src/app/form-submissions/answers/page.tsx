'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { displayFormName } from '../form-list'

interface Submission {
  id: string
  formId: string
  friendId: string | null
  friendName?: string | null
  data: Record<string, unknown>
  createdAt: string
}

interface FormField { name: string; label: string; type?: string }

const PAGE_SIZE = 30

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function FormAnswersPage() {
  const [formId, setFormId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [fields, setFields] = useState<FormField[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<Submission | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id')
    setFormId(id)
    if (!id) { setLoading(false); setError('フォームが指定されていません'); return }
    ;(async () => {
      try {
        const [formRes, subRes] = await Promise.all([
          fetchApi<{ success: boolean; data: { name: string; fields: string | FormField[] } }>(`/api/forms/${id}`),
          fetchApi<{ success: boolean; data: Submission[] }>(`/api/forms/${id}/submissions`),
        ])
        if (formRes.success) {
          setFormName(displayFormName(formRes.data.name))
          const raw = formRes.data.fields
          setFields(typeof raw === 'string' ? (JSON.parse(raw) as FormField[]) : raw)
        }
        if (subRes.success) {
          setSubmissions(
            subRes.data.map((s) => ({
              ...s,
              data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
            })),
          )
        }
      } catch {
        setError('読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const labelOf = useMemo(() => {
    const m: Record<string, string> = {}
    for (const f of fields) m[f.name] = f.label
    return m
  }, [fields])

  const keys = useMemo(() => {
    const inData = new Set(submissions.flatMap((s) => Object.keys(s.data)))
    const ordered = fields.map((f) => f.name).filter((n) => inData.has(n))
    for (const k of inData) if (!ordered.includes(k)) ordered.push(k)
    return ordered
  }, [fields, submissions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return submissions
    return submissions.filter((s) =>
      (s.friendName ?? '').toLowerCase().includes(q) ||
      Object.values(s.data).some((v) => formatValue(v).toLowerCase().includes(q)),
    )
  }, [submissions, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const shownKeys = keys.slice(0, 4)

  return (
    <div>
      <p className="mb-4 text-xs">
        <Link href="/form-submissions" className="text-[#2b7bb9] underline">回答フォーム一覧</Link>
        <span className="mx-1">&gt;</span>
        回答一覧
      </p>
      <Header title={formName || '回答一覧'} description={loading ? '' : `${submissions.length}件の回答`} />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-3 flex justify-end">
        <div className="flex">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="名前・回答内容で検索"
            className="h-9 w-64 rounded-l border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]"
          />
          <span className="flex h-9 w-10 items-center justify-center rounded-r bg-[#757578] text-white" aria-hidden="true">⌕</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="bg-[#f1f1f4] text-left text-xs text-[#757578]" style={{ height: 40 }}>
              <th className="px-3 font-normal">名前</th>
              <th className="px-3 font-normal">回答日時</th>
              {shownKeys.map((k) => <th key={k} className="px-3 font-normal">{labelOf[k] || k}</th>)}
              {keys.length > 4 && <th className="px-3 font-normal" />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3 + shownKeys.length} className="py-6 text-center text-[#757578]">読み込み中...</td></tr>
            ) : pageItems.length === 0 ? (
              <tr><td colSpan={3 + shownKeys.length} className="border-b border-[#e3e3e6] py-6 text-center text-[#757578]">回答がありません</td></tr>
            ) : (
              pageItems.map((s) => (
                <tr key={s.id} onClick={() => setDetail(s)} className="cursor-pointer border-b border-[#e3e3e6] hover:bg-[#fafafb]" style={{ height: 47 }}>
                  <td className="px-3">
                    {s.friendId ? (
                      <Link
                        href={`/chats?friend=${encodeURIComponent(s.friendId)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-bold text-[#2b7bb9] underline"
                      >
                        {s.friendName || '不明'}
                      </Link>
                    ) : (
                      <span>{s.friendName || '不明'}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 text-xs">{formatDateTime(s.createdAt)}</td>
                  {shownKeys.map((k) => (
                    <td key={k} className="max-w-[14rem] truncate px-3">{formatValue(s.data[k])}</td>
                  ))}
                  {keys.length > 4 && <td className="whitespace-nowrap px-3 text-xs text-[#757578]">他{keys.length - 4}項目</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-4 flex justify-end gap-1 text-sm">
          <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="h-8 w-8 rounded border border-[#cacace] disabled:opacity-40">&lt;</button>
          <span className="flex h-8 items-center px-3">{page} / {pageCount}</span>
          <button type="button" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)} className="h-8 w-8 rounded border border-[#cacace] disabled:opacity-40">&gt;</button>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetail(null)} aria-hidden />
          <aside className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-[#e3e3e6] bg-white px-5 py-4">
              <h3 className="text-sm font-bold">回答詳細</h3>
              <button type="button" onClick={() => setDetail(null)} aria-label="閉じる" className="px-2 text-lg">×</button>
            </div>
            <div className="space-y-5 p-5">
              <div>
                <p className="mb-1 text-[11px] text-[#757578]">回答者</p>
                {detail.friendId ? (
                  <Link href={`/chats?friend=${encodeURIComponent(detail.friendId)}`} className="text-sm font-bold text-[#2b7bb9] underline">
                    {detail.friendName || '不明'}
                  </Link>
                ) : (
                  <span className="text-sm">{detail.friendName || '不明'}</span>
                )}
              </div>
              <div>
                <p className="mb-1 text-[11px] text-[#757578]">回答日時</p>
                <p className="text-sm">{formatDateTime(detail.createdAt)}</p>
              </div>
              <div>
                <p className="mb-2 text-[11px] text-[#757578]">回答内容</p>
                <dl className="space-y-3">
                  {keys.length === 0 ? (
                    <p className="text-sm text-[#757578]">項目なし</p>
                  ) : (
                    keys.map((k) => (
                      <div key={k}>
                        <dt className="text-[11px] text-[#757578]">{labelOf[k] || k}</dt>
                        <dd className="whitespace-pre-wrap break-words text-sm">{formatValue(detail.data[k])}</dd>
                      </div>
                    ))
                  )}
                </dl>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
