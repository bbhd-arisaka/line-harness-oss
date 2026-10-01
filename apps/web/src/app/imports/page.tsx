'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { Modal } from '@/components/ui/modal'
import { ApiError, fetchApi } from '@/lib/api'
import { ExtensionImport } from './extension-import'

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
  forms: { configs: unknown[]; submissions: unknown[] }
  messages: unknown[]
}
interface MessagesPlan { total: number; text: number; flex: number; outgoing: number; incoming: number; alreadyImported: number; nearDuplicates: number; friendNotInAccount: number }
interface FormsPlan { formsFound: number; formsMissing: string[]; fieldsToPatch: number; fieldsMissing: string[]; hiddenToAdd: number }
interface SubmissionsPlan { total: number; withFriend: number; alreadyImported: number; formsMissing: number; attachable: number }
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
const SUBMISSION_CHUNK = 40
const MESSAGE_CHUNK = 100

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
  const [plan, setPlan] = useState<{ definitions: DefinitionsPlan; friends: FriendsPlan; forms: FormsPlan | null; submissions: SubmissionsPlan | null; messages: MessagesPlan | null } | null>(null)
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
      const json = JSON.parse(await file.text()) as { source?: string; accountId?: string; accountName?: string; folders?: unknown[]; fields?: unknown[]; tags?: unknown[]; friends?: unknown[]; forms?: { configs?: unknown[]; submissions?: unknown[] }; messages?: unknown[] }
      if (json.source !== 'lstep' || !json.accountId || !Array.isArray(json.fields) || !Array.isArray(json.friends)) {
        throw new Error('取り込み用データの形式ではありません')
      }
      setLoaded({
        fileName: file.name,
        definitions: { source: 'lstep', accountId: json.accountId, accountName: json.accountName, folders: json.folders ?? [], fields: json.fields, tags: json.tags ?? [] },
        friends: json.friends,
        forms: { configs: json.forms?.configs ?? [], submissions: json.forms?.submissions ?? [] },
        messages: json.messages ?? [],
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
      let formsPlan: FormsPlan | null = null
      const subTotal: SubmissionsPlan = { total: 0, withFriend: 0, alreadyImported: 0, formsMissing: 0, attachable: 0 }
      const total: FriendsPlan = { total: 0, inAccount: 0, notFoundOrOtherAccount: 0, willSetRealName: 0, willOverwriteRealName: 0, willSetSystemDisplayName: 0, withValues: 0, overwritingValues: 0, withTags: 0, newTagAssignments: 0 }
      for (let i = 0; i < Math.max(loaded.friends.length, 1); i += PLAN_CHUNK) {
        const r = await post<{ definitions: DefinitionsPlan; friends: FriendsPlan; forms: FormsPlan | null }>('/api/imports/lstep/plan', {
          definitions: loaded.definitions,
          friends: loaded.friends.slice(i, i + PLAN_CHUNK),
          forms: i === 0 ? { configs: loaded.forms.configs } : undefined,
        })
        definitions = r.definitions
        if (r.forms) formsPlan = r.forms
        for (const k of Object.keys(total) as Array<keyof FriendsPlan>) total[k] += r.friends[k]
      }
      for (let i = 0; i < loaded.forms.submissions.length; i += PLAN_CHUNK) {
        const r = await post<{ submissions: SubmissionsPlan | null }>('/api/imports/lstep/plan', {
          definitions: loaded.definitions,
          friends: [],
          forms: { submissions: loaded.forms.submissions.slice(i, i + PLAN_CHUNK) },
        })
        if (r.submissions) for (const k of Object.keys(subTotal) as Array<keyof SubmissionsPlan>) subTotal[k] += r.submissions[k]
      }
      const msgTotal: MessagesPlan = { total: 0, text: 0, flex: 0, outgoing: 0, incoming: 0, alreadyImported: 0, nearDuplicates: 0, friendNotInAccount: 0 }
      for (let i = 0; i < loaded.messages.length; i += PLAN_CHUNK) {
        const r = await post<{ messages: MessagesPlan | null }>('/api/imports/lstep/plan', {
          definitions: loaded.definitions,
          friends: [],
          messages: loaded.messages.slice(i, i + PLAN_CHUNK),
        })
        if (r.messages) for (const k of Object.keys(msgTotal) as Array<keyof MessagesPlan>) msgTotal[k] += r.messages[k]
      }
      if (definitions) setPlan({ definitions, friends: total, forms: formsPlan, submissions: loaded.forms.submissions.length ? subTotal : null, messages: loaded.messages.length ? msgTotal : null })
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
      const totalSteps = loaded.friends.length + loaded.forms.submissions.length + loaded.messages.length
      setProgress({ done: 0, total: totalSteps })
      const sum = { updated: 0, skipped: 0, tagsAdded: 0, formsUpdated: 0, submissionsAdded: 0, submissionsSkipped: 0, messagesAdded: 0, messagesSkipped: 0 }
      for (let i = 0; i < loaded.friends.length; i += APPLY_CHUNK) {
        const r = await post<{ updated: number; skipped: number; tagsAdded: number }>(`/api/imports/lstep/${batchId}/friends`, { friends: loaded.friends.slice(i, i + APPLY_CHUNK) })
        sum.updated += r.updated
        sum.skipped += r.skipped
        sum.tagsAdded += r.tagsAdded
        setProgress({ done: Math.min(i + APPLY_CHUNK, loaded.friends.length), total: totalSteps })
      }
      if (loaded.forms.configs.length > 0) {
        const f = await post<{ formsUpdated: number }>(`/api/imports/lstep/${batchId}/forms`, { configs: loaded.forms.configs })
        sum.formsUpdated = f.formsUpdated
      }
      for (let i = 0; i < loaded.forms.submissions.length; i += SUBMISSION_CHUNK) {
        const r = await post<{ added: number; skipped: number }>(`/api/imports/lstep/${batchId}/submissions`, { submissions: loaded.forms.submissions.slice(i, i + SUBMISSION_CHUNK) })
        sum.submissionsAdded += r.added
        sum.submissionsSkipped += r.skipped
        setProgress({ done: loaded.friends.length + Math.min(i + SUBMISSION_CHUNK, loaded.forms.submissions.length), total: totalSteps })
      }
      for (let i = 0; i < loaded.messages.length; i += MESSAGE_CHUNK) {
        const r = await post<{ added: number; skipped: number; nearDuplicates: number }>(`/api/imports/lstep/${batchId}/messages`, { messages: loaded.messages.slice(i, i + MESSAGE_CHUNK) })
        sum.messagesAdded += r.added
        sum.messagesSkipped += r.skipped + r.nearDuplicates
        setProgress({ done: loaded.friends.length + loaded.forms.submissions.length + Math.min(i + MESSAGE_CHUNK, loaded.messages.length), total: totalSteps })
      }
      await post(`/api/imports/lstep/${batchId}/finish`, { summary: { ...sum, created: started.created, file: loaded.fileName } })
      setMessage({
        kind: 'ok',
        text: `反映しました。友だち ${sum.updated}人(スキップ ${sum.skipped}人)、タグの付与 ${sum.tagsAdded}件、新しく作った友だち情報欄 ${started.created.fields}件・タグ ${started.created.tags}件。` +
          (loaded.messages.length ? ` トーク履歴 ${sum.messagesAdded}件を取り込み(重複で飛ばした分 ${sum.messagesSkipped}件)。` : '') +
          (loaded.forms.configs.length || loaded.forms.submissions.length ? ` フォーム ${sum.formsUpdated}件の代入先を修正、回答 ${sum.submissionsAdded}件を取り込み(重複で飛ばした分 ${sum.submissionsSkipped}件)。` : ''),
      })
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
      const r = await post<{ restoredFriends: number; removedTags: number; removedDefinitions: number; removedSubmissions: number; restoredForms: number; removedMessages: number }>(`/api/imports/${target.id}/undo`, {})
      setMessage({ kind: 'ok', text: `元に戻しました。友だち ${r.restoredFriends}人、タグの付与 ${r.removedTags}件、作った定義 ${r.removedDefinitions}件、取り込んだ回答 ${r.removedSubmissions}件、フォーム ${r.restoredForms}件、トーク履歴 ${r.removedMessages}件を取り消しました。` })
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

      <ExtensionImport
        disabled={!!busy}
        onLoaded={(l) => {
          setPlan(null)
          setMessage(null)
          setLoaded(l)
        }}
      />

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
            {(loaded.forms.configs.length > 0 || loaded.forms.submissions.length > 0) && ` / フォーム ${loaded.forms.configs.length}件・回答 ${loaded.forms.submissions.length}件`}
            {loaded.messages.length > 0 && ` / トーク履歴 ${loaded.messages.length}件`}
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
              {plan.forms && (
                <>
                  <tr><td>代入先を修正するフォーム</td><td className="text-right">{plan.forms.formsFound}件(項目 {plan.forms.fieldsToPatch}件を修正)</td></tr>
                  <tr><td>　足す隠し項目(フォームに足りない質問の受け皿)</td><td className="text-right">{plan.forms.hiddenToAdd}件</td></tr>
                  {(plan.forms.formsMissing.length > 0 || plan.forms.fieldsMissing.length > 0) && (
                    <tr className="text-[#b45309]"><td>見つからないフォーム・項目</td><td className="text-right">{plan.forms.formsMissing.length + plan.forms.fieldsMissing.length}件</td></tr>
                  )}
                </>
              )}
              {plan.submissions && (
                <>
                  <tr><td>取り込む回答(回答履歴)</td><td className="text-right">{plan.submissions.total - plan.submissions.alreadyImported}件(取り込み済みで飛ばす {plan.submissions.alreadyImported - plan.submissions.attachable}件{plan.submissions.attachable ? `、持ち主なしの回答に友だちを付ける ${plan.submissions.attachable}件` : ''})</td></tr>
                  <tr><td>　うち、友だちに紐づく</td><td className="text-right">{plan.submissions.withFriend}件(残りは友だち不明のまま保存)</td></tr>
                </>
              )}
              {plan.messages && (
                <>
                  <tr><td>取り込むトーク履歴</td><td className="text-right">{plan.messages.total - plan.messages.alreadyImported - plan.messages.nearDuplicates - plan.messages.friendNotInAccount}件(送信 {plan.messages.outgoing} / 受信 {plan.messages.incoming})</td></tr>
                  <tr><td>　うち、文字 / 画像・カードなど(Flex)</td><td className="text-right">{plan.messages.text}件 / {plan.messages.flex}件</td></tr>
                  <tr className="text-[#757578]"><td>　取り込み済み・重複で飛ばす</td><td className="text-right">{plan.messages.alreadyImported + plan.messages.nearDuplicates}件</td></tr>
                  {plan.messages.friendNotInAccount > 0 && <tr className="text-[#b45309]"><td>　対象外(別アカウント・不明な友だち)</td><td className="text-right">{plan.messages.friendNotInAccount}件</td></tr>}
                </>
              )}
              <tr className="text-[#b45309]"><td>反映されない友だち(見つからない/別アカウント)</td><td className="text-right">{plan.friends.notFoundOrOtherAccount}人</td></tr>
            </tbody>
          </table>
          {plan.definitions.fields.existing.length > 0 && (
            <p className="mt-2 text-xs text-[#757578]">すでにある友だち情報欄は作り直しません: {plan.definitions.fields.existing.join('、')}</p>
          )}
          <p className="mt-3 text-xs text-[#757578]">反映は、あとから「元に戻す」で取り消せます(変更前の値を記録します)。</p>
          <button type="button" className={`${btn} mt-3 bg-[#069e04] text-white hover:bg-[#058a03]`} disabled={!!busy || (plan.friends.inAccount === 0 && !plan.forms && !plan.submissions && !plan.messages)} onClick={() => setConfirmOpen(true)}>
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
            「{plan?.definitions.account.name}」に、取り込みを反映します(友だち {plan?.friends.inAccount}人{plan?.forms ? `、フォーム ${plan.forms.formsFound}件` : ''}{plan?.submissions ? `、回答 ${plan.submissions.total - plan.submissions.alreadyImported}件` : ''})。お客様への通知やメッセージ送信は行いません。あとから「元に戻す」で取り消せます。
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
