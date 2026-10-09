'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CopyIcon, DotsThreeVerticalIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { Loader } from '@cloudflare/kumo/components/loader'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { errorText } from '@/lib/error-text'
import { reserveApi } from '@/lib/reserve'
import type { CalendarListItem } from '@/lib/reserve'

type Modal = { kind: 'create' } | { kind: 'rename' | 'copy' | 'delete'; item: CalendarListItem } | null

/** カレンダー予約の一覧(Lステップの「カレンダー予約」)。1つの公式アカウントに、最大10個のカレンダー。 */
export default function ReserveListPage() {
  const { selectedAccount } = useAccount()
  const accountId = selectedAccount?.id ?? null
  const [items, setItems] = useState<CalendarListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError('')
    try {
      const res = await reserveApi.list(accountId)
      if (!res.success) throw new Error(res.error)
      setItems(res.data)
    } catch {
      setError('読み込めませんでした。時間をおいてもう一度お試しください')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => items.filter((i) => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase())), [items, query])

  const copy = async (key: string, url: string | null) => {
    if (!url) {
      setError('予約URLを作るには、公式アカウントのLIFFの設定が必要です')
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(key)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      window.prompt('URLをコピーしてください', url)
    }
  }

  const open = (m: Modal) => {
    setMenuFor(null)
    setError('')
    setName(m && m.kind !== 'create' ? (m.kind === 'copy' ? `${m.item.name}のコピー` : m.kind === 'rename' ? m.item.name : '') : '')
    setModal(m)
  }

  const submit = async () => {
    if (!modal || !accountId) return
    setBusy(true)
    setError('')
    try {
      let res
      if (modal.kind === 'create') res = await reserveApi.create(accountId, name)
      else if (modal.kind === 'rename') res = await reserveApi.patch(modal.item.id, { name })
      else if (modal.kind === 'copy') res = await reserveApi.copy(modal.item.id, name)
      else res = await reserveApi.remove(modal.item.id)
      if (!res.success) throw new Error(res.error)
      setModal(null)
      await load()
    } catch (err) {
      setError(errorText(err, '操作できませんでした'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Header title="カレンダー予約" description="カレンダーの空いている日付から日時指定の予約ができます。" />
      {!selectedAccount ? <p className="text-sm text-gray-500">アカウントを選択してください。</p> : null}
      {error ? <Banner className="mb-3" variant="error" title={error} /> : null}

      {selectedAccount ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => open({ kind: 'create' })} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700">
              <PlusIcon size={14} weight="bold" /> 新しいカレンダー
            </button>
            <div className="flex w-72 max-w-full items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 shadow-sm focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20">
              <MagnifyingGlassIcon size={15} className="text-gray-400" />
              <input aria-label="検索" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="カレンダー名で検索" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white py-14 text-sm text-gray-500"><Loader size="sm" /> 読み込み中</div>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-14 text-center text-sm text-gray-500">{items.length === 0 ? 'カレンダーがありません。「新しいカレンダー」から作ってください' : '見つかりませんでした'}</div>
          ) : (
            <ul className="space-y-3">
              {shown.map((it) => (
                <li key={it.id} className="relative rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 hover:shadow-md">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/reserve/detail?id=${it.id}`} className="text-lg font-bold text-gray-900 hover:text-emerald-700">{it.name}</Link>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${it.status === 'active' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-gray-100 text-gray-600 ring-gray-200'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${it.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                          {it.status === 'active' ? '稼働中' : '停止中'}
                        </span>
                        {it.pendingCount > 0 ? <span className="rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-semibold text-white">承認待ち {it.pendingCount}</span> : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void copy(`${it.id}-r`, it.reserveUrl)} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-50/50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50">
                          <CopyIcon size={12} /> {copied === `${it.id}-r` ? 'コピーしました' : '友だち予約URLをコピー'}
                        </button>
                        <button type="button" onClick={() => void copy(`${it.id}-h`, it.historyUrl)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50">
                          <CopyIcon size={12} /> {copied === `${it.id}-h` ? 'コピーしました' : '予約履歴URLをコピー'}
                        </button>
                      </div>
                    </div>
                    <div className="relative flex shrink-0 items-center gap-1">
                      <Link href={`/reserve/detail?id=${it.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">開く</Link>
                      <button type="button" aria-label="メニュー" onClick={() => setMenuFor(menuFor === it.id ? null : it.id)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                        <DotsThreeVerticalIcon size={18} weight="bold" />
                      </button>
                      {menuFor === it.id ? (
                        <ul className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-left text-sm shadow-xl">
                          <li><button type="button" className="block w-full px-4 py-2 text-left hover:bg-gray-50" onClick={() => open({ kind: 'rename', item: it })}>名前の変更</button></li>
                          <li><button type="button" className="block w-full px-4 py-2 text-left hover:bg-gray-50" onClick={() => open({ kind: 'copy', item: it })}>コピー</button></li>
                          <li><button type="button" className="block w-full px-4 py-2 text-left text-red-600 hover:bg-red-50" onClick={() => open({ kind: 'delete', item: it })}>削除</button></li>
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-gray-500">カレンダーは、1つの公式アカウントに10個まで作れます。コピーできるのは、受付時間・予約枠・コース・アクション・シフトなどの設定です(予約内容は、コピーされません)。</p>
        </>
      ) : null}

      <Dialog.Root open={modal !== null} onOpenChange={(o) => { if (!o) setModal(null) }}>
        <Dialog size="base" className="p-6">
          {modal?.kind === 'delete' ? (
            <>
              <Dialog.Title className="mb-2 text-lg font-semibold">カレンダーを削除しますか?</Dialog.Title>
              <div className="mb-4 space-y-1 text-sm text-gray-700">
                <p>「{modal.item.name}」を削除します。削除したカレンダーは、元に戻せません。</p>
                <ul className="list-disc pl-5 text-xs text-gray-600">
                  <li>友だちの予約内容が、確認できなくなります</li>
                  <li>アクションの条件や友だち検索の条件から、このカレンダーの項目が外れます</li>
                  <li>リマインダ・フォローが止まります</li>
                  <li>配布した予約URLは、停止中の表示になります</li>
                </ul>
              </div>
            </>
          ) : (
            <>
              <Dialog.Title className="mb-3 text-lg font-semibold">{modal?.kind === 'create' ? '新しいカレンダー' : modal?.kind === 'rename' ? 'カレンダー名の変更' : 'カレンダーをコピー'}</Dialog.Title>
              <label className="mb-1 block text-sm" htmlFor="cal-name">カレンダー名</label>
              <Input id="cal-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className="mb-4" />
            </>
          )}
          {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>キャンセル</Button>
            <Button variant={modal?.kind === 'delete' ? 'destructive' : 'primary'} loading={busy} disabled={modal?.kind !== 'delete' && !name.trim()} onClick={() => void submit()}>
              {modal?.kind === 'delete' ? '削除する' : modal?.kind === 'rename' ? '変更する' : '作成'}
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </main>
  )
}
