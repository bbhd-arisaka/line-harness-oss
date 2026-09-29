'use client'

import { useState, type ReactNode } from 'react'
import type { FormDraft, LstepOptions } from './editor-types'

/** Lステップ風モーダル: 緑の見出し・右上×・下に「閉じる」「保存する」。 */
function Modal({
  title,
  onClose,
  onSave,
  wide,
  children,
}: {
  title: string
  onClose: () => void
  onSave: () => void
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-3xl'} rounded bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-[#e3e3e6] px-6 py-4">
          <h2 className="text-base font-bold text-[#069e04]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-2xl leading-none text-[#414143]">×</button>
        </div>
        <div className="max-h-[calc(100vh-15rem)] overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex justify-end gap-3 border-t border-[#e3e3e6] px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 w-28 rounded border border-[#cacace] bg-white text-sm hover:bg-[#f7f7f9]">閉じる</button>
          <button type="button" onClick={onSave} className="h-10 w-28 rounded bg-[#069e04] text-sm font-bold text-white hover:bg-[#058503]">保存する</button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-4 border-b border-[#f0f0f2] py-4 last:border-b-0">
      <div className="text-sm font-bold">{label}</div>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  )
}

function Sub({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] items-start gap-3 text-sm">
      <span className="pt-2 text-xs text-[#757578]">{label}</span>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

const input = 'h-10 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]'
const check = 'flex items-center gap-2 text-sm'

// ─────────────────────────────────────────────────────────────
// オプション設定
// ─────────────────────────────────────────────────────────────

export function OptionModal({
  draft,
  tags,
  scenarios,
  sheetsEmail,
  onClose,
  onSave,
}: {
  draft: FormDraft
  tags: Array<{ id: string; name: string }>
  scenarios: Array<{ id: string; name: string }>
  sheetsEmail: string | null
  onClose: () => void
  onSave: (patch: Partial<FormDraft>) => void
}) {
  const [d, setD] = useState<FormDraft>(draft)
  const [actionOpen, setActionOpen] = useState(false)
  const set = (patch: Partial<FormDraft>) => setD((prev) => ({ ...prev, ...patch }))
  const setL = (patch: Partial<LstepOptions>) => setD((prev) => ({ ...prev, lstep: { ...prev.lstep, ...patch } }))
  const l = d.lstep

  return (
    <Modal
      title="オプション設定"
      onClose={onClose}
      onSave={() => onSave(d)}
    >
      <Row label={<>Google<br />スプレッドシート連携</>}>
        <label className={check}>
          <input type="checkbox" checked={d.googleSheetsEnabled} onChange={(e) => set({ googleSheetsEnabled: e.target.checked })} />
          使用する
        </label>
        {d.googleSheetsEnabled && (
          <div className="space-y-2">
            <input className={input} placeholder="スプレッドシートのURL" value={d.googleSheetUrl} onChange={(e) => set({ googleSheetUrl: e.target.value })} />
            <input className={input} placeholder="シート名(タブ名)" value={d.googleSheetName} onChange={(e) => set({ googleSheetName: e.target.value })} />
            <p className="text-[11px] text-[#757578]">
              スプレッドシートの共有設定で、次のアドレスを「編集者」として追加してください:
              <br />
              <span className="font-mono">{sheetsEmail ?? '(サービスアカウント未設定)'}</span>
            </p>
          </div>
        )}
      </Row>

      <Row label="回答設定">
        <Sub label="回答後アクション">
          <button
            type="button"
            onClick={() => setActionOpen((v) => !v)}
            className="inline-flex h-10 items-center gap-1 rounded bg-[#f0b03c] px-4 text-sm font-bold text-white hover:bg-[#e0a02c]"
          >
            <span aria-hidden="true">⚡</span> アクション設定
          </button>
          {(d.onSubmitTagId || d.onSubmitScenarioId || d.onSubmitStopScenarios) && !actionOpen && (
            <p className="text-[11px] text-[#757578]">
              設定あり:
              {d.onSubmitTagId && ` タグ追加(${tags.find((t) => t.id === d.onSubmitTagId)?.name ?? '?'})`}
              {d.onSubmitScenarioId && ` シナリオ開始(${scenarios.find((s) => s.id === d.onSubmitScenarioId)?.name ?? '?'})`}
              {d.onSubmitStopScenarios && ' シナリオ停止'}
            </p>
          )}
          {actionOpen && (
            <div className="space-y-3 rounded border border-[#e3e3e6] bg-[#fafafb] p-3">
              <div>
                <p className="mb-1 text-xs text-[#757578]">回答した友だちにタグを追加</p>
                <select className={input} value={d.onSubmitTagId} onChange={(e) => set({ onSubmitTagId: e.target.value })}>
                  <option value="">(設定しない)</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <p className="mb-1 text-xs text-[#757578]">シナリオを開始</p>
                <select className={input} value={d.onSubmitScenarioId} onChange={(e) => set({ onSubmitScenarioId: e.target.value })}>
                  <option value="">(設定しない)</option>
                  {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <label className={check}>
                <input type="checkbox" checked={d.onSubmitStopScenarios} onChange={(e) => set({ onSubmitStopScenarios: e.target.checked })} />
                進行中のシナリオを停止する
              </label>
            </div>
          )}
        </Sub>
        <Sub label="サンクスページURL">
          <input className={input} placeholder="https://..." value={d.thanksUrl} onChange={(e) => set({ thanksUrl: e.target.value })} />
        </Sub>
        <Sub label="回答後テキスト">
          <textarea
            rows={3}
            className="w-full rounded border border-[#cacace] px-3 py-2 text-sm outline-none focus:border-[#069e04]"
            placeholder="ありがとうございました。"
            value={l.thanksText ?? ''}
            onChange={(e) => setL({ thanksText: e.target.value })}
          />
          <p className="text-[11px] text-[#757578]">※サンクスページURLを設定しない場合の文章を設定します</p>
        </Sub>
        <Sub label="2回目以降の回答">
          <label className={check}>
            <input type="checkbox" checked={d.restorePreviousAnswer} onChange={(e) => set({ restorePreviousAnswer: e.target.checked })} />
            前回の回答を復元する(初期値は無視されます)
          </label>
          <p className="text-[11px] text-[#757578]">※別のフォームの回答や、回答した端末が異なる場合、時間が経過した場合は復元できません</p>
        </Sub>
      </Row>

      <Row label="ページタイトル設定">
        <Sub label="ページタイトル名">
          <input className={input} placeholder="回答フォーム" value={l.pageTitle ?? ''} onChange={(e) => setL({ pageTitle: e.target.value })} />
        </Sub>
      </Row>

      <Row label="ボタン設定">
        <Sub label="送信ボタン文言">
          <input className={`${input} max-w-[14rem]`} placeholder="送信" value={l.submitLabel ?? ''} onChange={(e) => setL({ submitLabel: e.target.value })} />
        </Sub>
        <Sub label="セクション移動ボタン文言">
          <input className={`${input} max-w-[14rem]`} placeholder="次へ" value={l.nextLabel ?? ''} onChange={(e) => setL({ nextLabel: e.target.value })} />
        </Sub>
        <Sub label="ボタンスタイル">
          <select className={`${input} max-w-[14rem]`} value={l.buttonStyle ?? 'default'} onChange={(e) => setL({ buttonStyle: e.target.value as LstepOptions['buttonStyle'] })}>
            <option value="default">デフォルト</option>
            <option value="rounded">丸型</option>
            <option value="square">角型</option>
          </select>
        </Sub>
        <Sub label="色">
          <div className="flex items-center gap-2">
            <input type="color" className="h-10 w-14 rounded border border-[#cacace]" value={l.buttonColor || '#06c755'} onChange={(e) => setL({ buttonColor: e.target.value })} />
            {l.buttonColor && <button type="button" className="text-xs text-[#2b7bb9] underline" onClick={() => setL({ buttonColor: '' })}>既定に戻す</button>}
          </div>
        </Sub>
      </Row>

      <Row label="セクションヘッダ">
        <Sub label="表示スタイル">
          <select className={`${input} max-w-[14rem]`} value={l.sectionHeaderStyle ?? 'page-number'} onChange={(e) => setL({ sectionHeaderStyle: e.target.value as LstepOptions['sectionHeaderStyle'] })}>
            <option value="page-number">ページ番号</option>
            <option value="progress">進捗バー</option>
            <option value="none">表示しない</option>
          </select>
          <p className="text-[11px] text-[#757578]">※複数セクション時に表示されます</p>
        </Sub>
      </Row>

      <Row label="確認ダイアログ">
        <label className={check}>
          <input type="checkbox" checked={Boolean(l.confirmDialog)} onChange={(e) => setL({ confirmDialog: e.target.checked })} />
          使用する
        </label>
      </Row>

      <Row label="回答受付期間">
        <Sub label="開始日時を設定">
          <input type="datetime-local" className={`${input} max-w-[16rem]`} value={(l.startsAt ?? '').slice(0, 16)} onChange={(e) => setL({ startsAt: e.target.value ? `${e.target.value}:00` : null })} />
        </Sub>
        <Sub label="締切日時を設定">
          <input type="datetime-local" className={`${input} max-w-[16rem]`} value={d.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} />
        </Sub>
      </Row>

      <Row label="1人1回に回答を制限">
        <label className={check}>
          <input type="checkbox" checked={d.answerLimitPerFriend === 'once'} onChange={(e) => set({ answerLimitPerFriend: e.target.checked ? 'once' : 'unlimited' })} />
          使用する
        </label>
      </Row>

      <Row label="トータル回答数を制限">
        <label className={check}>
          <input type="checkbox" checked={d.capacityLimit !== ''} onChange={(e) => set({ capacityLimit: e.target.checked ? '100' : '' })} />
          使用する
        </label>
        {d.capacityLimit !== '' && (
          <div className="flex items-center gap-2">
            <input type="number" min={1} className={`${input} max-w-[10rem]`} value={d.capacityLimit} onChange={(e) => set({ capacityLimit: e.target.value })} />
            <span className="text-sm">件まで</span>
          </div>
        )}
      </Row>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────
// デザイン設定
// ─────────────────────────────────────────────────────────────

const THEMES: Array<{ name: string; main: string; sub: string; accent: string; error: string; text: string }> = [
  { name: 'グリーン', main: '#06c755', sub: '#f2c700', accent: '#e5451f', error: '#e53e3e', text: '#333333' },
  { name: 'ティール', main: '#0e9aa7', sub: '#f2c700', accent: '#d9534f', error: '#e53e3e', text: '#333333' },
  { name: 'ピンク', main: '#d97786', sub: '#f7d6dc', accent: '#b94a5c', error: '#e53e3e', text: '#4a3a3d' },
  { name: 'ブルー', main: '#2f62d0', sub: '#9ec1ff', accent: '#f28c28', error: '#e53e3e', text: '#26314d' },
  { name: 'モノトーン', main: '#414143', sub: '#b5b5b9', accent: '#069e04', error: '#e53e3e', text: '#333333' },
]

function ColorDot({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
      <span className="relative inline-block h-7 w-7 overflow-hidden rounded-full border border-[#cacace]" style={{ background: value || '#ffffff' }}>
        <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      </span>
      {label}
    </label>
  )
}

export function DesignModal({
  draft,
  onClose,
  onSave,
}: {
  draft: FormDraft
  onClose: () => void
  onSave: (patch: Partial<FormDraft>) => void
}) {
  const [d, setD] = useState<FormDraft>(draft)
  const [tab, setTab] = useState<'custom' | 'theme'>('custom')
  const set = (patch: Partial<FormDraft>) => setD((prev) => ({ ...prev, ...patch }))
  const opacity = d.lstep.backgroundImageOpacity ?? 100

  return (
    <Modal title="デザイン設定" onClose={onClose} onSave={() => onSave(d)} wide>
      <div className="mb-4 flex border-b-2 border-[#069e04] bg-[#dff3df]">
        {(['custom', 'theme'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-6 py-2 text-sm font-bold ${tab === t ? 'bg-[#069e04] text-white' : 'text-[#414143]'}`}
          >
            {t === 'custom' ? 'カスタマイズ' : 'テーマ'}
          </button>
        ))}
      </div>

      {tab === 'theme' ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {THEMES.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => set({ themeMainColor: t.main, themeSubColor: t.sub, primaryColor: t.accent, themeErrorColor: t.error, themeTextColor: t.text })}
              className="rounded border border-[#dcdce0] p-3 text-left hover:border-[#069e04]"
            >
              <span className="mb-2 flex gap-1">
                {[t.main, t.sub, t.accent, t.error, t.text].map((c) => <span key={c} className="h-5 w-5 rounded-full border border-black/10" style={{ background: c }} />)}
              </span>
              <span className="text-sm">{t.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 font-bold">
              簡易設定
              <input type="checkbox" checked={d.customCssEnabled} onChange={(e) => set({ customCssEnabled: e.target.checked })} />
              CSS設定
            </label>
          </div>
          {d.customCssEnabled ? (
            <textarea
              rows={10}
              className="w-full rounded border border-[#cacace] p-3 font-mono text-xs outline-none focus:border-[#069e04]"
              placeholder=".form-page { ... }"
              value={d.customCss}
              onChange={(e) => set({ customCss: e.target.value })}
            />
          ) : (
            <div className="space-y-5 text-sm">
              <div className="grid grid-cols-[8rem_1fr] items-center gap-4">
                <span className="font-bold">テーマカラー</span>
                <div className="flex flex-wrap gap-4 border-l border-[#e3e3e6] pl-4">
                  <ColorDot label="メイン" value={d.themeMainColor} onChange={(v) => set({ themeMainColor: v })} />
                  <ColorDot label="サブ" value={d.themeSubColor} onChange={(v) => set({ themeSubColor: v })} />
                  <ColorDot label="アクセント" value={d.primaryColor} onChange={(v) => set({ primaryColor: v })} />
                  <ColorDot label="エラー" value={d.themeErrorColor} onChange={(v) => set({ themeErrorColor: v })} />
                  <ColorDot label="テキスト" value={d.themeTextColor} onChange={(v) => set({ themeTextColor: v })} />
                </div>
              </div>
              <div className="grid grid-cols-[8rem_1fr] items-center gap-4">
                <span className="font-bold">背景色</span>
                <div className="flex items-center gap-4 border-l border-[#e3e3e6] pl-4">
                  <ColorDot label="ページ背景" value={d.backgroundColor} onChange={(v) => set({ backgroundColor: v })} />
                  <ColorDot label="フォーム背景" value={d.formBackgroundColor} onChange={(v) => set({ formBackgroundColor: v })} />
                </div>
              </div>
              <div className="grid grid-cols-[8rem_1fr] items-start gap-4">
                <span className="pt-2 font-bold">ヘッダー画像</span>
                <div className="border-l border-[#e3e3e6] pl-4">
                  <input className={input} placeholder="画像のURL(https://...)" value={d.headerImageUrl} onChange={(e) => set({ headerImageUrl: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-[8rem_1fr] items-start gap-4">
                <span className="pt-2 font-bold">背景画像</span>
                <div className="space-y-2 border-l border-[#e3e3e6] pl-4">
                  <input className={input} placeholder="画像のURL(https://...)" value={d.backgroundImageUrl} onChange={(e) => set({ backgroundImageUrl: e.target.value })} />
                  <div className="flex items-center gap-3 text-xs">
                    透明度
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={opacity}
                      className="w-40 accent-[#069e04]"
                      onChange={(e) => set({ lstep: { ...d.lstep, backgroundImageOpacity: Number(e.target.value) } })}
                    />
                    <span className="w-10 rounded border border-[#cacace] px-2 py-1 text-right">{opacity}</span>%
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-[8rem_1fr] items-center gap-4">
                <span className="font-bold">フォント</span>
                <div className="border-l border-[#e3e3e6] pl-4">
                  <select className={`${input} max-w-[12rem]`} value={d.themeFont} onChange={(e) => set({ themeFont: e.target.value })}>
                    <option value="">ゴシック</option>
                    <option value="明朝">明朝</option>
                    <option value="丸ゴシック">丸ゴシック</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
