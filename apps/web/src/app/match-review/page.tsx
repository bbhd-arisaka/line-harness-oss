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

// Lステップ引き継ぎで「友だちを確実に結びつけられなかった人」を確認するページ(オーナー専用)。
// 1) 名前だけで結びつけた人: beyond line の友だちと、結びつけたLステップの人を並べて見せ、「同じ人」か「別の人」かを判断する。
// 2) 結びつかなかった人: beyond line の友だちに、Lステップの人を選んで手で結びつける。
// 3) Lステップにだけいる人: 結びつけ先の候補。

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
  partner_id: string | null
  partner_name: string | null
  partner_picture_url: string | null
  decision: 'same' | 'different' | 'link' | null
  line_name: string | null
  real_name: string | null
  partner_line_name: string | null
  partner_real_name: string | null
}

const REASON_LABEL: Record<Reason, string> = {
  no_lstep: 'Lステップに見つからない',
  ambiguous: '同名が複数いて決められない',
  name_only: '名前だけで結びつけた',
  no_beyond: 'beyond lineに見つからない',
}
const LSTEP_DETAIL_URL = 'https://manager.linestep.net/line/detail/'

type Filter = 'open' | 'resolved' | 'all'
type Patch = { status?: 'open' | 'resolved'; note?: string; decision?: 'same' | 'different' | null }

function errorText(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : '通信に失敗しました'
}

function Avatar({ name, url, size = 'h-10 w-10' }: { name: string; url: string | null; size?: string }) {
  const [broken, setBroken] = useState(false)
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" referrerPolicy="no-referrer" className={`${size} flex-shrink-0 rounded-full object-cover`} onError={() => setBroken(true)} />
  }
  return (
    <span className={`${size} flex flex-shrink-0 items-center justify-center rounded-full bg-kumo-tint text-sm font-bold text-kumo-subtle`} title="プロフィール画像が未設定、または表示できません">
      {[...name][0] ?? '?'}
    </span>
  )
}

/** 1人分(画像・名前・どちらのシステムの人か) */
function Person({ label, name, lineName, realName, url, href, external }: { label: string; name: string; lineName: string | null; realName: string | null; url: string | null; href: string | null; external?: boolean }) {
  const title = realName || lineName || name
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Avatar name={name} url={url} />
      <div className="min-w-0">
        <div className="text-xs text-kumo-subtle">{label}</div>
        {href ? (
          external ? (
            <a href={href} target="_blank" rel="noreferrer" className="break-words font-bold text-kumo-link hover:underline">{title}</a>
          ) : (
            <Link href={href} className="break-words font-bold text-kumo-link hover:underline">{title}</Link>
          )
        ) : (
          <span className="break-words font-bold">{title}</span>
        )}
        <div className="break-words text-xs text-kumo-default">LINE名: {lineName || '(不明)'}</div>
        <div className="break-words text-xs text-kumo-default">本名: {realName || '(未登録)'}</div>
      </div>
    </div>
  )
}

const lstepHref = (id: string | null) => (id ? `${LSTEP_DETAIL_URL}${id}` : null)
const friendHref = (id: string | null) => (id ? `/friends/detail?id=${id}` : null)

/** 行の共通部品: 更新APIを呼んで、結果を親へ返す */
function useRowActions(item: ReviewItem, onChanged: (rows: ReviewItem[]) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<ReviewItem[]>) => {
    setBusy(true)
    setError(null)
    try {
      onChanged(await fn())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const patch = (p: Patch) =>
    run(async () => {
      const res = await fetchApi<{ success: boolean; data: ReviewItem }>(`/api/imports/lstep/review/${item.id}`, { method: 'PUT', body: JSON.stringify(p) })
      return [res.data]
    })
  const link = (partnerRowId: string) =>
    run(async () => {
      const res = await fetchApi<{ success: boolean; data: { a: ReviewItem; b: ReviewItem } }>(`/api/imports/lstep/review/${item.id}/link`, { method: 'POST', body: JSON.stringify({ partnerRowId }) })
      return [res.data.a, res.data.b]
    })
  const unlink = () =>
    run(async () => {
      const res = await fetchApi<{ success: boolean; data: ReviewItem[] }>(`/api/imports/lstep/review/${item.id}/unlink`, { method: 'POST', body: '{}' })
      return res.data
    })
  return { busy, error, patch, link, unlink }
}

function Meta({ item, error }: { item: ReviewItem; error: string | null }) {
  return (
    <>
      {item.detail && <p className="break-words text-xs text-kumo-subtle">{item.detail}</p>}
      {item.status === 'resolved' && item.resolved_by && (
        <p className="text-xs text-kumo-subtle">{item.resolved_by} が確認済み({item.resolved_at?.slice(0, 16).replace('T', ' ')})</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </>
  )
}

/** 名前だけで結びつけた人: 2人を並べて、同じ人か判断する */
function PairCard({ item, onChanged }: { item: ReviewItem; onChanged: (rows: ReviewItem[]) => void }) {
  const { busy, error, patch } = useRowActions(item, onChanged)
  const [note, setNote] = useState(item.note ?? '')
  const different = item.decision === 'different'
  return (
    <li className={`flex flex-col gap-2 border-b border-kumo-line px-4 py-3 last:border-b-0 ${item.status === 'resolved' ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Person label="beyond line の友だち" name={item.name} lineName={item.line_name} realName={item.real_name} url={item.picture_url} href={friendHref(item.friend_id)} />
        <span className="text-lg text-kumo-subtle" aria-label="と同じ人?">＝?</span>
        <Person label="Lステップの人(この人のデータを引き継いでいます)" name={item.partner_name ?? '(不明)'} lineName={item.partner_line_name} realName={item.partner_real_name} url={item.partner_picture_url} href={lstepHref(item.partner_id)} external />
      </div>
      {different && (
        <Banner variant="error" title="「別の人」と判断しました" description="この友だちに、別の人のLステップのデータ(タグ・友だち情報・履歴)が引き継がれています。取り消しが必要なので、開発側に伝えてください。" />
      )}
      <Meta item={item} error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="メモ" className="min-w-0 flex-1" placeholder="メモ(確認した内容など)" value={note} onValueChange={setNote} />
        {item.status === 'resolved' ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void patch({ status: 'open', decision: null, note })}>判断を取り消す</Button>
        ) : (
          <>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void patch({ status: 'resolved', decision: 'same', note })}>同じ人です</Button>
            <Button variant="secondary" size="sm" disabled={busy || different} onClick={() => void patch({ status: 'open', decision: 'different', note })}>別の人です</Button>
          </>
        )}
      </div>
    </li>
  )
}

/** 結びつかなかったbeyond lineの友だち: Lステップの人を選んで結びつける */
function UnmatchedCard({ item, candidates, onChanged }: { item: ReviewItem; candidates: ReviewItem[]; onChanged: (rows: ReviewItem[]) => void }) {
  const { busy, error, patch, link, unlink } = useRowActions(item, onChanged)
  const [note, setNote] = useState(item.note ?? '')
  const [pick, setPick] = useState<string | null>(null)
  const linked = item.decision === 'link'
  const picked = candidates.find((c) => c.id === pick) ?? null
  return (
    <li className={`flex flex-col gap-2 border-b border-kumo-line px-4 py-3 last:border-b-0 ${item.status === 'resolved' ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Person label="beyond line の友だち" name={item.name} lineName={item.line_name} realName={item.real_name} url={item.picture_url} href={friendHref(item.friend_id)} />
        {linked && (
          <>
            <span className="text-lg text-kumo-subtle" aria-label="と同じ人">＝</span>
            <Person label="Lステップの人" name={item.partner_name ?? '(不明)'} lineName={item.partner_line_name} realName={item.partner_real_name} url={item.partner_picture_url} href={lstepHref(item.partner_id)} external />
          </>
        )}
      </div>
      <p className="text-xs text-kumo-subtle">{REASON_LABEL[item.reason]}</p>
      <Meta item={item} error={error} />
      {linked ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-kumo-tint px-1.5 py-0.5 text-xs">結びつけを記録しました(Lステップのタグ・友だち情報・履歴の移行は、開発側で行います)</span>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void unlink()}>結びつけを解除</Button>
        </div>
      ) : item.status === 'open' ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-bold text-kumo-default">同じ人を、Lステップの「beyond lineに見つからない人」から選ぶ</div>
          {candidates.length === 0 ? (
            <p className="text-xs text-kumo-subtle">選べるLステップの人がいません</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPick(pick === c.id ? null : c.id)}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-left text-sm ${pick === c.id ? 'border-kumo-brand bg-kumo-tint' : 'border-kumo-line'}`}
                >
                  <Avatar name={c.name} url={c.picture_url} size="h-8 w-8" />
                  <span className="break-words">{c.real_name || c.name}<span className="block text-xs text-kumo-subtle">LINE名: {c.line_name || '(不明)'}</span></span>
                </button>
              ))}
            </div>
          )}
          {picked && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">「{item.real_name || item.name}(LINE名: {item.line_name || '不明'})」＝「{picked.real_name || picked.name}(LINE名: {picked.line_name || '不明'})」</span>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void link(picked.id).then(() => setPick(null))}>この2人を結びつける</Button>
            </div>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="メモ" className="min-w-0 flex-1" placeholder="メモ(確認した内容など)" value={note} onValueChange={setNote} />
        {item.status === 'resolved' ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void patch({ status: 'open', note })}>未確認に戻す</Button>
        ) : !linked ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void patch({ status: 'resolved', note })}>結びつけなくてよい(確認済み)</Button>
        ) : null}
      </div>
    </li>
  )
}

/** Lステップにだけいる人 */
function LstepCard({ item, onChanged }: { item: ReviewItem; onChanged: (rows: ReviewItem[]) => void }) {
  const { busy, error, patch } = useRowActions(item, onChanged)
  const [note, setNote] = useState(item.note ?? '')
  const linked = item.decision === 'link'
  return (
    <li className={`flex flex-col gap-2 border-b border-kumo-line px-4 py-3 last:border-b-0 ${item.status === 'resolved' ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Person label="Lステップの人(名前をおすとLステップで開きます)" name={item.name} lineName={item.line_name} realName={item.real_name} url={item.picture_url} href={lstepHref(item.lstep_id)} external />
        {linked && (
          <>
            <span className="text-lg text-kumo-subtle" aria-label="と同じ人">＝</span>
            <Person label="beyond line の友だち" name={item.partner_name ?? '(不明)'} lineName={item.partner_line_name} realName={item.partner_real_name} url={item.partner_picture_url} href={friendHref(item.partner_id)} />
          </>
        )}
      </div>
      <Meta item={item} error={error} />
      {linked && <p className="text-xs text-kumo-subtle">結びつけ済みです。解除は、beyond line の友だち側の行でおこないます。</p>}
      {item.note && !linked && item.status === 'open' && <p className="break-words text-xs">メモ: {item.note}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="メモ" className="min-w-0 flex-1" placeholder="メモ(確認した内容など)" value={note} onValueChange={setNote} />
        {item.status === 'resolved' ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void patch({ status: 'open', note })}>未確認に戻す</Button>
        ) : !linked ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void patch({ status: 'resolved', note })}>確認済みにする</Button>
        ) : null}
      </div>
    </li>
  )
}

function Section({ title, description, count, children }: { title: string; description: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded border border-kumo-line bg-kumo-base">
      <div className="border-b border-kumo-line px-4 py-3">
        <h2 className="text-sm font-bold text-kumo-default">
          {title}<span className="ml-2 text-xs font-normal text-kumo-subtle">{count}人</span>
        </h2>
        <p className="mt-1 text-xs text-kumo-subtle">{description}</p>
      </div>
      {count === 0 ? <div className="px-4 py-6 text-center text-sm text-kumo-subtle">該当する人はいません</div> : <ul>{children}</ul>}
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

  const onChanged = (rows: ReviewItem[]) =>
    setItems((cur) => cur?.map((x) => rows.find((r) => r.id === x.id) ?? x) ?? cur)

  const counts = useMemo(() => {
    const all = items ?? []
    return { open: all.filter((x) => x.status === 'open').length, resolved: all.filter((x) => x.status === 'resolved').length, all: all.length }
  }, [items])
  const shown = useMemo(() => (items ?? []).filter((x) => filter === 'all' || x.status === filter), [items, filter])
  const pairs = shown.filter((x) => x.side === 'beyond' && x.reason === 'name_only')
  const unmatched = shown.filter((x) => x.side === 'beyond' && x.reason !== 'name_only')
  const lsteps = shown.filter((x) => x.side === 'lstep')
  // 結びつけ先の候補: まだ結びつけておらず、確認済みでもない「Lステップにだけいる人」(絞り込みとは無関係に全件から)
  const candidates = useMemo(() => (items ?? []).filter((x) => x.side === 'lstep' && x.status === 'open' && !x.decision), [items])

  return (
    <div className="max-w-3xl">
      <Header
        title="友だち照合の確認"
        description="Lステップから引き継ぐとき、同じ人だと確実に結びつけられなかった友だちを確認します。オーナー専用。"
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
                title="名前だけで結びつけた人(同じ人か確認)"
                description="プロフィール画像では確認できず、名前が同じだったので結びつけています。左(beyond line)と右(Lステップ)が同じ人かを見て、判断してください。"
                count={pairs.length}
              >
                {pairs.map((it) => <PairCard key={it.id} item={it} onChanged={onChanged} />)}
              </Section>
              <Section
                title="結びつかなかった人(beyond line の友だち)"
                description="Lステップに同じ人が見つからなかった友だちです。同じ人が下の「Lステップにだけいる人」にいれば、選んで結びつけてください。"
                count={unmatched.length}
              >
                {unmatched.map((it) => <UnmatchedCard key={it.id} item={it} candidates={candidates} onChanged={onChanged} />)}
              </Section>
              <Section
                title="Lステップにだけいる人"
                description="beyond line に同じ人が見つからなかった、Lステップの友だちです。"
                count={lsteps.length}
              >
                {lsteps.map((it) => <LstepCard key={it.id} item={it} onChanged={onChanged} />)}
              </Section>
            </>
          )}
        </>
      )}
    </div>
  )
}
