'use client'

import { useRef, useState } from 'react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Select } from '@cloudflare/kumo/components/select'
import { Tabs } from '@cloudflare/kumo/components/tabs'
import type { Tag } from '@line-crm/shared'
import { api, type ApiBroadcast } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import MessageListEditor, { draftMessagesProblem, newDraftMessage, type DraftMessage } from './message-list-editor'
import MultiAccountDedupSection from './multi-account-dedup-section'

interface BroadcastFormProps {
  tags: Tag[]
  onSuccess: () => void
  onCancel: () => void
  /** テンプレートから作るとき: 最初から入れておくタイトルとメッセージ */
  seed?: { title: string; messages: DraftMessage[] }
}

interface FormState {
  title: string
  /** 配信するメッセージ(1〜5通)。上から順に届く */
  messages: DraftMessage[]
  targetType: ApiBroadcast['targetType']
  targetTagId: string
  scheduledAt: string
  sendNow: boolean
  accountIds: string[]
  dedupPriority: string[]
  trackLinks: boolean
}

export default function BroadcastForm({ tags, onSuccess, onCancel, seed }: BroadcastFormProps) {
  const { selectedAccountId } = useAccount()
  // Network timeout後の再クリックでも同じ作成要求として扱い、二重予約を防ぐ。
  const createIdempotencyKey = useRef(crypto.randomUUID())
  const [form, setForm] = useState<FormState>({
    title: seed?.title ?? '',
    messages: seed?.messages.length ? seed.messages : [newDraftMessage()],
    targetType: 'all',
    targetTagId: '',
    scheduledAt: '',
    sendNow: true,
    accountIds: [],
    dedupPriority: [],
    trackLinks: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!form.title.trim()) { setError('配信タイトルを入力してください'); return }
    const messageProblem = draftMessagesProblem(form.messages)
    if (messageProblem) { setError(messageProblem); return }
    if (!form.sendNow && !form.scheduledAt) {
      setError('予約配信の場合は配信日時を指定してください')
      return
    }
    if (form.targetType === 'multi-account-dedup' && form.accountIds.length === 0) {
      setError('複数アカ重複除外: 配信先アカウントを 1 つ以上選択してください')
      return
    }

    setSaving(true)
    setError('')
    try {
      const res = await api.broadcasts.create({
        title: form.title,
        messages: form.messages.map((m) => ({ type: m.type, content: m.content })),
        targetType: form.targetType,
        // tag mode: required; multi-account-dedup mode: optional narrowing filter; else: null
        targetTagId:
          form.targetType === 'tag'
            ? form.targetTagId || null
            : form.targetType === 'multi-account-dedup'
            ? form.targetTagId || null
            : null,
        status: 'draft',
        lineAccountId: form.targetType === 'multi-account-dedup' ? null : (selectedAccountId || null),
        accountIds: form.targetType === 'multi-account-dedup' ? form.accountIds : undefined,
        dedupPriority: form.targetType === 'multi-account-dedup' ? form.dedupPriority : undefined,
        trackLinks: form.trackLinks,
        // datetime-local returns YYYY-MM-DDTHH:mm in JST wall-clock time
        // Append +09:00 so new Date() parses correctly for epoch comparisons
        scheduledAt: form.sendNow || !form.scheduledAt
          ? null
          : form.scheduledAt + ':00.000+09:00',
      }, { idempotencyKey: createIdempotencyKey.current })
      if (res.success) {
        onSuccess()
      } else {
        setError(res.error)
      }
    } catch {
      setError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <LayerCard className="mb-6 p-6">
      <h2 className="mb-5 text-sm font-semibold text-kumo-strong">新規配信を作成</h2>

      <div className="space-y-4 max-w-lg">
        <Input label="配信タイトル" required placeholder="例：3月のキャンペーン告知" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />

        <MessageListEditor messages={form.messages} onChange={(messages) => setForm({ ...form, messages })} />

        {/* Link tracking toggle */}
        {form.messages.some((m) => m.type !== 'image') && (
          <div>
            <Checkbox label="メッセージ内のリンクを短縮する（クリック計測）" checked={form.trackLinks} onCheckedChange={(checked) => setForm({ ...form, trackLinks: checked })} />
            <p className="ml-6 mt-1 text-xs text-kumo-subtle">
              ONにすると本文のURLが計測用リンク（/t/…）に自動変換されます。OFFの場合はURLをそのまま送信します。
            </p>
          </div>
        )}

        {/* Target */}
        <div>
          <p className="mb-2 text-xs font-medium text-kumo-subtle">配信対象</p>
          <Tabs
            size="sm"
            value={form.targetType}
            onValueChange={(value) => setForm({ ...form, targetType: value as ApiBroadcast['targetType'], targetTagId: value === 'tag' ? form.targetTagId : '' })}
            tabs={[{ value: 'all', label: '全員' }, { value: 'tag', label: 'タグで絞り込み' }]}
          />
          {form.targetType === 'tag' && (
            <Select
              className="mt-2 w-full"
              aria-label="配信対象タグ"
              value={form.targetTagId}
              onValueChange={(value) => setForm({ ...form, targetTagId: value ?? '' })}
              placeholder="タグを選択"
              items={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
            />
          )}
          {form.targetType === 'multi-account-dedup' && (
            <MultiAccountDedupSection
              accountIds={form.accountIds}
              dedupPriority={form.dedupPriority}
              targetTagId={form.targetTagId || null}
              tags={tags}
              onAccountIdsChange={(ids) => setForm({ ...form, accountIds: ids })}
              onDedupPriorityChange={(ids) => setForm({ ...form, dedupPriority: ids })}
              onTargetTagIdChange={(id) => setForm({ ...form, targetTagId: id ?? '' })}
            />
          )}
        </div>

        {/* Schedule */}
        <div>
          <p className="mb-2 text-xs font-medium text-kumo-subtle">配信タイミング</p>
          <Tabs size="sm" value={form.sendNow ? 'draft' : 'scheduled'} onValueChange={(value) => setForm({ ...form, sendNow: value === 'draft', scheduledAt: value === 'draft' ? '' : form.scheduledAt })} tabs={[{ value: 'draft', label: '下書きとして保存' }, { value: 'scheduled', label: '予約配信' }]} />
          {!form.sendNow && (
            <Input
              className="mt-2"
              label="配信日時"
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })}
            />
          )}
        </div>

        {/* Error */}
        {error ? <Banner size="sm" variant="error" title="作成できません" description={error} /> : null}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="primary" loading={saving} onClick={() => void handleSave()}>作成</Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>キャンセル</Button>
        </div>
      </div>
    </LayerCard>
  )
}
