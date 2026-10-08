'use client'

import { useEffect, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { fetchApi } from '@/lib/api'
import type { CalendarBundle, ScreenField, ScreenSettings, TextKind } from '@/lib/reserve'
import { Block, PageTitle, Radio, Row, SaveBar, inputCls, orangeBtn, smallInput, useSectionSave } from './config-common'

const KIND_LABEL: Record<TextKind, string> = { none: 'フォーマットなし', name: '名前', kana: '名前(カタカナ)', email: 'メールアドレス', phone: '電話番号', integer: '整数' }

function Shell({ title, children, onClose, onOk, okLabel = 'OK' }: { title: string; children: React.ReactNode; onClose: () => void; onOk: () => void; okLabel?: string }) {
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="lg" className="p-0 !w-[min(680px,95vw)] !max-w-none">
        <div className="border-b border-gray-200 px-5 py-3 text-base font-semibold">{title}</div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4 text-sm">{children}</div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button type="button" className="rounded border border-gray-300 px-4 py-2 text-sm" onClick={onClose}>キャンセル</button>
          <button type="button" className="rounded bg-[#e8355d] px-5 py-2 text-sm font-medium text-white hover:bg-[#d02850]" onClick={onOk}>{okLabel}</button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

function FieldEditor({ field, isNew, fieldKeys, onClose, onSave }: { field: ScreenField; isNew: boolean; fieldKeys: Array<{ key: string; label: string }>; onClose: () => void; onSave: (f: ScreenField) => void }) {
  const [f, setF] = useState<ScreenField>(field)
  const [options, setOptions] = useState(field.options.join('\n'))
  const [error, setError] = useState('')
  const locked = !isNew
  const ok = () => {
    if (!f.label.trim()) return setError('項目名を入力してください')
    const opts = options.split('\n').map((x) => x.trim()).filter(Boolean)
    if (f.type === 'select' && opts.length === 0) return setError('選択肢を1つ以上入力してください(1行に1つ)')
    onSave({ ...f, label: f.label.trim(), options: f.type === 'select' ? opts : [], linkGoogle: f.textKind === 'name' || f.textKind === 'kana' ? true : f.linkGoogle, linkRealName: f.textKind === 'name' && f.linkRealName })
  }
  return (
    <Shell title={isNew ? '予約情報取得項目の追加' : '予約情報取得項目の編集'} onClose={onClose} onOk={ok} okLabel={isNew ? '追加する' : '更新する'}>
      <Row label="項目名" note="友だち予約画面に表示されます。"><input className={inputCls} value={f.label} maxLength={100} onChange={(e) => setF({ ...f, label: e.target.value })} /></Row>
      <Row label="説明文" note="友だち予約画面の、項目の下に表示されます。"><textarea className={inputCls} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Row>
      <Row label="入力タイプ" note={locked ? '登録後は、入力タイプを変更できません。変えたいときは、項目を作り直してください。' : undefined}>
        <Radio disabled={locked} checked={f.type === 'text'} onChange={() => setF({ ...f, type: 'text' })} label="記述式(テキストボックス)" />
        <Radio disabled={locked} checked={f.type === 'textarea'} onChange={() => setF({ ...f, type: 'textarea', textKind: 'none' })} label="段落(テキストエリア)" />
        <Radio disabled={locked} checked={f.type === 'select'} onChange={() => setF({ ...f, type: 'select', textKind: 'none' })} label="プルダウン" />
      </Row>
      {f.type === 'text' ? (
        <Row label="取得情報種別" note="「名前」は予約一覧に表示されます。">
          <select disabled={locked} className={`${smallInput} w-56`} value={f.textKind} onChange={(e) => setF({ ...f, textKind: e.target.value as TextKind, linkRealName: e.target.value === 'name' ? f.linkRealName : false })}>
            {(Object.keys(KIND_LABEL) as TextKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Row>
      ) : null}
      {f.type === 'select' ? <Row label="選択肢" note="1行に1つ入力します。"><textarea className={inputCls} rows={4} value={options} onChange={(e) => setOptions(e.target.value)} /></Row> : null}
      <Row label="オプション">
        <label className="mb-1 flex items-center gap-2"><input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /> 取得情報を必須項目にする</label>
        <label className="mb-1 flex items-center gap-2"><input type="checkbox" checked={f.friendFieldKey !== null} onChange={(e) => setF({ ...f, friendFieldKey: e.target.checked ? fieldKeys[0]?.key ?? null : null })} /> 取得情報を友だち情報と紐づける</label>
        {f.friendFieldKey !== null ? (
          <select className={`${smallInput} mb-1 ml-6 w-64`} value={f.friendFieldKey} onChange={(e) => setF({ ...f, friendFieldKey: e.target.value })}>
            {fieldKeys.length === 0 ? <option value="">友だち情報欄がありません</option> : null}
            {fieldKeys.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        ) : null}
        <label className={`mb-1 flex items-center gap-2 ${f.textKind === 'name' || f.textKind === 'kana' ? 'opacity-60' : ''}`}><input type="checkbox" disabled={f.textKind === 'name' || f.textKind === 'kana'} checked={f.linkGoogle || f.textKind === 'name' || f.textKind === 'kana'} onChange={(e) => setF({ ...f, linkGoogle: e.target.checked })} /> Googleカレンダーに連携する</label>
        <label className={`flex items-center gap-2 ${f.type === 'text' && f.textKind === 'name' ? '' : 'opacity-60'}`}><input type="checkbox" disabled={!(f.type === 'text' && f.textKind === 'name')} checked={f.linkRealName} onChange={(e) => setF({ ...f, linkRealName: e.target.checked })} /> 取得情報と本名を紐づける</label>
      </Row>
      {error ? <p className="text-red-600">{error}</p> : null}
    </Shell>
  )
}

/** 予約設定 > 予約画面(カレンダー表示・管理者情報・同意事項・サンクスページ・予約情報取得項目) */
export default function ScreenConfig({ bundle, reload }: { bundle: CalendarBundle; reload: () => void }) {
  const cal = bundle.calendar
  const [s, setS] = useState<ScreenSettings>(cal.screen)
  const [hours, setHours] = useState(Math.floor(cal.screen.unitMinutes / 60))
  const [mins, setMins] = useState(cal.screen.unitMinutes % 60)
  const [dialog, setDialog] = useState<'admin' | 'consent' | null>(null)
  const [fieldEdit, setFieldEdit] = useState<{ index: number; field: ScreenField; isNew: boolean } | null>(null)
  const [fieldKeys, setFieldKeys] = useState<Array<{ key: string; label: string }>>([])
  const { busy, message, save } = useSectionSave(cal.id, 'screen', reload)

  useEffect(() => {
    fetchApi<{ success: boolean; data: Array<{ field_key?: string; fieldKey?: string; label: string }> }>('/api/friend-fields/definitions')
      .then((r) => { if (r.success) setFieldKeys(r.data.map((d) => ({ key: (d.fieldKey ?? d.field_key) as string, label: d.label }))) })
      .catch(() => undefined)
  }, [])

  const unit = hours * 60 + mins
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= s.fields.length) return
    const f = [...s.fields]
    ;[f[i], f[j]] = [f[j], f[i]]
    setS({ ...s, fields: f })
  }

  const [adminDraft, setAdminDraft] = useState(s.adminInfo)
  const [consentDraft, setConsentDraft] = useState(s.consent)

  return (
    <div>
      <PageTitle>予約画面設定</PageTitle>

      <Block title="カレンダー表示" id="view">
        <Row label="カレンダーの表示形式" note="友だちが予約する画面で、最初に表示する形式です(月間表示は、日を選ぶと週間表示に切り替わります)。">
          <select className={`${smallInput} w-48`} value={s.view} onChange={(e) => setS({ ...s, view: e.target.value as 'week' | 'month' })}><option value="week">週間表示</option><option value="month">月間表示</option></select>
        </Row>
        <Row label="予約時間の単位" note="15分にすると、予約できる時間は 10:00、10:15、10:30 のように15分刻みになります。">
          <select className={smallInput} value={hours} onChange={(e) => setHours(Number(e.target.value))}>{[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24].map((h) => <option key={h} value={h}>{h}</option>)}</select> 時間{' '}
          <select className={smallInput} value={mins} onChange={(e) => setMins(Number(e.target.value))}>{[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => <option key={m} value={m}>{m}</option>)}</select> 分
          {unit < 5 ? <span className="ml-2 text-xs text-red-600">5分以上にしてください</span> : null}
        </Row>
      </Block>

      <Block title="管理者情報" id="admin" hint="店舗・会社・オーナーなど、予約の受付元の情報です。表示すると、友だち予約画面の下に「管理者情報」ボタンが出ます。">
        <Row label="管理者情報表示">
          <label className="mr-3 inline-flex items-center gap-2"><input type="checkbox" checked={s.adminInfo.show} onChange={(e) => setS({ ...s, adminInfo: { ...s.adminInfo, show: e.target.checked } })} /> 表示する</label>
          <button type="button" className="rounded-full border border-green-600 px-3 py-1 text-xs text-green-700 hover:bg-green-50" onClick={() => { setAdminDraft(s.adminInfo); setDialog('admin') }}>内容を設定する</button>
        </Row>
        <Row label="同意事項" note="表示にすると、友だちが予約するときに同意が必要になります。項目名が空のときは「注意事項・利用規約」と表示します。">
          <label className="mr-3 inline-flex items-center gap-2"><input type="checkbox" checked={s.consent.show} onChange={(e) => setS({ ...s, consent: { ...s.consent, show: e.target.checked } })} /> 表示する</label>
          <button type="button" className="rounded-full border border-green-600 px-3 py-1 text-xs text-green-700 hover:bg-green-50" onClick={() => { setConsentDraft(s.consent); setDialog('consent') }}>内容を設定する</button>
        </Row>
      </Block>

      <Block title="サンクスページURL" id="thanks" hint="予約の操作が終わったあとに移動するページです。リクエスト制のときは、各リクエストが終わったときに移動します。">
        <Row label="予約完了 / リクエスト後"><input className={inputCls} placeholder="https://" value={s.thanksUrls.complete} onChange={(e) => setS({ ...s, thanksUrls: { ...s.thanksUrls, complete: e.target.value } })} /></Row>
        <Row label="予約変更 / リクエスト後"><input className={inputCls} placeholder="https://" value={s.thanksUrls.change} onChange={(e) => setS({ ...s, thanksUrls: { ...s.thanksUrls, change: e.target.value } })} /></Row>
        <Row label="予約キャンセル / リクエスト後"><input className={inputCls} placeholder="https://" value={s.thanksUrls.cancel} onChange={(e) => setS({ ...s, thanksUrls: { ...s.thanksUrls, cancel: e.target.value } })} /></Row>
      </Block>

      <Block title="予約情報取得項目" id="fields" hint="友だちが予約するときに入力してもらう項目です。追加した項目は、管理者の新規予約にも出ます。">
        <div className="py-2">
          {s.fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-3 border-b border-gray-200 py-2.5">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{f.label}</span>
                {f.required ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">必須</span> : null}
                <span className="ml-2 text-xs text-gray-500">{f.type === 'text' ? KIND_LABEL[f.textKind] : f.type === 'textarea' ? '段落' : 'プルダウン'}</span>
              </div>
              <button type="button" aria-label="編集" className="rounded p-1.5 text-gray-500 hover:bg-gray-100" onClick={() => setFieldEdit({ index: i, field: f, isNew: false })}><PencilSimpleIcon size={16} /></button>
              <button type="button" aria-label="削除" className="rounded p-1.5 text-gray-500 hover:bg-gray-100" onClick={() => setS({ ...s, fields: s.fields.filter((_, j) => j !== i) })}><TrashIcon size={16} /></button>
              <button type="button" aria-label="上へ" className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpIcon size={16} /></button>
              <button type="button" aria-label="下へ" className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30" disabled={i === s.fields.length - 1} onClick={() => move(i, 1)}><ArrowDownIcon size={16} /></button>
            </div>
          ))}
          <button
            type="button"
            className={`${orangeBtn} mt-3`}
            onClick={() => setFieldEdit({ index: -1, isNew: true, field: { id: `f${Date.now().toString(36)}`, label: '', description: '', type: 'text', textKind: 'none', options: [], required: false, friendFieldKey: null, linkGoogle: false, linkRealName: false } })}
          >
            <PlusIcon size={14} weight="bold" /> 情報取得項目を追加する
          </button>
        </div>
      </Block>

      <SaveBar busy={busy} message={message} onSave={() => void save({ ...s, unitMinutes: unit })} />

      {dialog === 'admin' ? (
        <Shell title="管理者情報" onClose={() => setDialog(null)} onOk={() => { setS({ ...s, adminInfo: adminDraft }); setDialog(null) }}>
          <Row label="イメージ画像URL"><input className={inputCls} placeholder="https://" value={adminDraft.imageUrl} onChange={(e) => setAdminDraft({ ...adminDraft, imageUrl: e.target.value })} /></Row>
          <Row label="管理者名" note="予約画面の上部にも表示されます。空のときは「予約ページ」と表示します。"><input className={inputCls} value={adminDraft.name} onChange={(e) => setAdminDraft({ ...adminDraft, name: e.target.value })} /></Row>
          <Row label="所在地"><input className={inputCls} value={adminDraft.address} onChange={(e) => setAdminDraft({ ...adminDraft, address: e.target.value })} /></Row>
          <Row label="電話番号"><input className={inputCls} value={adminDraft.phone} onChange={(e) => setAdminDraft({ ...adminDraft, phone: e.target.value })} /></Row>
          <Row label="説明文"><textarea className={inputCls} rows={5} value={adminDraft.description} onChange={(e) => setAdminDraft({ ...adminDraft, description: e.target.value })} /></Row>
        </Shell>
      ) : null}
      {dialog === 'consent' ? (
        <Shell title="同意事項" onClose={() => setDialog(null)} onOk={() => { setS({ ...s, consent: consentDraft }); setDialog(null) }}>
          <Row label="同意事項の項目名"><input className={inputCls} placeholder="注意事項・利用規約" value={consentDraft.title} onChange={(e) => setConsentDraft({ ...consentDraft, title: e.target.value })} /></Row>
          <Row label="説明文"><textarea className={inputCls} rows={8} value={consentDraft.body} onChange={(e) => setConsentDraft({ ...consentDraft, body: e.target.value })} /></Row>
        </Shell>
      ) : null}
      {fieldEdit ? (
        <FieldEditor
          field={fieldEdit.field}
          isNew={fieldEdit.isNew}
          fieldKeys={fieldKeys}
          onClose={() => setFieldEdit(null)}
          onSave={(f) => {
            setS({ ...s, fields: fieldEdit.isNew ? [...s.fields, f] : s.fields.map((x, i) => (i === fieldEdit.index ? f : x)) })
            setFieldEdit(null)
          }}
        />
      ) : null}
    </div>
  )
}
