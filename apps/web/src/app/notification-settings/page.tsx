'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BellRingingIcon, TrashIcon } from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Switch } from '@cloudflare/kumo/components/switch'
import { Table } from '@cloudflare/kumo/components/table'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { errorText } from '@/lib/error-text'
import { ApiError, api } from '@/lib/api'
import type { NotificationDestinationList, NotificationSettingItem, NotificationTimingCategory } from '@/lib/api'
import { describeSchedule, summarizeTimings } from './notification-format'

/** 通知設定の一覧(Lステップの「通知」)。通知先は beyond admin に登録された連絡先だけ。 */
export default function NotificationSettingsPage() {
  const { selectedAccount } = useAccount()
  const [items, setItems] = useState<NotificationSettingItem[]>([])
  const [catalog, setCatalog] = useState<NotificationTimingCategory[]>([])
  const [destinations, setDestinations] = useState<NotificationDestinationList | null>(null)
  const [adminLinked, setAdminLinked] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<NotificationSettingItem | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const accountId = selectedAccount?.id ?? null

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError('')
    try {
      const [list, cat, dest] = await Promise.all([
        api.notificationSettings.list(accountId),
        api.notificationSettings.catalog(),
        api.notificationSettings.destinations().catch(() => null),
      ])
      if (!list.success) throw new Error(list.error)
      setItems(list.data)
      setAdminLinked(list.adminLinked)
      if (cat.success) setCatalog(cat.data)
      setDestinations(dest && dest.success ? dest.data : null)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? '通知設定は、管理者だけが操作できます' : '読み込めませんでした。時間をおいてもう一度お試しください')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const timingLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of catalog) for (const t of c.timings) map.set(t.key, c.timings.length > 1 || c.key === 'event' || c.key === 'calendar' ? `${c.label}:${t.label}` : t.label)
    return map
  }, [catalog])

  const toggle = async (item: NotificationSettingItem, on: boolean) => {
    setBusyId(item.id)
    setError('')
    try {
      const res = await api.notificationSettings.update(item.id, { status: on ? 'on' : 'off' })
      if (!res.success) throw new Error(res.error)
      setItems((prev) => prev.map((x) => (x.id === item.id ? res.data : x)))
    } catch (err) {
      setError(errorText(err, '切り替えられませんでした'))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async () => {
    if (!deleting) return
    setBusyId(deleting.id)
    try {
      await api.notificationSettings.delete(deleting.id)
      setItems((prev) => prev.filter((x) => x.id !== deleting.id))
      setDeleting(null)
    } catch {
      setError('削除できませんでした')
    } finally {
      setBusyId(null)
    }
  }

  const noDestinations = destinations?.available === true && destinations.line.length + destinations.mail.length === 0

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Header
        title="通知設定"
        description="友だち追加やメッセージ・予約などがあったときに、スタッフへLINEやメールでお知らせします"
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setAddOpen(true)}>通知先の追加はこちら</Button>
            <Link
              href="/notification-settings/edit"
              className="inline-flex items-center gap-1 rounded-lg bg-kumo-brand px-4 py-2 text-sm font-medium text-kumo-inverse hover:bg-kumo-brand-hover"
            >
              通知設定を作成
            </Link>
          </div>
        }
      />

      {!selectedAccount && <p className="text-sm text-kumo-subtle">アカウントを選択してください。</p>}

      {error ? <Banner className="mb-4" variant="error" title={error} /> : null}

      {selectedAccount && !adminLinked ? (
        <Banner
          className="mb-4"
          variant="alert"
          title="beyond admin とつながっていません"
          description="通知先は beyond admin に登録された連絡先から選びます。つながるまで、通知は送られません。"
        />
      ) : null}

      {selectedAccount && adminLinked && destinations && !destinations.available ? (
        <Banner className="mb-4" variant="alert" title="通知先を確認できません" description={destinations.reason ?? 'beyond admin につながりません'} />
      ) : null}

      {selectedAccount && noDestinations ? (
        <Banner
          className="mb-4"
          variant="alert"
          title="通知先がまだ登録されていません"
          description="「通知先の追加はこちら」から、LINEまたはメールの通知先を登録すると、通知設定をオンにできます。"
        />
      ) : null}

      {selectedAccount ? (
        <LayerCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <Table.Header>
                <Table.Row>
                  <Table.Head>タイトル</Table.Head>
                  <Table.Head>内容</Table.Head>
                  <Table.Head>通知先</Table.Head>
                  <Table.Head>スケジュール</Table.Head>
                  <Table.Head>状態</Table.Head>
                  <Table.Head />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {loading ? (
                  <Table.Row>
                    <Table.Cell colSpan={6} className="py-12 text-center">
                      <span className="inline-flex items-center gap-2 text-sm text-kumo-subtle">
                        <Loader size="sm" /> 読み込み中
                      </span>
                    </Table.Cell>
                  </Table.Row>
                ) : items.length === 0 ? (
                  <Table.Row>
                    <Table.Cell colSpan={6} className="p-0">
                      <Empty size="sm" icon={<BellRingingIcon size={32} />} title="通知設定がありません" />
                    </Table.Cell>
                  </Table.Row>
                ) : (
                  items.map((item) => (
                    <Table.Row key={item.id}>
                      <Table.Cell>
                        <Link href={`/notification-settings/edit?id=${item.id}`} className="font-medium text-kumo-link hover:underline">
                          {item.title}
                        </Link>
                        {item.isDefault ? <Badge className="ml-2" variant="neutral">標準</Badge> : null}
                      </Table.Cell>
                      <Table.Cell className="text-sm">{summarizeTimings(item.timings, timingLabels)}</Table.Cell>
                      <Table.Cell className="text-sm">
                        {item.destinations.length === 0 ? (
                          <span className="text-kumo-subtle">未設定</span>
                        ) : (
                          item.destinations.map((d) => `${d.kind === 'mail' ? 'メール' : 'LINE'}:${d.name || d.id.slice(0, 6)}`).join('、')
                        )}
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-sm">{describeSchedule(item.schedule)}</Table.Cell>
                      <Table.Cell>
                        <Switch
                          checked={item.status === 'on'}
                          disabled={busyId === item.id || (item.status === 'off' && item.destinations.length === 0)}
                          onCheckedChange={(on) => void toggle(item, on)}
                          aria-label={`${item.title}を${item.status === 'on' ? 'オフ' : 'オン'}にする`}
                        />
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        <Button variant="ghost" size="sm" aria-label={`${item.title}を削除`} onClick={() => setDeleting(item)}>
                          <TrashIcon size={16} />
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table>
          </div>
        </LayerCard>
      ) : null}

      <p className="mt-4 text-xs text-kumo-subtle">
        通知先は、beyond admin に登録された連絡先だけ選べます。通知先を決めるまで、標準の設定はオフになっています。
      </p>

      <Dialog.Root open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <Dialog size="sm" className="p-6">
          <Dialog.Title className="mb-2 text-lg font-semibold">通知設定を削除しますか?</Dialog.Title>
          <p className="mb-4 text-sm text-kumo-subtle">「{deleting?.title}」を削除します。削除すると、この通知は届かなくなります。</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)}>キャンセル</Button>
            <Button variant="destructive" loading={busyId === deleting?.id} onClick={() => void remove()}>削除する</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      <AddDestinationDialog open={addOpen} onClose={() => setAddOpen(false)} adminUrl={destinations?.adminUrl ?? null} onAdded={() => void load()} />
    </main>
  )
}

function AddDestinationDialog({ open, onClose, adminUrl, onAdded }: { open: boolean; onClose: () => void; adminUrl: string | null; onAdded: () => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (open) setMessage(null)
  }, [open])

  const submit = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await api.notificationSettings.addMailDestination({ email: email.trim(), displayName: name.trim() || undefined })
      if (!res.success) throw new Error(res.error)
      setMessage({ ok: true, text: `${email.trim()} に確認メールを送りました。メールのリンクを開くと、通知先として選べるようになります。` })
      setEmail('')
      setName('')
      onAdded()
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, '登録できませんでした') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="base" className="p-6">
        <Dialog.Title className="mb-1 text-lg font-semibold">通知先の追加</Dialog.Title>
        <p className="mb-4 text-sm text-kumo-subtle">通知先は beyond admin に登録されます。登録が済むと、通知設定の通知先として選べます。</p>

        <section className="mb-5">
          <h3 className="mb-2 text-sm font-semibold">メールで受け取る</h3>
          <div className="flex flex-col gap-2">
            <Input aria-label="メールアドレス" type="email" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input aria-label="表示名" placeholder="表示名(例: 店長 山田)" value={name} onChange={(e) => setName(e.target.value)} />
            <div>
              <Button variant="primary" loading={busy} disabled={!email.trim()} onClick={() => void submit()}>確認メールを送る</Button>
            </div>
          </div>
          {message ? <p className={`mt-2 text-sm ${message.ok ? 'text-kumo-success' : 'text-kumo-danger'}`}>{message.text}</p> : null}
        </section>

        <section className="mb-5">
          <h3 className="mb-2 text-sm font-semibold">LINEで受け取る</h3>
          <p className="mb-2 text-sm text-kumo-subtle">beyond admin の「LINE通知」画面で、表示される6桁のコードを公式アカウントに送ると登録できます。</p>
          {adminUrl ? (
            <a href={`${adminUrl}/settings/line`} target="_blank" rel="noreferrer" className="text-sm text-kumo-link hover:underline">
              beyond admin のLINE通知画面を開く
            </a>
          ) : (
            <p className="text-sm text-kumo-subtle">beyond admin とつながると、ここにリンクが出ます。</p>
          )}
        </section>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>閉じる</Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
