'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { btnBase, btnWhite } from '@/components/lstep/ui'
import { useDialogs } from '@/components/ui/dialogs'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import type { TemplateDraft } from '@/lib/template-library'

const fmt = (iso: string) => iso.slice(0, 16).replace('T', ' ').replace(/-/g, '/')

/** 下書き一覧(Lステップの「下書きを開く」)。名前を押すと、その続きから編集できる */
export default function TemplateDraftsPage() {
  const { selectedAccount } = useAccount()
  const dialogs = useDialogs()
  const accountId = selectedAccount?.id ?? ''
  const [drafts, setDrafts] = useState<TemplateDraft[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!accountId) return
    const r = await api.tpl.drafts(accountId).catch(() => null)
    setDrafts(r?.success ? r.data : [])
  }, [accountId])
  useEffect(() => { void load() }, [load])

  async function remove(ids: string[]) {
    if (!await dialogs.confirm(`${ids.length === 1 ? 'この下書き' : `選択した${ids.length}件の下書き`}を削除しますか?`, { okLabel: '削除', danger: true })) return
    await api.tpl.deleteDrafts(ids)
    setChecked(new Set())
    await load()
  }

  const all = drafts ?? []
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Header title="下書き一覧" />
      <div className="mb-3 flex items-center gap-2">
        <Link href="/templates" className={btnWhite}>テンプレート一覧へ戻る</Link>
        {checked.size > 0 ? (
          <button type="button" className={`${btnBase} border border-[#e5451f] bg-white text-[#e5451f] hover:bg-[#fff3f0]`} onClick={() => void remove([...checked])}>
            選択した{checked.size}件を削除
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-[2rem_1fr_9rem_9rem_5rem] items-center bg-[#f1f1f4] px-2 text-xs text-[#757578]" style={{ height: 40 }}>
        <input type="checkbox" aria-label="すべて選択" checked={all.length > 0 && all.every((d) => checked.has(d.id))} onChange={(e) => setChecked(e.target.checked ? new Set(all.map((d) => d.id)) : new Set())} />
        <span>テンプレート名</span>
        <span>種類</span>
        <span>最終保存</span>
        <span />
      </div>
      {drafts === null ? <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">読み込み中...</p> : null}
      {drafts && drafts.length === 0 ? <p className="border-b border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">下書きがありません</p> : null}
      {all.map((d) => (
        <div key={d.id} className="grid grid-cols-[2rem_1fr_9rem_9rem_5rem] items-center border-b border-[#e3e3e6] bg-white px-2 text-sm hover:bg-[#fafafb]" style={{ height: 47 }}>
          <input type="checkbox" aria-label={`${d.name || '(名称未設定)'}を選択`} checked={checked.has(d.id)} onChange={(e) => setChecked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n })} />
          <Link href={`/templates/new?kind=${d.kind === 'flex' ? 'flex' : 'standard'}&draft=${d.id}`} className="truncate pr-3 font-bold text-[#2b7bb9] underline">{d.name || '(名称未設定)'}</Link>
          <span className="text-xs">{d.typeLabel}</span>
          <span className="text-xs text-[#757578]">{fmt(d.updatedAt)}</span>
          <button type="button" onClick={() => void remove([d.id])} className="text-xs text-[#e5451f] underline">削除</button>
        </div>
      ))}
    </main>
  )
}
