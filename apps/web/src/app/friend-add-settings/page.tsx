'use client'

import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import FriendAddSettingsEditor from '@/components/friend-add/friend-add-settings-editor'

/** 友だち追加時設定(Lステップと同じ画面)。上のアカウント選択で選んだ公式アカウントの設定。 */
export default function FriendAddSettingsPage() {
  const { selectedAccount } = useAccount()
  return (
    <main className="mx-auto max-w-6xl p-6">
      <Header title="友だち追加時設定" />
      {selectedAccount ? (
        <FriendAddSettingsEditor key={selectedAccount.id} accountId={selectedAccount.id} />
      ) : (
        <p className="text-sm text-gray-500">アカウントを選択してください。</p>
      )}
    </main>
  )
}
