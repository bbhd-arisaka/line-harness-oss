'use client'

import { useState, useEffect, useCallback } from 'react'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Pagination } from '@cloudflare/kumo/components/pagination'
import { Select } from '@cloudflare/kumo/components/select'
import type { Tag } from '@line-crm/shared'
import { api, fetchApi } from '@/lib/api'
import type { FriendListItem } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendListTable from '@/components/friends/friend-list-table'
import CcPromptButton from '@/components/cc-prompt-button'
import { AdvancedSearchDialog } from '@/components/friends/advanced-search-dialog'
import { SavedSearchesDialog } from '@/components/friends/saved-searches-dialog'
import { cleanFilter, describeFilter, emptyFilter, isFilterEmpty, type DescribeContext, type FriendFilter } from '@/lib/friend-filter'
import { useAccount } from '@/contexts/account-context'

const ccPrompts = [
  {
    title: '友だちのセグメント分析',
    prompt: `友だち一覧のデータを分析してください。
1. タグ別の友だち数を集計
2. アクティブ率の高いセグメントを特定
3. エンゲージメントが低い層への施策を提案
レポート形式で出力してください。`,
  },
  {
    title: 'タグ一括管理',
    prompt: `友だちのタグを一括管理してください。
1. 未タグの友だちを特定
2. 行動履歴に基づいたタグ付け提案
3. 不要タグの整理
作業手順を示してください。`,
  },
]

const DEFAULT_PAGE_SIZE = 20

type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'

export default function FriendsPage() {
  const { selectedAccountId } = useAccount()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 友だち情報欄一覧の「友だち人数」から来たときの絞り込み(その項目に値が入っている友だち)
  const [fieldFilter, setFieldFilter] = useState<{ key: string; label: string } | null>(null)
  // 詳細検索(Lステップの「絞り込み条件を設定」)と、保存した検索
  const [filter, setFilter] = useState<FriendFilter>(emptyFilter)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [filterCtx, setFilterCtx] = useState<DescribeContext>({ tags: [], fields: [], scenarios: [], forms: [] })
  const [saveName, setSaveName] = useState('')
  const [savingSearch, setSavingSearch] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const filterActive = !isFilterEmpty(filter)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const key = q.get('fieldKey')
    if (key) setFieldFilter({ key, label: q.get('fieldLabel') || key })
  }, [])

  // 保存した検索・条件の表示に使う、名前の一覧(タグ・友だち情報欄・シナリオ・フォーム)
  useEffect(() => {
    let cancelled = false
    const part = (patch: Partial<DescribeContext>) => { if (!cancelled) setFilterCtx((c) => ({ ...c, ...patch })) }
    api.tags.list().then((r) => { if (r.success) part({ tags: r.data.map((t) => ({ id: t.id, name: t.name })) }) }).catch(() => undefined)
    fetchApi<{ success: boolean; data: Array<{ fieldKey: string; label: string }> }>('/api/friend-fields/definitions').then((r) => { if (r.success) part({ fields: r.data }) }).catch(() => undefined)
    api.scenarios.list({ accountId: selectedAccountId || undefined }).then((r) => { if (r.success) part({ scenarios: r.data.map((s) => ({ id: s.id, name: s.name })) }) }).catch(() => undefined)
    fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>('/api/forms').then((r) => { if (r.success) part({ forms: r.data.map((f) => ({ id: f.id, name: f.name })) }) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedAccountId])

  const loadTags = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success) setAllTags(res.data)
    } catch {
      // Non-blocking — tags used for filter
    }
  }, [])

  const loadFriends = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.friends.list({
        offset: String((page - 1) * pageSize),
        limit: pageSize,
        filter: filterActive ? cleanFilter(filter) : undefined,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: true,
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
        fieldKey: fieldFilter?.key,
      })
      if (res.success) {
        setFriends(res.data.items)
        setTotal(res.data.total)
      } else {
        setError(res.error)
      }
    } catch {
      setError('友だちの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filter, filterActive, selectedTagId, selectedAccountId, searchSubmitted, sortMode, responseFilter, fieldFilter])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  // Reset the URL-style account context to page 1 in a separate effect.
  // For user-driven filter changes (search/sort/handled/tag) we reset
  // page synchronously inside the handlers below — that avoids the
  // double-fetch race where the old `page` request resolves after the
  // new `page=1` request and overwrites the correct page-1 rows.
  useEffect(() => {
    setPage(1)
  }, [selectedAccountId])

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  // Fan-out helpers: changing a filter also resets pagination synchronously,
  // so React batches both state updates into one re-render and `loadFriends`
  // fires exactly once with the new filter + page=1.
  const updateAndResetPage = (cb: () => void) => {
    cb()
    setPage(1)
  }
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateAndResetPage(() => setSearchSubmitted(searchInput.trim()))
  }
  // Clearing the input clears the active search even if the user doesn't
  // press 検索 again. Without this, "search Alice → clear input → change
  // tag" would keep filtering by Alice while the input box looks empty —
  // see codex feedback. Keeping a non-empty input that doesn't match
  // searchSubmitted is fine: the user is mid-edit, hasn't applied yet.
  const handleSearchInputChange = (v: string) => {
    setSearchInput(v)
    if (v.trim() === '' && searchSubmitted !== '') {
      updateAndResetPage(() => setSearchSubmitted(''))
    }
  }
  const handleSortChange = (v: SortMode) => updateAndResetPage(() => setSortMode(v))
  const handleResponseFilterChange = (v: ResponseFilter) => updateAndResetPage(() => setResponseFilter(v))
  const handleTagFilterChange = (v: string) => updateAndResetPage(() => setSelectedTagId(v))
  const applyAdvanced = (next: FriendFilter, sort: SortMode, size: number, ctx: DescribeContext) => {
    updateAndResetPage(() => {
      setFilter(next)
      setSortMode(sort)
      setPageSize(size)
      setFilterCtx(ctx)
    })
    setSaveMessage('')
    setAdvancedOpen(false)
  }
  const applySaved = (next: FriendFilter, name: string) => {
    updateAndResetPage(() => setFilter(next))
    setSaveName(name)
    setSaveMessage('')
    setSavedOpen(false)
  }
  const resetAdvanced = () => {
    updateAndResetPage(() => setFilter(emptyFilter()))
    setSaveName('')
    setSaveMessage('')
  }
  const saveCurrentSearch = async () => {
    const name = saveName.trim()
    if (!name || !selectedAccountId || savingSearch) return
    setSavingSearch(true)
    setSaveMessage('')
    try {
      const res = await api.friendSearches.create({ lineAccountId: selectedAccountId, name, filter: cleanFilter(filter) })
      setSaveMessage(res.success ? `「${name}」として保存しました` : '保存できませんでした')
    } catch {
      setSaveMessage('保存できませんでした')
    } finally {
      setSavingSearch(false)
    }
  }

  return (
    <div>
      <Header
        title="友だちリスト"
        description="友だちの検索や、詳細情報の確認ができます。"
      />

      {fieldFilter && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-2 rounded bg-[#e6f5e5] px-3 py-1.5 font-bold text-[#069e04]">
            友だち情報欄「{fieldFilter.label}」に値がある友だち
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-label="絞り込みを解除"
              onClick={() => { setFieldFilter(null); setPage(1); window.history.replaceState(null, '', window.location.pathname) }}
            >
              ×
            </Button>
          </span>
        </div>
      )}

      <LayerCard className="mb-4 p-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            placeholder="友だち名を検索"
            aria-label="友だち名"
            className="flex-1"
          />
          <Select
            value={sortMode}
            onValueChange={(value) => handleSortChange((value ?? 'recent') as SortMode)}
            aria-label="並び順"
            items={{ recent: '友だち追加の新しい順', oldest: '友だち追加の古い順' }}
          />
          <Button type="submit" variant="primary" icon={MagnifyingGlassIcon}>
            検索
          </Button>
          <Button type="button" variant="primary" onClick={() => setAdvancedOpen(true)}>
            詳細検索
          </Button>
          <Button type="button" variant="secondary" onClick={() => setSavedOpen(true)}>
            保存した検索
          </Button>
        </form>

        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-kumo-line pt-3">
          <Select
            size="sm"
            label="タグ"
            value={selectedTagId}
            onValueChange={(value) => handleTagFilterChange(value ?? '')}
            items={[{ value: '', label: 'すべて' }, ...allTags.map((tag) => ({ value: tag.id, label: tag.name }))]}
          />
          <Select
            size="sm"
            label="対応マーク"
            value={responseFilter}
            onValueChange={(value) => handleResponseFilterChange((value ?? 'all') as ResponseFilter)}
            items={{ all: 'すべて', unhandled: '未対応のみ' }}
          />
          <span className="ml-auto pb-1 text-xs text-kumo-subtle">
            {loading ? '読み込み中' : `${total.toLocaleString('ja-JP')} 件`}
          </span>
        </div>
      </LayerCard>

      {filterActive && (
        <LayerCard className="mb-4 space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 break-words text-sm text-kumo-strong">
              <span className="font-semibold">条件:</span> {describeFilter(filter, filterCtx)}
            </p>
            <Button type="button" size="xs" variant="secondary" onClick={resetAdvanced}>条件リセット</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="保存する検索の名前"
              placeholder="カスタム検索名"
              value={saveName}
              onValueChange={setSaveName}
              className="w-full sm:w-64"
            />
            <Button type="button" size="sm" variant="secondary" loading={savingSearch} disabled={!saveName.trim() || !selectedAccountId} onClick={() => void saveCurrentSearch()}>
              この条件を保存
            </Button>
            {saveMessage ? <span className="text-xs text-kumo-subtle" role="status">{saveMessage}</span> : null}
          </div>
        </LayerCard>
      )}

      {error ? <Banner className="mb-4" variant="error" title="友だちを読み込めませんでした" description={error} /> : null}

      {loading ? (
        <LayerCard className="flex min-h-48 items-center justify-center gap-2 text-sm text-kumo-subtle">
          <Loader size="sm" /> 友だちを読み込み中
        </LayerCard>
      ) : (
        <FriendListTable friends={friends} allTags={allTags} onRefresh={loadFriends} />
      )}

      {!loading && total > 0 && (
        <Pagination
          className="mt-4"
          page={page}
          setPage={setPage}
          perPage={pageSize}
          totalCount={total}
          labels={{ navigation: '友だち一覧のページ', firstPage: '最初のページ', previousPage: '前のページ', nextPage: '次のページ', lastPage: '最後のページ', pageNumber: 'ページ番号' }}
        >
          <Pagination.Info>{({ pageShowingRange }) => `${pageShowingRange}件 / 全${total.toLocaleString('ja-JP')}件`}</Pagination.Info>
          <Pagination.Controls controls="full" pageSelector="input" />
        </Pagination>
      )}

      <AdvancedSearchDialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        accountId={selectedAccountId || null}
        initial={filter}
        initialSort={sortMode}
        initialPageSize={pageSize}
        onApply={applyAdvanced}
      />
      <SavedSearchesDialog
        open={savedOpen}
        onClose={() => setSavedOpen(false)}
        accountId={selectedAccountId || null}
        ctx={filterCtx}
        onApply={applySaved}
      />

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
