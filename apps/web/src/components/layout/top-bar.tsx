'use client'

import { useState } from 'react'
import { CaretDownIcon, CheckIcon, CaretDoubleLeftIcon, ListIcon } from '@phosphor-icons/react'
import { DropdownMenu } from '@cloudflare/kumo/components/dropdown'
import { useAccount } from '@/contexts/account-context'
import type { AccountWithStats } from '@/contexts/account-context'
import { countryFlag } from '@/lib/country-flag'
import { getApiBase } from '@/lib/api-base'
import { withBasePath } from '@/lib/base-path'

function AccountAvatar({ account, size = 24 }: { account: AccountWithStats; size?: number }) {
  const displayName = account.displayName || account.name
  if (account.pictureUrl) {
    return (
      <img
        src={account.pictureUrl}
        alt={displayName}
        className="shrink-0 rounded-full border border-white/70 object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-white/90 font-bold text-[#069e04]"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {displayName.charAt(0)}
    </div>
  )
}

/** 右上のLINEアカウント切替(Lステップの店舗切替と同じ位置・見た目)。 */
function AccountSwitcher() {
  const { accounts, selectedAccount, setSelectedAccountId, loading } = useAccount()
  const [open, setOpen] = useState(false)
  if (loading || accounts.length === 0) return null
  const displayName = selectedAccount?.displayName || selectedAccount?.name || ''

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        render={
          <button
            type="button"
            className="flex h-12 items-center gap-2 px-4 text-sm font-bold text-white hover:bg-white/10"
          />
        }
      >
        {selectedAccount ? <AccountAvatar account={selectedAccount} size={24} /> : null}
        {countryFlag(selectedAccount?.country) ? <span className="leading-none">{countryFlag(selectedAccount?.country)}</span> : null}
        <span className="max-w-[16rem] truncate">{displayName}</span>
        <CaretDownIcon size={12} weight="bold" className={open ? 'rotate-180' : ''} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" className="min-w-56">
        <DropdownMenu.Group>
          <DropdownMenu.Label>切り替えるLINEアカウント</DropdownMenu.Label>
          {accounts.map((account) => {
            const isSelected = account.id === selectedAccount?.id
            const name = account.displayName || account.name
            return (
              <DropdownMenu.Item
                key={account.id}
                selected={isSelected}
                icon={<AccountAvatar account={account} size={24} />}
                onClick={() => setSelectedAccountId(account.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate">
                    {countryFlag(account.country) ? <span className="leading-none">{countryFlag(account.country)}</span> : null}
                    <span className="truncate">{name}</span>
                  </span>
                  {account.basicId ? <span className="block truncate text-xs text-kumo-subtle">{account.basicId}</span> : null}
                </span>
                {isSelected ? <CheckIcon className="shrink-0 text-kumo-success" size={16} weight="bold" /> : null}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}

async function logout() {
  let beyondAdminLogoutUrl: string | null = null
  try {
    const apiUrl = getApiBase()
    if (apiUrl) {
      // beyond admin のログインで入っていた人は、beyond admin 側のログインも終わらせる(終わらせないと、すぐ戻ってしまう)
      if (localStorage.getItem('lh_login_via') === 'beyond-admin') {
        const cfg = await fetch(`${apiUrl}/api/auth/config`).then((r) => r.json()).catch(() => null)
        beyondAdminLogoutUrl = cfg?.data?.beyondAdmin?.logoutUrl ?? null
      }
      await fetch(`${apiUrl}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    }
  } catch {
    // Local cleanup still logs the browser out if the network call fails.
  }
  localStorage.removeItem('lh_api_key')
  localStorage.removeItem('lh_csrf')
  localStorage.removeItem('lh_staff_name')
  localStorage.removeItem('lh_staff_role')
  localStorage.removeItem('lh_login_via')
  if (beyondAdminLogoutUrl) {
    const back = `${window.location.origin}${withBasePath('/login')}`
    window.location.href = `${beyondAdminLogoutUrl}?next=${encodeURIComponent(back)}`
    return
  }
  window.location.href = withBasePath('/login')
}

const ROLE_LABEL: Record<string, string> = { owner: 'オーナー', admin: '管理者', staff: 'スタッフ' }

/** 画面最上部の緑グラデーションのバー(Lステップ準拠)。 */
export default function TopBar({ onToggleMenu, collapsed = false }: { onToggleMenu: () => void; collapsed?: boolean }) {
  const [staffName] = useState(() => (typeof window === 'undefined' ? null : localStorage.getItem('lh_staff_name')))
  const [staffRole] = useState(() => (typeof window === 'undefined' ? null : localStorage.getItem('lh_staff_role')))

  return (
    <header
      className="z-30 flex h-12 flex-shrink-0 items-center justify-between text-white"
      style={{ backgroundImage: 'linear-gradient(160deg, #08b43d, #007991)' }}
    >
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggleMenu}
          aria-label="メニューの開閉"
          className="flex h-12 w-12 items-center justify-center hover:bg-white/10"
        >
          <CaretDoubleLeftIcon size={16} weight="bold" className={`max-lg:hidden transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
          <ListIcon size={20} weight="bold" className="lg:hidden" />
        </button>
        <span className="text-[22px] font-black italic tracking-tight" style={{ textShadow: '0 1px 0 rgba(0,0,0,.15)' }}>
          beyond line
        </span>
      </div>
      <div className="flex items-center">
        {staffName && (
          <span className="hidden items-center gap-1.5 px-4 text-sm font-bold sm:flex">
            <span className="max-w-[12rem] truncate">{staffName}</span>
            {staffRole && <span className="text-xs font-normal">({ROLE_LABEL[staffRole] ?? staffRole})</span>}
          </span>
        )}
        <AccountSwitcher />
        <button
          type="button"
          onClick={() => void logout()}
          className="h-12 px-4 text-sm font-bold hover:bg-white/10"
        >
          ログアウト
        </button>
      </div>
    </header>
  )
}
