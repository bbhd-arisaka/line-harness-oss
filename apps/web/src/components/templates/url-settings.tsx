'use client'

import { useState } from 'react'
import type { LinkSetting, UrlSettings } from '@line-crm/shared'
import ActionSettingsModal from '@/components/friend-add/action-settings-modal'
import type { ModalLookups } from '@/components/friend-add/action-settings-modal'
import { describeAction } from '@/lib/friend-add-actions'
import type { FriendAddActionItem } from '@/lib/friend-add-actions'

const URL_RE = /https?:\/\/[^\s<>"'`{}|\\^[\]]+/g
const inputCls = 'h-9 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]'

/** 本文の中の URL を拾う(重複なし・タグの枠 `{{…}}` の中は拾わない) */
export function extractUrls(text: string): string[] {
  const plain = text.replace(/\{\{[^}]*\}\}/g, ' ')
  return [...new Set(plain.match(URL_RE) ?? [])].map((u) => u.replace(/[)）。、,.]+$/, ''))
}

function siteNameOf(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    return last ? `${decodeURIComponent(last)} | ${u.hostname}` : u.hostname
  } catch {
    return url
  }
}

/**
 * Lステップの「URL設定」。[URL読み込み] で本文中のURLを拾い、URLごとに「設定」(サイト登録名・スクリプト・リダイレクト先・有効期限・訪問時のアクション)を決める。
 * チェック「このメッセージではURLを短縮しない」。
 */
export default function UrlSettingsSection({
  value,
  onChange,
  sourceText,
  lookups,
  accountId,
}: {
  value: UrlSettings | undefined
  onChange: (v: UrlSettings) => void
  /** URL を拾う本文(複数の欄をつなげたもの) */
  sourceText: () => string
  lookups: ModalLookups
  accountId: string
}) {
  const links = value?.links ?? []
  const [editing, setEditing] = useState<string | null>(null)
  const [actionOpen, setActionOpen] = useState(false)
  const set = (patch: Partial<UrlSettings>) => onChange({ ...(value ?? {}), ...patch })

  const load = () => {
    const urls = extractUrls(sourceText())
    const next: LinkSetting[] = urls.map((u) => links.find((l) => l.url === u) ?? { url: u, name: siteNameOf(u) })
    set({ links: next })
    if (editing && !urls.includes(editing)) setEditing(null)
  }
  const update = (url: string, patch: Partial<LinkSetting>) => set({ links: links.map((l) => (l.url === url ? { ...l, ...patch } : l)) })
  const current = links.find((l) => l.url === editing) ?? null
  const actions = ((current?.actions ?? []) as FriendAddActionItem[])

  return (
    <section>
      <h3 className="mb-2 text-xs font-bold">URL設定</h3>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <button type="button" onClick={load} className="h-9 rounded border border-[#cacace] bg-white px-4 text-xs font-bold hover:bg-[#f7f7f9]">URL読み込み</button>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={value?.noShorten === true} onChange={(e) => set({ noShorten: e.target.checked })} className="accent-[#069e04]" />
          このメッセージではURLを短縮しない
        </label>
      </div>
      <div className={`grid gap-4 ${current ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}`}>
        <div className="overflow-hidden rounded border border-[#e3e3e6]">
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4rem] bg-[#f1f1f4] px-3 py-2 text-xs text-[#757578]">
            <span>サイト名</span>
            <span>訪問時</span>
            <span />
          </div>
          {links.length === 0 ? (
            <p className="border-t border-[#e3e3e6] py-6 text-center text-sm text-[#757578]">表示するデータがありません</p>
          ) : (
            links.map((l) => (
              <div key={l.url} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4rem] items-center border-t border-[#e3e3e6] px-3 py-2 text-sm">
                <div className="min-w-0 pr-2">
                  <div className="truncate font-bold">{l.name}</div>
                  <div className="truncate text-xs text-[#757578]">{l.url}</div>
                </div>
                <div className="min-w-0 pr-2 text-xs">
                  {((l.actions ?? []) as FriendAddActionItem[]).length === 0 ? '-' : ((l.actions ?? []) as FriendAddActionItem[]).map((a, i) => <p key={i} className="break-words">{describeAction(a, lookups)}</p>)}
                </div>
                <button type="button" onClick={() => setEditing(editing === l.url ? null : l.url)} className="h-8 rounded border border-[#cacace] text-xs hover:bg-[#f7f7f9]">設定</button>
              </div>
            ))
          )}
        </div>

        {current ? (
          <div className="rounded border border-[#e3e3e6]">
            <div className="border-b border-[#e3e3e6] bg-[#f1f1f4] px-3 py-2 text-xs">
              <span className="font-bold">サイト設定</span> <span className="text-[#757578]">URL：{current.url}</span>
            </div>
            <div className="space-y-3 p-3 text-xs">
              <label className="block">
                <span className="mb-1 block font-bold">サイト登録名 <span className="rounded-sm bg-[#e5451f] px-1 py-0.5 text-[10px] text-white">必須</span></span>
                <input value={current.name} onChange={(e) => update(current.url, { name: e.target.value })} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block font-bold">スクリプト設定</span>
                <textarea value={current.script ?? ''} onChange={(e) => update(current.url, { script: e.target.value })} placeholder="<script>console.log('your script here')</script>" rows={3} className="w-full rounded border border-[#cacace] px-3 py-2 font-mono text-xs outline-none focus:border-[#069e04]" />
              </label>
              <div>
                <span className="mb-1 block font-bold">リダイレクト元</span>
                <a href={current.url} target="_blank" rel="noreferrer" className="break-all text-[#2b7bb9] underline">{current.url}</a>
              </div>
              <label className="block">
                <span className="mb-1 block font-bold">リダイレクト先</span>
                <input value={current.redirectTo ?? ''} onChange={(e) => update(current.url, { redirectTo: e.target.value })} placeholder="https://example.com" className={inputCls} />
                <span className="mt-1 block font-bold text-[#e5451f]">記録は元(変更前)のURLへのアクセスとしてカウントされます。</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!current.expire} onChange={(e) => update(current.url, { expire: e.target.checked ? { mode: 'datetime', at: '' } : null })} className="accent-[#069e04]" />
                URLに有効期限を設定する
              </label>
              {current.expire ? (
                <div className="space-y-2 rounded bg-[#f7f7f9] p-3">
                  <label className="block">
                    <span className="mb-1 block font-bold">期間設定</span>
                    <select value={current.expire.mode} onChange={(e) => update(current.url, { expire: { ...current.expire!, mode: e.target.value as 'datetime' | 'elapsed_days' | 'elapsed_datetime' } })} className={inputCls}>
                      <option value="datetime">特定の日時を指定</option>
                      <option value="elapsed_days">経過日数と終了時刻指定</option>
                      <option value="elapsed_datetime">経過日時指定</option>
                    </select>
                  </label>
                  {current.expire.mode === 'datetime' ? (
                    <div className="flex items-center gap-2">
                      <input type="datetime-local" value={current.expire.at ?? ''} onChange={(e) => update(current.url, { expire: { ...current.expire!, at: e.target.value } })} className={`${inputCls} !w-60`} />
                      <span>に無効</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} value={current.expire.days ?? 0} onChange={(e) => update(current.url, { expire: { ...current.expire!, days: Math.max(0, Number(e.target.value) || 0) } })} className={`${inputCls} !w-20`} />
                      <span>日後の</span>
                      <input type="time" value={current.expire.time ?? '00:00'} onChange={(e) => update(current.url, { expire: { ...current.expire!, time: e.target.value } })} className={`${inputCls} !w-28`} />
                      <span>に無効</span>
                    </div>
                  )}
                  <label className="block">
                    <span className="mb-1 block font-bold">リダイレクトURL</span>
                    <input value={current.expire.redirectUrl ?? ''} onChange={(e) => update(current.url, { expire: { ...current.expire!, redirectUrl: e.target.value } })} placeholder="https://example.com" className={inputCls} />
                  </label>
                </div>
              ) : null}
              <div>
                <span className="mb-1 block font-bold">訪問時のアクション設定</span>
                <button type="button" onClick={() => setActionOpen(true)} className="inline-flex h-9 items-center gap-1 rounded bg-[#f5a623] px-4 text-xs font-bold text-white hover:bg-[#e09612]">⚡ アクション設定</button>
                {actions.length > 0 ? <div className="mt-2 space-y-0.5">{actions.map((a, i) => <p key={i}>{describeAction(a, lookups)}</p>)}</div> : null}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setEditing(null)} className="h-8 rounded border border-[#cacace] px-4 hover:bg-[#f7f7f9]">閉じる</button>
                <button type="button" onClick={() => setEditing(null)} className="h-8 rounded border border-[#069e04] px-4 font-bold text-[#069e04] hover:bg-[#f3fbf3]">設定する</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {current && actionOpen ? (
        <ActionSettingsModal
          open
          initial={actions}
          lookups={lookups}
          accountId={accountId}
          onClose={() => setActionOpen(false)}
          onSave={(next) => {
            update(current.url, { actions: next })
            setActionOpen(false)
          }}
        />
      ) : null}
    </section>
  )
}
