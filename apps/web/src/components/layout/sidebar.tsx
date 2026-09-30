'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { StarIcon, MegaphoneIcon, FunnelIcon, FlagIcon, FolderOpenIcon, GearIcon } from '@phosphor-icons/react'
import { useActivityPolling } from '@/hooks/use-activity-polling'
import { PollingStatus } from '@/components/shared/polling-status'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'

const appVersion = process.env.APP_VERSION || '0.0.0'
const appCommitSha = process.env.APP_COMMIT_SHA || 'local'

// ─── メニュー定義(Lステップのサイドバーの並び・名称に合わせる) ───
// beyond line 独自の画面は Lステップに無いので、近いカテゴリの末尾にまとめる。

type MenuItem = { href: string; label: string; danger?: boolean }
type MenuSection = { label: string | null; icon?: 'star' | 'megaphone' | 'funnel' | 'flag' | 'folder' | 'gear'; items: MenuItem[] }

const menuSections: MenuSection[] = [
  {
    label: null,
    items: [{ href: '/', label: 'トップ' }],
  },
  {
    label: '1対1トーク',
    icon: 'star',
    items: [
      { href: '/friends', label: '友だちリスト' },
      { href: '/notifications', label: 'トーク一覧' },
      { href: '/chats', label: '個別トーク' },
    ],
  },
  {
    label: 'メッセージ',
    icon: 'megaphone',
    items: [
      { href: '/scenarios', label: 'シナリオ配信' },
      { href: '/broadcasts', label: '一斉配信' },
      { href: '/auto-replies', label: '自動応答' },
      { href: '/templates', label: 'テンプレート' },
      { href: '/events', label: 'イベント予約' },
      { href: '/booking/bookings', label: 'カレンダー予約' },
      { href: '/form-submissions', label: '回答フォーム' },
      { href: '/reminders', label: 'リマインダ配信' },
      { href: '/friend-add-settings', label: '友だち追加時設定' },
      { href: '/automations', label: 'アクション管理' },
      { href: '/webinars', label: 'ウェビナー' },
    ],
  },
  {
    label: '友だち属性',
    icon: 'funnel',
    items: [
      { href: '/tags', label: 'タグ管理' },
      { href: '/friend-fields', label: '友だち情報欄管理' },
      // 重複検出・ユーザー一覧は、同一人物をアカウントをまたいで結合する機能のため非表示
      // (友だちはアカウントごとに別の人として扱う)
    ],
  },
  {
    label: '統計情報',
    icon: 'flag',
    items: [
      { href: '/inflow-links', label: '流入経路分析' },
      { href: '/conversions', label: 'コンバージョン管理' },
      { href: '/affiliates', label: 'アフィリエイト' },
      // マイルは、アカウントをまたぐ機能のため非表示
    ],
  },
  {
    label: 'コンテンツ',
    icon: 'folder',
    items: [
      { href: '/media', label: '登録メディア一覧' },
      { href: '/rich-menus', label: 'リッチメニュー' },
      { href: '/pools', label: 'プール管理' },
      { href: '/plugins', label: 'プラグインマーケット' },
      { href: '/news', label: 'アップデートニュース' },
    ],
  },
  {
    label: '設定',
    icon: 'gear',
    items: [
      { href: '/accounts', label: 'LINE公式アカウント設定' },
      { href: '/staff', label: 'スタッフ設定' },
      { href: '/imports', label: 'データ引き継ぎ' },
      { href: '/booking/menus', label: '予約メニュー' },
      { href: '/booking/staff', label: '予約スタッフ' },
      { href: '/webhooks', label: 'Webhook' },
      { href: '/health', label: 'BAN検知' },
      { href: '/updates', label: 'アップデート履歴' },
      { href: '/emergency', label: '緊急コントロール', danger: true },
    ],
  },
]

const SECTION_ICONS = {
  star: StarIcon,
  megaphone: MegaphoneIcon,
  funnel: FunnelIcon,
  flag: FlagIcon,
  folder: FolderOpenIcon,
  gear: GearIcon,
} as const

/** 左サイドバー(Lステップ準拠: 濃いグレー背景・白文字・緑のセクション見出し)。 */
export default function Sidebar({
  mobileOpen,
  onMobileClose,
  collapsed,
}: {
  mobileOpen: boolean
  onMobileClose: () => void
  collapsed: boolean
}) {
  const pathname = usePathname()
  const [staffRole, setStaffRole] = useState<string | null>(null)

  useEffect(() => {
    setStaffRole(localStorage.getItem('lh_staff_role'))
  }, [])

  // 未対応件数 polling — メニュー項目にバッジを出す。5 分間隔。
  // (裏の countUnanswered は messages_log 全走査を含む重い集計なので間隔は詰めない。)
  // チャット画面での status 変更・手動返信直後は UNANSWERED_REFRESH_EVENT で
  // 即時再取得する (ポーリング待ちだと操作してもバッジが減らないと感じるため)。
  const [unansweredCount, setUnansweredCount] = useState<number>(0)
  const polling = useActivityPolling({
    intervalMs: 5 * 60_000,
    refreshEvent: UNANSWERED_REFRESH_EVENT,
    load: async (signal) => {
      const { api } = await import('@/lib/api')
      return api.inbox.unanswered.count({ signal })
    },
    onData: (res) => { if (res.success) setUnansweredCount(res.data.total) },
    onError: () => {}, // Keep the last count on transient failure.
  })

  useEffect(() => { onMobileClose() }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  const nav = (
    <>
      <nav className="flex-1 overflow-y-auto py-2 text-sm text-white">
        {menuSections.map((section, si) => {
          const SectionIcon = section.icon ? SECTION_ICONS[section.icon] : null
          return (
            <div key={si}>
              {section.label && (
                <div className="mt-2 flex items-center gap-2 border-b border-[#6fc665] px-4 pb-1.5 pt-2 text-xs font-bold text-[#6fc665]">
                  {SectionIcon && <SectionIcon size={13} weight="fill" />}
                  <span>{section.label}</span>
                </div>
              )}
              <ul>
                {section.items.filter((item) => {
                  if (item.href === '/staff' && staffRole !== 'owner') return false
                  if (item.href === '/accounts' && staffRole === 'staff') return false
                  return true
                }).map((item) => {
                  const active = isActive(item.href)
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center justify-between py-1.5 pl-8 pr-3 leading-6 transition-colors hover:bg-white/10 ${
                          active ? 'bg-white/15 font-bold' : ''
                        } ${item.danger ? 'text-red-300' : 'text-white'}`}
                      >
                        <span>{item.label}</span>
                        {item.href === '/notifications' && unansweredCount > 0 && (
                          <span className="rounded-full bg-[#e5451f] px-1.5 text-[11px] font-bold leading-5 text-white tabular-nums">
                            {unansweredCount > 99 ? '99+' : unansweredCount}
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>
      <div className="px-3 pb-2"><PollingStatus reason={polling.reason} onResume={polling.resume} /></div>
      <p className="px-4 pb-3 text-[10px] leading-4 text-white/40">
        beyond line v{appVersion}
        <br />
        build {appCommitSha}
      </p>
    </>
  )

  return (
    <>
      {/* モバイル: オーバーレイ + スライドイン */}
      {mobileOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={onMobileClose} />}
      <aside
        className={`lg:hidden fixed left-0 top-12 z-50 flex h-[calc(100dvh-48px)] w-64 transform flex-col bg-[#414143] transition-transform duration-300 ease-in-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {nav}
      </aside>

      {/* デスクトップ: 常時表示(トップバーの « で、幅がなめらかに縮んで折りたたまれる) */}
      <aside
        aria-hidden={collapsed}
        className={`hidden flex-shrink-0 overflow-hidden bg-[#414143] transition-[width] duration-300 ease-in-out lg:flex ${
          collapsed ? 'w-0' : 'w-60'
        }`}
      >
        <div className={`flex w-60 flex-shrink-0 flex-col transition-opacity duration-200 ${collapsed ? 'opacity-0' : 'opacity-100'}`}>
          {nav}
        </div>
      </aside>
    </>
  )
}
