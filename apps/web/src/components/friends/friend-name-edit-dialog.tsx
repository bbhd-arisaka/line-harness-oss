'use client'

import { useEffect, useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { api } from '@/lib/api'

export const FRIEND_NAME_MAX_LENGTH = 20

/** 表示優先順位: 本名 > システム表示名 > LINE登録名(Lステップの友だちリストの名前と同じ。本名を入れると、その名前で表示される) */
export function resolveFriendName(f: { systemDisplayName?: string | null; realName?: string | null; displayName?: string | null }): string {
  return f.realName?.trim() || f.systemDisplayName?.trim() || f.displayName || '名前なし'
}

export interface FriendNameFields {
  id: string
  displayName: string | null
  realName: string | null
  systemDisplayName: string | null
}

/**
 * Lステップの「表示名編集 (対象: ○○)」モーダル。
 * LINE登録名(読み取り専用) / 本名 / システム表示名 の3項目、各20文字まで。
 */
export function FriendNameEditDialog({
  friend,
  open,
  onClose,
  onSaved,
}: {
  friend: FriendNameFields
  open: boolean
  onClose: () => void
  onSaved: (updated: { realName: string | null; systemDisplayName: string | null }) => void
}) {
  const [realName, setRealName] = useState('')
  const [systemDisplayName, setSystemDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setRealName(friend.realName ?? '')
    setSystemDisplayName(friend.systemDisplayName ?? '')
    setError('')
  }, [open, friend.realName, friend.systemDisplayName])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const next = {
        realName: realName.trim() || null,
        systemDisplayName: systemDisplayName.trim() || null,
      }
      const res = await api.friends.updateProfile(friend.id, next)
      if (!res.success) {
        setError(('error' in res && typeof res.error === 'string' && res.error) || '保存に失敗しました')
        return
      }
      onSaved(next)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const rows: Array<{ label: string; value: string; onChange?: (v: string) => void }> = [
    { label: 'LINE登録名', value: friend.displayName ?? '' },
    { label: '本名', value: realName, onChange: setRealName },
    { label: 'システム表示名', value: systemDisplayName, onChange: setSystemDisplayName },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <Dialog className="w-full max-w-lg p-0">
        <Dialog.Title className="border-b border-gray-200 px-5 py-3.5 text-sm font-medium">
          表示名編集 (対象: {resolveFriendName(friend)})
        </Dialog.Title>
        <div className="space-y-4 px-5 py-5">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[7rem_1fr] items-start gap-3">
              <label className="pt-2 text-right text-xs font-bold text-gray-700">{r.label}</label>
              <div>
                <Input
                  aria-label={r.label}
                  value={r.value}
                  disabled={!r.onChange}
                  maxLength={FRIEND_NAME_MAX_LENGTH}
                  onValueChange={r.onChange}
                />
                <p className="mt-0.5 text-right text-[11px] text-gray-400">
                  {[...r.value].length}/{FRIEND_NAME_MAX_LENGTH}
                </p>
              </div>
            </div>
          ))}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-center gap-3 px-5 pb-5">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button type="button" variant="primary" loading={saving} onClick={() => void save()}>保存</Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

export function NameEditPencil({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="表示名を編集"
      aria-label="表示名を編集"
      className={`inline-flex flex-shrink-0 items-center justify-center rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 ${className}`}
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.768-6.768a2 2 0 112.828 2.828L11.828 15.83a2 2 0 01-.878.513L7 17l.657-3.95A2 2 0 018.17 12.17L9 13z" />
      </svg>
    </button>
  )
}
