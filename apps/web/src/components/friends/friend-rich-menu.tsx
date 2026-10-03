'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { api } from '@/lib/api'

// 友だちに「いま設定されているリッチメニュー」を表示する(友だち詳細・トークの友だち詳細パネルで共通)。
// LINE に問い合わせて、個別に設定されたメニュー、なければデフォルトのメニューを出す。

export interface FriendRichMenuInfo {
  id: string | null
  name: string | null
  isDefault: boolean
  chatBarText?: string | null
  /** beyond line の「リッチメニュー」画面で作ったメニューなら、そのグループ・ページ名 */
  groupName?: string | null
  pageName?: string | null
  accountId?: string | null
}

export type FriendRichMenuState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'data'; menu: FriendRichMenuInfo }

/** null=未設定 と 取得失敗 を混同しないように、3つの状態で持つ */
export function useFriendRichMenu(friendId: string | null): { state: FriendRichMenuState; reload: () => void } {
  const [state, setState] = useState<FriendRichMenuState>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!friendId) {
      setState({ kind: 'loading' })
      return
    }
    let cancelled = false
    setState({ kind: 'loading' })
    api.friends.richMenu(friendId)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) setState({ kind: 'data', menu: res.data })
        else setState({ kind: 'error' })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' })
      })
    return () => { cancelled = true }
  }, [friendId, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { state, reload }
}

export function FriendRichMenuView({ state, onReload, compact = false }: { state: FriendRichMenuState; onReload: () => void; compact?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false)
  const menuId = state.kind === 'data' ? state.menu.id : null
  useEffect(() => { setImageFailed(false) }, [menuId])

  if (state.kind === 'loading') {
    return <p className={compact ? 'text-[11px] italic text-gray-400' : 'text-sm text-kumo-subtle'}>読み込み中...</p>
  }
  if (state.kind === 'error') {
    return (
      <div className="flex items-center gap-2">
        <p className={compact ? 'text-[11px] italic text-red-500' : 'text-sm text-red-600'}>取得に失敗しました</p>
        <Button type="button" variant="secondary" size="xs" onClick={onReload}>再取得</Button>
      </div>
    )
  }

  const { menu } = state
  if (menu.id === null) {
    return <p className={compact ? 'text-[11px] italic text-gray-400' : 'text-sm text-kumo-subtle'}>リッチメニューは設定されていません</p>
  }

  const imageUrl = menu.accountId && !imageFailed ? api.richMenuGroups.externalImageUrl(menu.id, menu.accountId) : null
  const sub = [menu.groupName ? `グループ: ${menu.groupName}` : null, menu.pageName ? `ページ: ${menu.pageName}` : null].filter(Boolean).join(' / ')
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={compact ? 'text-xs font-medium text-gray-800' : 'text-sm font-medium text-kumo-strong'}>{menu.name ?? '(名前なし)'}</span>
        <span className={`rounded px-1.5 py-0 text-[10px] font-medium ${menu.isDefault ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>
          {menu.isDefault ? 'デフォルト' : '個別に設定'}
        </span>
      </div>
      {sub ? <p className={compact ? 'text-[11px] text-gray-500' : 'text-xs text-kumo-subtle'}>{sub}</p> : null}
      {menu.chatBarText ? <p className={compact ? 'text-[11px] text-gray-500' : 'text-xs text-kumo-subtle'}>メニューバー: {menu.chatBarText}</p> : null}
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={menu.name ?? 'リッチメニュー'}
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="mt-1 max-h-28 rounded border border-gray-200 object-contain"
        />
      ) : null}
    </div>
  )
}
