'use client'

import { useCallback, useEffect, useState } from 'react'
import { TrashIcon, XIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Loader } from '@cloudflare/kumo/components/loader'
import { api, type SavedFriendSearch } from '@/lib/api'
import { describeFilter, type DescribeContext, type FriendFilter } from '@/lib/friend-filter'

/** Lステップの「保存した検索」(アカウントごと)。選ぶと、その条件で友だちリストを絞り込む。 */
export function SavedSearchesDialog({
  open,
  onClose,
  accountId,
  ctx,
  onApply,
}: {
  open: boolean
  onClose: () => void
  accountId: string | null
  ctx: DescribeContext
  onApply: (filter: FriendFilter, name: string) => void
}) {
  const [items, setItems] = useState<SavedFriendSearch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.friendSearches.list(accountId)
      if (res.success) setItems(res.data)
      else setError('保存した検索を読み込めませんでした')
    } catch {
      setError('保存した検索を読み込めませんでした')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const remove = async (id: string) => {
    setDeletingId(id)
    try {
      await api.friendSearches.delete(id)
      await load()
    } catch {
      setError('削除できませんでした')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog className="w-full max-w-2xl p-0">
        <div className="flex items-center justify-between border-b border-kumo-line px-5 py-3">
          <Dialog.Title className="text-base font-semibold text-kumo-strong">保存した検索</Dialog.Title>
          <Button type="button" size="xs" shape="square" variant="ghost" icon={XIcon} aria-label="閉じる" onClick={onClose} />
        </div>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto p-5">
          {!accountId ? (
            <Banner variant="default" title="LINEアカウントを選んでください" description="保存した検索は、LINEアカウントごとに管理されます。右上でアカウントを選んでから開いてください。" />
          ) : null}
          {error ? <Banner variant="error" title="エラー" description={error} /> : null}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-kumo-subtle"><Loader size="sm" /> 読み込み中</div>
          ) : accountId && items.length === 0 ? (
            <Empty size="sm" title="保存した検索はまだありません" description="詳細検索で絞り込んだあと、「この条件を保存」で保存できます。" />
          ) : (
            items.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 rounded-lg border border-kumo-line p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-kumo-strong">{s.name}</p>
                  <p className="mt-1 break-words text-xs text-kumo-subtle">{describeFilter(s.filter, ctx)}</p>
                </div>
                <div className="flex flex-none items-center gap-1.5">
                  <Button type="button" size="xs" variant="primary" onClick={() => onApply(s.filter, s.name)}>この条件で検索</Button>
                  <Button type="button" size="xs" shape="square" variant="ghost" icon={TrashIcon} aria-label={`${s.name}を削除`} loading={deletingId === s.id} onClick={() => void remove(s.id)} />
                </div>
              </div>
            ))
          )}
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
