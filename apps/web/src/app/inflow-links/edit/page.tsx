'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LightningIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import Header from '@/components/layout/header'
import ActionSettingsModal from '@/components/friend-add/action-settings-modal'
import LandingEditor from '../_components/landing-editor'
import { useActionLookups } from '@/components/friend-add/use-action-lookups'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { errorText } from '@/lib/error-text'
import { describeAction, describeTiming } from '@/lib/friend-add-actions'
import type { FriendAddActionItem } from '@/lib/friend-add-actions'
import type { InflowFolder, InflowRoute, LandingStyle } from '@/lib/inflow-routes'

const NONE = ''
const NEW_FOLDER = '__new_folder__'
const inputCls = 'h-10 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04] disabled:bg-[#f7f7f9] disabled:text-[#757578]'
const labelCls = 'mb-1 flex items-center gap-2 text-xs font-bold'

const Required = () => <span className="rounded-sm bg-[#e5451f] px-1 text-[10px] font-bold text-white">必須</span>

const splitDateTime = (s: string | null): { date: string; time: string } => {
  if (!s) return { date: '', time: '' }
  const [date, time] = s.split('T')
  return { date: date ?? '', time: time ?? '' }
}
const joinDateTime = (v: { date: string; time: string }): string | null => (v.date || v.time ? `${v.date}T${v.time}` : null)

function Accordion({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded border border-[#cacace] bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between bg-[#f1f1f4] px-4 py-2.5 text-left text-xs font-bold text-[#414143]">
        {title}
        <span aria-hidden="true" className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>⌄</span>
      </button>
      {open ? <div className="p-4">{children}</div> : null}
    </section>
  )
}

function Radio({ name, checked, disabled, onChange, children }: { name: string; checked: boolean; disabled?: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed text-[#757578]' : 'cursor-pointer'}`}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="accent-[#069e04]" />
      {children}
    </label>
  )
}

/** Lステップの「流入経路登録」と同じ入力項目 */
export default function InflowRouteEditPage() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [ready, setReady] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState('')
  const [folders, setFolders] = useState<InflowFolder[]>([])
  const [initialGroup, setInitialGroup] = useState('')

  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('')
  const [qrText, setQrText] = useState('')
  const [from, setFrom] = useState({ date: '', time: '' })
  const [to, setTo] = useState({ date: '', time: '' })
  const [outMessage, setOutMessage] = useState('')
  const [scenarioId, setScenarioId] = useState(NONE)
  const [actions, setActions] = useState<FriendAddActionItem[]>([])
  const [ignoreSettings, setIgnoreSettings] = useState(false)
  const [actionMode, setActionMode] = useState<'first' | 'always'>('first')
  const [adImportMode, setAdImportMode] = useState<'first' | 'always'>('always')
  const [adRows, setAdRows] = useState<Array<{ param: string; fieldKey: string }>>([])
  const [htmlHead, setHtmlHead] = useState('')
  const [htmlBody, setHtmlBody] = useState('')
  const [geo, setGeo] = useState({ lat: '', lng: '', radius: '' })
  const [landing, setLanding] = useState<LandingStyle>({})
  // 保存済みの流入経路のURL(「実際のページを開く」のプレビュー用)
  const [routeUrl, setRouteUrl] = useState('')
  const [actionModal, setActionModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // フォルダを、その場で作る
  const [folderDialog, setFolderDialog] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderError, setFolderError] = useState('')

  const lookups = useActionLookups(accountId)
  const isEdit = !!editId

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    const group = params.get('group') ?? ''
    setEditId(id)
    setInitialGroup(group)
    setFolderId(group)
    if (!id) return
    ;(async () => {
      try {
        const res = await api.inflow.route(id)
        if (!res.success) throw new Error()
        const r: InflowRoute = res.data
        setAccountId(r.lineAccountId ?? '')
        setName(r.name)
        setFolderId(r.folderId ?? '')
        setInitialGroup(r.folderId ?? '')
        setQrText(r.qrText ?? '')
        setFrom(splitDateTime(r.validFrom))
        setTo(splitDateTime(r.validTo))
        setOutMessage(r.outOfPeriodMessage ?? '')
        setScenarioId(r.scenarioId ?? NONE)
        setActions(r.actions)
        setIgnoreSettings(r.ignoreFriendAddSettings)
        setActionMode(r.actionMode)
        setAdImportMode(r.adImportMode)
        setAdRows(r.adParamMap)
        setHtmlHead(r.htmlHead ?? '')
        setHtmlBody(r.htmlBody ?? '')
        setLanding(r.landingStyle ?? {})
        setRouteUrl(r.url)
        setGeo({ lat: r.geoLat === null ? '' : String(r.geoLat), lng: r.geoLng === null ? '' : String(r.geoLng), radius: r.geoRadius === null ? '' : String(r.geoRadius) })
      } catch {
        setError('読み込めませんでした。時間をおいてもう一度お試しください')
      }
    })()
  }, [])

  // 新規のときは、選んでいる公式アカウントに作る
  useEffect(() => {
    if (!isEdit && selectedAccountId) setAccountId(selectedAccountId)
  }, [isEdit, selectedAccountId])

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    void api.inflow.folders(accountId).then((res) => {
      if (cancelled) return
      if (res.success) setFolders(res.data.folders)
      setReady(true)
    }).catch(() => setReady(true))
    return () => {
      cancelled = true
    }
  }, [accountId])

  const hasActions = actions.length > 0 || !!scenarioId
  const hasPeriod = !!(from.date || from.time || to.date || to.time)
  const backHref = `/inflow-links${initialGroup ? `?group=${initialGroup}` : ''}`

  const save = async () => {
    setError('')
    if (!name.trim()) {
      setError('流入経路名を入力してください')
      return
    }
    const body = {
      lineAccountId: accountId,
      name: name.trim(),
      folderId: folderId || null,
      qrText: qrText.trim() || null,
      validFrom: joinDateTime(from),
      validTo: joinDateTime(to),
      outOfPeriodMessage: hasPeriod ? outMessage.trim() || null : null,
      actions,
      scenarioId: scenarioId || null,
      ignoreFriendAddSettings: hasActions && ignoreSettings,
      actionMode,
      adImportMode,
      adParamMap: adRows,
      htmlHead: htmlHead.trim() || null,
      htmlBody: htmlBody.trim() || null,
      geoLat: geo.lat.trim() === '' ? null : Number(geo.lat),
      geoLng: geo.lng.trim() === '' ? null : Number(geo.lng),
      geoRadius: geo.radius.trim() === '' ? null : Number(geo.radius),
      landingStyle: landing,
    }
    setSaving(true)
    try {
      const res = editId ? await api.inflow.updateRoute(editId, body) : await api.inflow.createRoute(body)
      if (!res.success) {
        setError(('error' in res && typeof res.error === 'string' && res.error) || '保存できませんでした')
        return
      }
      router.push(`/inflow-links?group=${folderId}`)
    } catch (err) {
      setError(errorText(err, '保存できませんでした'))
    } finally {
      setSaving(false)
    }
  }

  const createFolder = async () => {
    const name = newFolderName.trim()
    if (!name || creatingFolder || !accountId) return
    setCreatingFolder(true)
    setFolderError('')
    try {
      const res = await api.inflow.createFolder(accountId, name)
      if (res.success) {
        setFolders((prev) => [...prev, { id: res.data.id, name: res.data.name, count: 0 }])
        setFolderId(res.data.id)
        setFolderDialog(false)
        setNewFolderName('')
      }
    } catch (err) {
      setFolderError(errorText(err, 'フォルダを作れませんでした'))
    } finally {
      setCreatingFolder(false)
    }
  }

  const title = isEdit ? '流入経路編集' : '流入経路登録'

  return (
    <div className="pb-24">
      <p className="mb-4 text-xs text-[#414143]">
        <Link href={backHref} className="text-[#2b7bb9] underline">流入経路一覧</Link>
        <span className="mx-1">&gt;</span>
        {title}
      </p>
      <Header title={title} />

      {!ready && !error ? (
        <p className="text-sm text-[#757578]">読み込み中...</p>
      ) : (
        <div className="max-w-[72rem] space-y-6">
          <div className="flex flex-wrap gap-5">
            <div className="w-[21rem] max-w-full">
              <label className={labelCls}>流入経路名 <Required /></label>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} className={inputCls} aria-label="流入経路名" />
            </div>
            <div className="w-[13rem]">
              <label className={labelCls}>フォルダ名</label>
              <select
                value={folderId}
                onChange={(e) => {
                  if (e.target.value === NEW_FOLDER) {
                    setNewFolderName('')
                    setFolderError('')
                    setFolderDialog(true)
                    return
                  }
                  setFolderId(e.target.value)
                }}
                className={`${inputCls} bg-white`}
                aria-label="フォルダ名"
              >
                <option value={NEW_FOLDER}>＋ 新しいフォルダ</option>
                <option value="">未分類</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>

          <div className="w-[13rem]">
            <label className={labelCls}>QRコード表示用テキスト</label>
            <input value={qrText} onChange={(e) => setQrText(e.target.value)} maxLength={10} className={inputCls} aria-label="QRコード表示用テキスト" />
            <p className="mt-1 text-right text-[11px] text-[#757578]">{Array.from(qrText).length}/10</p>
          </div>

          <div>
            <p className={labelCls}>有効期間</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={from.date} onChange={(e) => setFrom({ ...from, date: e.target.value })} className={`${inputCls} !w-40`} aria-label="開始日" />
              <input type="time" value={from.time} onChange={(e) => setFrom({ ...from, time: e.target.value })} className={`${inputCls} !w-28`} aria-label="開始時刻" />
              <span className="text-sm">〜</span>
              <input type="date" value={to.date} onChange={(e) => setTo({ ...to, date: e.target.value })} className={`${inputCls} !w-40`} aria-label="終了日" />
              <input type="time" value={to.time} onChange={(e) => setTo({ ...to, time: e.target.value })} className={`${inputCls} !w-28`} aria-label="終了時刻" />
              {hasPeriod ? (
                <button type="button" onClick={() => { setFrom({ date: '', time: '' }); setTo({ date: '', time: '' }) }} className="h-10 rounded border border-[#cacace] bg-white px-3 text-xs hover:bg-[#f7f7f9]">クリア</button>
              ) : null}
            </div>
            {hasPeriod ? (
              <div className="mt-3 max-w-[32rem]">
                <label className={labelCls}>有効期間外メッセージ</label>
                <textarea
                  value={outMessage}
                  onChange={(e) => setOutMessage(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="現在ご利用いただけません"
                  aria-label="有効期間外メッセージ"
                  className="w-full rounded border border-[#cacace] px-3 py-2 text-sm outline-none focus:border-[#069e04]"
                />
              </div>
            ) : null}
          </div>

          <section className="rounded border border-[#cacace] bg-white">
            <header className="border-b border-[#cacace] bg-[#f1f1f4] px-4 py-2 text-xs font-bold text-[#414143]">アクション設定</header>
            <div className="p-4">
              <label className={labelCls}>シナリオ</label>
              <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} className={`${inputCls} max-w-[24rem] bg-white`} aria-label="シナリオ">
                <option value="" />
                {lookups.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <hr className="my-4 border-[#e3e3e6]" />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActionModal(true)}
                  className="inline-flex items-center gap-1.5 rounded bg-[#f0ad4e] px-3 py-2 text-sm font-medium text-white hover:bg-[#ec9f35]"
                >
                  <LightningIcon size={14} weight="fill" /> その他のアクションを設定する
                </button>
                {actions.length > 0 ? (
                  <button type="button" onClick={() => setActions([])} className="rounded border border-green-600 bg-white px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50">
                    設定解除
                  </button>
                ) : null}
              </div>
              {actions.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-[11px] text-[#414143]">
                  {actions.map((a, i) => (
                    <li key={i}>
                      {describeAction(a, lookups)}
                      {(a.type === 'text' || a.type === 'template') && a.timing && a.timing.mode !== 'now' ? `(${describeTiming(a.timing)})` : ''}
                      {a.condition ? '(条件あり)' : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>

          <div>
            <p className={labelCls}>友だち追加時設定のアクション</p>
            <div className="flex items-center gap-6">
              <Radio name="ignore" checked={!ignoreSettings || !hasActions} disabled={!hasActions} onChange={() => setIgnoreSettings(false)}>無視しない</Radio>
              <Radio name="ignore" checked={ignoreSettings && hasActions} disabled={!hasActions} onChange={() => setIgnoreSettings(true)}>無視する</Radio>
            </div>
          </div>

          <div>
            <p className={labelCls}>アクションの実行</p>
            <div className="flex items-center gap-6">
              <Radio name="mode" checked={actionMode === 'always'} disabled={isEdit} onChange={() => setActionMode('always')}>いつでも</Radio>
              <Radio name="mode" checked={actionMode === 'first'} disabled={isEdit} onChange={() => setActionMode('first')}>初回の友だち追加時のみ</Radio>
            </div>
          </div>

          <div className="space-y-3">
            <Accordion title="広告連携" defaultOpen={adRows.length > 0}>
              <div className="max-w-[40rem]">
                <div className="grid grid-cols-[1fr_1fr_2.5rem] items-center bg-[#f1f1f4] px-2 text-xs text-[#757578]" style={{ height: 34 }}>
                  <span>パラメータ名</span>
                  <span>友だち情報</span>
                  <span />
                </div>
                {adRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_2.5rem] items-center gap-2 border-b border-[#e3e3e6] bg-white px-2 py-2">
                    <input
                      value={row.param}
                      onChange={(e) => setAdRows((prev) => prev.map((r, j) => (j === i ? { ...r, param: e.target.value } : r)))}
                      className={inputCls}
                      aria-label="パラメータ名"
                    />
                    <select
                      value={row.fieldKey}
                      onChange={(e) => setAdRows((prev) => prev.map((r, j) => (j === i ? { ...r, fieldKey: e.target.value } : r)))}
                      className={`${inputCls} bg-white`}
                      aria-label="友だち情報"
                    >
                      <option value="" />
                      {lookups.fields.map((f) => <option key={f.fieldKey} value={f.fieldKey}>{f.label}</option>)}
                    </select>
                    <button type="button" aria-label="この行を削除" onClick={() => setAdRows((prev) => prev.filter((_, j) => j !== i))} className="text-[#b5b5b9] hover:text-[#e5451f]">🗑</button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setAdRows((prev) => [...prev, { param: '', fieldKey: '' }])}
                  className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded border border-[#cacace] bg-white text-xs font-bold hover:bg-[#f7f7f9]"
                >
                  <span className="text-base leading-none">＋</span> 追加
                </button>
                <p className="mb-1 mt-4 text-xs font-bold">友だち情報への取り込み</p>
                <div className="flex items-center gap-6">
                  <Radio name="adMode" checked={adImportMode === 'always'} disabled={isEdit} onChange={() => setAdImportMode('always')}>いつでも</Radio>
                  <Radio name="adMode" checked={adImportMode === 'first'} disabled={isEdit} onChange={() => setAdImportMode('first')}>初回の友だち追加時のみ</Radio>
                </div>
              </div>
            </Accordion>

            <Accordion title="HTMLタグ" defaultOpen={!!(htmlHead || htmlBody)}>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>&lt;head&gt;内</label>
                  <textarea value={htmlHead} onChange={(e) => setHtmlHead(e.target.value)} rows={5} spellCheck={false} aria-label="headに入れるHTMLタグ" className="w-full rounded border border-[#cacace] px-3 py-2 font-mono text-xs outline-none focus:border-[#069e04]" />
                </div>
                <div>
                  <label className={labelCls}>&lt;body&gt;内</label>
                  <textarea value={htmlBody} onChange={(e) => setHtmlBody(e.target.value)} rows={5} spellCheck={false} aria-label="bodyに入れるHTMLタグ" className="w-full rounded border border-[#cacace] px-3 py-2 font-mono text-xs outline-none focus:border-[#069e04]" />
                </div>
              </div>
            </Accordion>

            <Accordion title="友だち追加ページ" defaultOpen>
              <LandingEditor value={landing} onChange={setLanding} openUrl={routeUrl ? `${routeUrl}${routeUrl.includes('?') ? '&' : '?'}preview=1` : undefined} />
            </Accordion>

            <Accordion title="位置情報" defaultOpen={!!(geo.lat || geo.lng || geo.radius)}>
              <div className="flex flex-wrap gap-4">
                <div className="w-40">
                  <label className={labelCls}>緯度</label>
                  <input value={geo.lat} onChange={(e) => setGeo({ ...geo, lat: e.target.value })} inputMode="decimal" className={inputCls} aria-label="緯度" />
                </div>
                <div className="w-40">
                  <label className={labelCls}>経度</label>
                  <input value={geo.lng} onChange={(e) => setGeo({ ...geo, lng: e.target.value })} inputMode="decimal" className={inputCls} aria-label="経度" />
                </div>
                <div className="w-40">
                  <label className={labelCls}>有効範囲(半径)</label>
                  <div className="flex items-center gap-1">
                    <input value={geo.radius} onChange={(e) => setGeo({ ...geo, radius: e.target.value })} inputMode="numeric" className={inputCls} aria-label="有効範囲(半径)" />
                    <span className="text-sm">m</span>
                  </div>
                </div>
              </div>
            </Accordion>
          </div>

          {error && <p className="text-sm text-[#e5451f]">{error}</p>}
        </div>
      )}

      <Dialog.Root open={folderDialog} onOpenChange={(open) => { if (!open && !creatingFolder) setFolderDialog(false) }}>
        <Dialog className="w-full max-w-sm p-5">
          <Dialog.Title>新しいフォルダ</Dialog.Title>
          <Input label="フォルダ名" autoFocus value={newFolderName} onValueChange={setNewFolderName} className="mt-4" />
          {folderError ? <p className="mt-2 text-sm text-[#e5451f]">{folderError}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFolderDialog(false)} disabled={creatingFolder}>キャンセル</Button>
            <Button type="button" variant="primary" loading={creatingFolder} onClick={() => void createFolder()} disabled={!newFolderName.trim()}>作る</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      {actionModal ? (
        <ActionSettingsModal
          open
          initial={actions}
          lookups={lookups}
          accountId={accountId}
          onClose={() => setActionModal(false)}
          onSave={(next) => {
            setActions(next)
            setActionModal(false)
          }}
        />
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e3e3e6] bg-white/95 px-6 py-3 backdrop-blur lg:left-60">
        <div className="relative flex items-center justify-center">
          <Link href={backHref} className="absolute left-0 text-xs text-[#2b7bb9] underline">流入経路一覧へ戻る</Link>
          <button
            type="button"
            disabled={saving || !ready || !accountId}
            onClick={() => void save()}
            className="h-10 w-32 rounded bg-[#069e04] text-sm font-bold text-white hover:bg-[#058503] disabled:opacity-60"
          >
            {saving ? '保存中...' : isEdit ? '保存' : '登録'}
          </button>
        </div>
      </div>
    </div>
  )
}
