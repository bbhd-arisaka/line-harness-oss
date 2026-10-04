'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { Loader } from '@cloudflare/kumo/components/loader'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { ApiError, fetchApi } from '@/lib/api'

// Lステップ引き継ぎで「友だちを結びつけられなかった人」を確認するページ(オーナー専用)。
// 左: beyond line にいるのに Lステップの記録が見つからなかった/確実でなかった人。
// 右: Lステップにいるのに beyond line の友だちが見つからなかった人。

type Side = 'beyond' | 'lstep'
type Reason = 'no_lstep' | 'ambiguous' | 'name_only' | 'no_beyond'
interface ReviewItem {
  id: string
  side: Side
  friend_id: string | null
  lstep_id: string | null
  name: string
  picture_url: string | null
  added_at: string | null
  reason: Reason
  detail: string | null
  status: 'open' | 'resolved'
  note: string | null
  resolved_by: string | null
  resolved_at: string | null
}

const REASON_LABEL: Record<Reason, { label: string; help: string }> = {
  no_lstep: { label: 'Lステップに見つからない', help: 'Lステップ側に、同じ人の記録がありませんでした(Lステップに登録がない・ブロック済みなど)' },
  ambiguous: { label: '同名が複数いて決められない', help: 'Lステップに同じ名前の人が複数いて、どの人か決められませんでした。履歴や情報が別人のものになっていないか確認が必要です' },
  name_only: { label: '名前だけで結びつけた', help: 'LINE名が同じ人を1人だけ見つけて結びつけました。確実ではないので、本人かどうか確認してください' },
  no_beyond: { label: 'beyond lineに見つからない', help: 'Lステップにはいますが、beyond line に同じ人がいません(まだ友だち追加していない・ブロック済みなど)' },
}
const LSTEP_DETAIL_URL = 'https://manager.linestep.net/line/detail/'

type Filter = 'open' | 'resolved' | 'all'

function errorText(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : '通信に失敗しました'
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const [broken, setBroken] = useState(false)
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-10 w-10 flex-shrink-0 rounded-full object-cover" onError={() => setBroken(true)} />
  }
  return (
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-kumo-tint text-sm font-bold text-kumo-subtle">
      {[...name][0] ?? '?'}
    </span>
  )
}

function Row({ item, onChanged }: { item: ReviewItem; onChanged: (next: ReviewItem) => void }) {
  const [note, setNote] = useState(item.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolved = item.status === 'resolved'
  const reason = REASON_LABEL[item.reason]

  const save = async (status: 'open' | 'resolved') => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetchApi<{ success: boolean; data: ReviewItem }>(`/api/imports/lstep/review/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status, note }),
      })
      onChanged(res.data)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`flex flex-col gap-2 border-b border-kumo-line px-4 py-3 last:border-b-0 ${resolved ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <Avatar name={item.name} url={item.picture_url} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {item.side === 'beyond' && item.friend_id ? (
              <Link href={`/friends/detail?id=${item.friend_id}`} className="font-bold text-kumo-link hover:underline">{item.name}</Link>
            ) : (
              <a href={`${LSTEP_DETAIL_URL}${item.lstep_id}`} target="_blank" rel="noreferrer" className="font-bold text-kumo-link hover:underline">{item.name}</a>
            )}
            <span className="rounded bg-kumo-tint px-1.5 py-0.5 text-xs text-kumo-default" title={reason.help}>{reason.label}</span>
            {item.added_at && <span className="text-xs text-kumo-subtle">登録 {item.added_at.slice(0, 10)}</span>}
          </div>
          {item.detail && <p className="mt-1 break-words text-xs text-kumo-subtle">{item.detail}</p>}
          {item.side === 'lstep' && <p className="mt-1 text-xs text-kumo-subtle">名前をおすと、Lステップの友だち詳細が開きます(Lステップにログインしている必要があります)</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-[52px]">
        <Input aria-label="メモ" className="min-w-0 flex-1" placeholder="メモ(確認した内容など)" value={note} onValueChange={setNote} />
        {resolved ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void save('open')}>未確認に戻す</Button>
        ) : (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void save('resolved')}>確認済みにする</Button>
        )}
      </div>
      {resolved && item.resolved_by && (
        <p className="pl-[52px] text-xs text-kumo-subtle">{item.resolved_by} が確認済み({item.resolved_at?.slice(0, 16).replace('T', ' ')})</p>
      )}
      {error && <p className="pl-[52px] text-xs text-red-600">{error}</p>}
    </li>
  )
}

function Section({ title, description, items, onChanged }: { title: string; description: string; items: ReviewItem[]; onChanged: (next: ReviewItem) => void }) {
  return (
    <section className="mb-6 rounded border border-kumo-line bg-kumo-base">
      <div className="border-b border-kumo-line px-4 py-3">
        <h2 className="text-sm font-bold text-kumo-default">
          {title}<span className="ml-2 text-xs font-normal text-kumo-subtle">{items.length}人</span>
        </h2>
        <p className="mt-1 text-xs text-kumo-subtle">{description}</p>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-kumo-subtle">該当する人はいません</div>
      ) : (
        <ul>{items.map((it) => <Row key={it.id} item={it} onChanged={onChanged} />)}</ul>
      )}
    </section>
  )
}

export default function MatchReviewPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setItems(null)
    setError(null)
    try {
      const res = await fetchApi<{ success: boolean; data: ReviewItem[] }>(`/api/imports/lstep/review?accountId=${encodeURIComponent(selectedAccountId)}`)
      setItems(res.data)
    } catch (err) {
      setError(errorText(err))
      setItems([])
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const onChanged = (next: ReviewItem) => setItems((cur) => cur?.map((x) => (x.id === next.id ? next : x)) ?? cur)

  const counts = useMemo(() => {
    const all = items ?? []
    return { open: all.filter((x) => x.status === 'open').length, resolved: all.filter((x) => x.status === 'resolved').length, all: all.length }
  }, [items])
  const shown = useMemo(() => (items ?? []).filter((x) => filter === 'all' || x.status === filter), [items, filter])
  const beyond = shown.filter((x) => x.side === 'beyond')
  const lstep = shown.filter((x) => x.side === 'lstep')

  return (
    <div className="max-w-3xl">
      <Header
        title="友だち照合の確認"
        description="Lステップから引き継ぐとき、同じ人だと確実に結びつけられなかった友だちの一覧です。オーナー専用。"
        action={<Link href="/imports" className="text-sm text-kumo-link hover:underline">データ引き継ぎへ</Link>}
      />

      {!selectedAccountId ? (
        <Banner variant="default" title="店舗を選んでください" description="右上で店舗(LINE公式アカウント)を選ぶと、その店舗の確認リストが表示されます。" />
      ) : (
        <>
          <p className="mb-3 text-sm text-kumo-subtle">対象: {selectedAccount?.name ?? selectedAccountId}</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {([['open', `未確認 ${counts.open}`], ['resolved', `確認済み ${counts.resolved}`], ['all', `すべて ${counts.all}`]] as const).map(([key, label]) => (
              <Button key={key} size="sm" variant={filter === key ? 'primary' : 'secondary'} onClick={() => setFilter(key)}>{label}</Button>
            ))}
          </div>
          {error && <Banner variant="error" title="エラー" description={error} className="mb-4" />}
          {items === null ? (
            <div className="flex justify-center py-10"><Loader /></div>
          ) : counts.all === 0 && !error ? (
            <Empty title="確認が必要な人はいません" description="照合の結果がまだ登録されていないか、すべて結びつけられています。" />
          ) : (
            <>
              <Section
                title="beyond line にいるのに、Lステップと結びつかなかった人"
                description="履歴・タグ・友だち情報の引き継ぎ対象になっていない、または確実でない人です。名前をおすと友だち詳細が開きます。"
                items={beyond}
                onChanged={onChanged}
              />
              <Section
                title="Lステップにいるのに、beyond line に見つからなかった人"
                description="まだ友だち追加していない・ブロックした・別のLINE名に変えたなどが考えられます。"
                items={lstep}
                onChanged={onChanged}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
