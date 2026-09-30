'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { Modal } from '@/components/ui/modal'
import { ApiError, fetchApi } from '@/lib/api'

// Lステップ → beyond line のデータ引き継ぎ(オーナー専用)。
// 取り込み用データ(JSON)を選ぶ → 計画を確認 → 反映 → 必要なら元に戻す。

interface Definitions {
  source: 'lstep'
  accountId: string
  accountName?: string
  folders: unknown[]
  fields: unknown[]
  tags: unknown[]
}
interface Loaded {
  fileName: string
  definitions: Definitions
  friends: unknown[]
}
interface DefinitionsPlan {
  account: { id: string; name: string }
  folders: { total: number; toCreate: number }
  fields: { total: number; toCreate: number; existing: string[] }
  tags: { total: number; toCreate: number }
}
interface FriendsPlan {
  total: number
  inAccount: number
  notFoundOrOtherAccount: number
  willSetRealName: number
  willOverwriteRealName: number
  willSetSystemDisplayName: number
  withValues: number
  overwritingValues: number
  withTags: number
  newTagAssignments: number
}
interface BatchRow {
  id: string
  status: 'running' | 'applied' | 'undone'
  summary: string | null
  created_by: string | null
  created_at: string
  account_name: string | null
}

const PLAN_CHUNK = 100
const APPLY_CHUNK = 40

const STATUS_LABEL: Record<BatchRow['status'], string> = { running: '途中', applied: '反映済み', undone: '取り消し済み' }

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchApi<{ success: boolean; data: T; error?: string }>(path, { method: 'POST', body: JSON.stringify(body) })
  if (!res.success) throw new Error(res.error ?? '失敗しました')
  return res.data
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.serverMessage ?? `エラーが発生しました(${err.status})`
  return err instanceof Error ? err.message : '失敗しました'
}

export default function ImportsPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [plan, setPlan] = useState<{ definitions: DefinitionsPlan; friends: FriendsPlan } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [undoTarget, setUndoTarget] = useState<BatchRow | null>(null)

  const loadBatches = useCallback(async () => {
    try {
      const res = await fetchApi<{ success: boolean; data: BatchRow[] }>('/api/imports')
      if (res.success) setBatches(res.data)
    } catch {
      /* 履歴が読めなくても、他の操作は続けられる */
    }
  }, [])
  useEffect(() => { void loadBatches() }, [loadBatches])

  const onFile = async (file: File | null) => {
    setPlan(null)
    setMessage(null)
    setLoaded(null)
    if (!file) return
    try {
      const json = JSON.parse(await file.text()) as { source?: string; accountId?: string; accountName?: string; folders?: unknown[]; fields?: unknown[]; tags?: unknown[]; friends?: unknown[] }
      if (json.source !== 'lstep' || !json.accountId || !Array.isArray(json.fields) || !Array.isArray(json.friends)) {
        throw new Error('取り込み用データの形式ではありません')
      }
      setLoaded({
        fileName: file.name,
        definitions: { source: 'lstep', accountId: json.accountId, accountName: json.accountName, folders: json.folders ?? [], fields: json.fields, tags: json.tags ?? [] },
        friends: json.friends,
      })
    } catch (err) {
      setMessage({ kind: 'error', text: `ファイルを読み込めませんでした: ${errorText(err)}` })
    }
  }

  const runPlan = async () => {
    if (!loaded) return
    setBusy('計画を確認しています…')
    setMessage(null)
    try {
      let definitions: DefinitionsPlan | null = null
      const total: FriendsPlan = { total: 0, inAccount: 0, notFoundOrOtherAccount: 0, willSetRealName: 0, willOverwriteRealName: 0, willSetSystemDisplayName: 0, withValues: 0, overwritingValues: 0, withTags: 0, newTagAssignments: 0 }
      for (let i = 0; i < Math.max(loaded.friends.length, 1); i += PLAN_CHUNK) {
        const r = await post<{ definitions: DefinitionsPlan; friends: FriendsPlan }>('/api/imports/lstep/plan', {
          definitions: loaded.definitions,
          friends: loaded.friends.slice(i, i + PLAN_CHUNK),
        })
        definitions = r.definitions
        for (const k of Object.keys(total) as Array<keyof FriendsPlan>) total[k] += r.friends[k]
      }
      if (definitions) setPlan({ definitions, friends: total })
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) })
    } finally {
      setBusy(null)
    }
  }

  const runApply = async () => {
    if (!loaded) return
    setConfirmOpen(false)
    setBusy('反映しています…(画面を閉じないでください)')
    setMessage(null)
    let batchId: string | null = null
    try {
      const started = await post<{ batchId: string; created: { folders: number; fields: number; tags: number } }>('/api/imports/lstep/start', { definitions: loaded.definitions })
      batchId = started.batchId
      setProgress({ done: 0, total: loaded.friends.length })
      const sum = { updated: 0, skipped: 0, tagsAdded: 0 }
      for (let i = 0; i < loaded.friends.length; i += APPLY_CHUNK) {
        const r = await post<{ updated: number; skipped: number; tagsAdded: number }>(`/api/imports/lstep/${batchId}/friends`, { friends: loaded.friends.slice(i, i + APPLY_CHUNK) })
        sum.updated += r.updated
        sum.skipped += r.skipped
        sum.tagsAdded += r.tagsAdded
        setProgress({ done: Math.min(i + APPLY_CHUNK, loaded.friends.length), total: loaded.friends.length })
      }
      await post(`/api/imports/lstep/${batchId}/finish`, { summary: { ...sum, created: started.created, file: loaded.fileName } })
      setMessage({ kind: 'ok', text: `反映しました。友だち ${sum.updated}人(スキップ ${sum.skipped}人)、タグの付与 ${sum.tagsAdded}件、新しく作った友だち情報欄 ${started.created.fields}件・タグ ${started.created.tags}件。` })
      setPlan(null)
    } catch (err) {
      setMessage({
        kind: 'error',
        text: `途中で止まりました: ${errorText(err)}${batchId ? '(ここまでの分は、下の履歴の「元に戻す」で取り消せます)' : ''}`,
      })
    } finally {
      setBusy(null)
      setProgress(null)
      void loadBatches()
    }
  }

  const runUndo = async () => {
    if (!undoTarget) return
    const target = undoTarget
    setUndoTarget(null)
    setBusy('元に戻しています…')
    try {
      const r = await post<{ restoredFriends: number; removedTags: number; removedDefinitions: number }>(`/api/imports/${target.id}/undo`, {})
      setMessage({ kind: 'ok', text: `元に戻しました。友だち ${r.restoredFriends}人、タグの付与 ${r.removedTags}件、作った定義 ${r.removedDefinitions}件を取り消しました。` })
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) })
    } finally {
      setBusy(null)
      void loadBatches()
    }
  }

  const btn = 'rounded px-4 py-2 text-sm font-bold disabled:opacity-50'
  return (
    <div className="max-w-3xl">
      <Header title="データ引き継ぎ" description="Lステップから集めたデータ(友だち情報・タグ・本名)を、beyond line に反映します。オーナー専用。" />

      {message && (
        <div className={`mb-4 rounded border p-3 text-sm ${message.kind === 'ok' ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <section className="mb-6 rounded border border-[#e0e0e3] bg-white p-5">
        <h2 className="text-sm font-bold text-[#333]">1. 取り込み用データを選ぶ</h2>
        <p className="mt-1 text-xs text-[#757578]">Lステップから集めて、beyond line の友だちと突き合わせ済みのファイル(.json)を選びます。</p>
        <input
          type="file"
          accept="application/json,.json"
          className="mt-3 block text-sm"
          disabled={!!busy}
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
        {loaded && (
          <p className="mt-3 text-sm text-[#333]">
            {loaded.fileName}: 取り込み先「{loaded.definitions.accountName ?? loaded.definitions.accountId}」 / 友だち情報欄 {loaded.definitions.fields.length}件・タグ {loaded.definitions.tags.length}件・友だち {loaded.friends.length}人
          </p>
        )}
        <button type="button" className={`${btn} mt-3 border border-[#069e04] text-[#069e04] hover:bg-[#f1fbf1]`} disabled={!loaded || !!busy} onClick={() => void runPlan()}>
          2. 計画を確認する(まだ何も変わりません)
        </button>
      </section>

      {plan && (
        <section className="mb-6 rounded border border-[#e0e0e3] bg-white p-5">
          <h2 className="text-sm font-bold text-[#333]">3. 反映すると、こうなります</h2>
          <p className="mt-1 text-xs text-[#757578]">取り込み先: {plan.definitions.account.name}</p>
          <table className="mt-3 w-full text-sm">
            <tbody className="[&_td]:border-b [&_td]:border-[#eee] [&_td]:py-1.5">
              <tr><td>新しく作る友だち情報欄フォルダ</td><td className="text-right">{plan.definitions.folders.toCreate}件(全{plan.definitions.folders.total})</td></tr>
              <tr><td>新しく作る友だち情報欄</td><td className="text-right">{plan.definitions.fields.toCreate}件(全{plan.definitions.fields.total})</td></tr>
              <tr><td>新しく作るタグ</td><td className="text-right">{plan.definitions.tags.toCreate}件(全{plan.definitions.tags.total})</td></tr>
              <tr><td>反映する友だち</td><td className="text-right">{plan.friends.inAccount}人</td></tr>
              <tr><td>　うち、本名を入れる</td><td className="text-right">{plan.friends.willSetRealName}人(上書き {plan.friends.willOverwriteRealName}人)</td></tr>
              <tr><td>　うち、システム表示名を入れる</td><td className="text-right">{plan.friends.willSetSystemDisplayName}人</td></tr>
              <tr><td>　うち、友だち情報の値を入れる</td><td className="text-right">{plan.friends.withValues}人(上書き {plan.friends.overwritingValues}人)</td></tr>
              <tr><td>　タグを付ける(新規の付与)</td><td className="text-right">{plan.friends.newTagAssignments}件({plan.friends.withTags}人)</td></tr>
              <tr className="text-[#b45309]"><td>反映されない友だち(見つからない/別アカウント)</td><td className="text-right">{plan.friends.notFoundOrOtherAccount}人</td></tr>
            </tbody>
          </table>
          {plan.definitions.fields.existing.length > 0 && (
            <p className="mt-2 text-xs text-[#757578]">すでにある友だち情報欄は作り直しません: {plan.definitions.fields.existing.join('、')}</p>
          )}
          <p className="mt-3 text-xs text-[#757578]">反映は、あとから「元に戻す」で取り消せます(変更前の値を記録します)。</p>
          <button type="button" className={`${btn} mt-3 bg-[#069e04] text-white hover:bg-[#058a03]`} disabled={!!busy || plan.friends.inAccount === 0} onClick={() => setConfirmOpen(true)}>
            この内容で反映する
          </button>
        </section>
      )}

      {busy && (
        <div className="mb-6 rounded border border-[#e0e0e3] bg-white p-4 text-sm text-[#333]">
          {busy}
          {progress && (
            <div className="mt-2">
              <div className="h-2 w-full rounded bg-[#eee]"><div className="h-2 rounded bg-[#069e04] transition-all" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} /></div>
              <p className="mt-1 text-xs text-[#757578]">{progress.done} / {progress.total}人</p>
            </div>
          )}
        </div>
      )}

      <section className="mb-6 rounded border border-[#e0e0e3] bg-white p-5">
        <h2 className="text-sm font-bold text-[#333]">履歴</h2>
        {batches.length === 0 ? (
          <p className="mt-2 text-sm text-[#757578]">まだ取り込みはありません。</p>
        ) : (
          <ul className="mt-2 divide-y divide-[#eee]">
            {batches.map((b) => {
              let s: { updated?: number; tagsAdded?: number } = {}
              try { s = b.summary ? JSON.parse(b.summary) : {} } catch { /* 読めなければ空 */ }
              return (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    {new Date(b.created_at).toLocaleString('ja-JP')} / {b.account_name ?? '-'} / {STATUS_LABEL[b.status]}
                    {s.updated != null ? ` / 友だち${s.updated}人・タグ${s.tagsAdded ?? 0}件` : ''}
                    <span className="ml-2 text-xs text-[#757578]">{b.created_by}</span>
                  </span>
                  {b.status !== 'undone' && (
                    <button type="button" className="rounded border border-[#e5451f] px-3 py-1 text-xs text-[#e5451f] hover:bg-[#fff3f0]" disabled={!!busy} onClick={() => setUndoTarget(b)}>
                      元に戻す
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidthClass="max-w-md" align="center">
        <div className="p-5">
          <h2 className="text-base font-bold text-[#333]">反映しますか？</h2>
          <p className="mt-2 text-sm text-[#555]">
            「{plan?.definitions.account.name}」の友だち {plan?.friends.inAccount}人に、本名・友だち情報・タグを反映します。お客様への通知やメッセージ送信は行いません。あとから「元に戻す」で取り消せます。
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={`${btn} border border-[#cacace] text-[#333]`} onClick={() => setConfirmOpen(false)}>キャンセル</button>
            <button type="button" className={`${btn} bg-[#069e04] text-white`} onClick={() => void runApply()}>反映する</button>
          </div>
        </div>
      </Modal>

      <Modal open={undoTarget !== null} onClose={() => setUndoTarget(null)} maxWidthClass="max-w-md" align="center">
        <div className="p-5">
          <h2 className="text-base font-bold text-[#333]">この取り込みを元に戻しますか？</h2>
          <p className="mt-2 text-sm text-[#555]">取り込み前の値に戻し、取り込みで付けたタグと、取り込みで作った(まだ使われていない)タグ・友だち情報欄を消します。</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={`${btn} border border-[#cacace] text-[#333]`} onClick={() => setUndoTarget(null)}>キャンセル</button>
            <button type="button" className={`${btn} bg-[#e5451f] text-white`} onClick={() => void runUndo()}>元に戻す</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
