'use client'

import { LANDING_COLOR_FIELDS, LANDING_DEFAULTS } from '@/lib/inflow-routes'
import type { LandingColors, LandingStyle } from '@/lib/inflow-routes'

const HEX = /^#[0-9a-fA-F]{6}$/
const inputCls = 'h-9 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold">{label}</label>
      {children}
    </div>
  )
}

function colorOf(v: string | null | undefined, d: string): string {
  return typeof v === 'string' && HEX.test(v) ? v : d
}

/** 友だち追加ページのプレビュー(実際のページと同じ見た目) */
export function LandingPreview({ style }: { style: LandingStyle }) {
  const c = {
    pageBg: colorOf(style.colors?.pageBg, LANDING_DEFAULTS.colors.pageBg),
    cardBg: colorOf(style.colors?.cardBg, LANDING_DEFAULTS.colors.cardBg),
    text: colorOf(style.colors?.text, LANDING_DEFAULTS.colors.text),
    button: colorOf(style.colors?.button, LANDING_DEFAULTS.colors.button),
    buttonText: colorOf(style.colors?.buttonText, LANDING_DEFAULTS.colors.buttonText),
  }
  const muted = c.text === LANDING_DEFAULTS.colors.text ? '#999999' : `${c.text}a0`
  const title = style.title?.trim() || LANDING_DEFAULTS.title
  const button = style.buttonText?.trim() || LANDING_DEFAULTS.buttonText
  const hint = style.hintText?.trim()
  return (
    <div className="flex items-center justify-center rounded-lg border border-[#e3e3e6] p-5" style={{ background: c.pageBg }} aria-label="プレビュー">
      <div className="w-full max-w-[280px] rounded-2xl px-6 py-8 text-center" style={{ background: c.cardBg, boxShadow: '0 2px 20px rgba(0,0,0,0.06)' }}>
        <svg viewBox="0 0 48 48" width="44" height="44" className="mx-auto mb-4" aria-hidden="true">
          <rect width="48" height="48" rx="12" fill={c.button} />
          <path d="M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z" fill={c.buttonText} />
        </svg>
        <p className="mb-6 text-[15px] font-medium leading-relaxed" style={{ color: c.text }}>{title}</p>
        <div className="rounded-xl py-3.5 text-[15px] font-bold" style={{ background: c.button, color: c.buttonText, boxShadow: `0 2px 12px ${c.button}33` }}>{button}</div>
        {style.showHint !== false ? (
          <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: muted }}>
            {hint ? hint : <>※開かない場合はボタンを<strong style={{ color: c.button }}>長押し</strong>して「{button}」を選択</>}
          </p>
        ) : null}
        {style.showHelp !== false ? (
          <p className="mt-4 text-xs" style={{ color: muted }}>
            {style.helpText?.trim() || LANDING_DEFAULTS.helpText} <span className="underline">{style.helpLinkText?.trim() || LANDING_DEFAULTS.helpLinkText}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** 友だち追加ページの、文言と色の編集(左: 入力、右: プレビュー)。空にすると、既定の文言・色に戻る */
export default function LandingEditor({ value, onChange }: { value: LandingStyle; onChange: (v: LandingStyle) => void }) {
  const set = (patch: Partial<LandingStyle>) => onChange({ ...value, ...patch })
  const setColor = (key: keyof LandingColors, v: string) => onChange({ ...value, colors: { ...(value.colors ?? {}), [key]: v || null } })
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        <Field label="見出し">
          <input value={value.title ?? ''} onChange={(e) => set({ title: e.target.value })} maxLength={60} placeholder={LANDING_DEFAULTS.title} className={inputCls} aria-label="見出し" />
        </Field>
        <Field label="ボタンの文字">
          <input value={value.buttonText ?? ''} onChange={(e) => set({ buttonText: e.target.value })} maxLength={30} placeholder={LANDING_DEFAULTS.buttonText} className={inputCls} aria-label="ボタンの文字" />
        </Field>
        <Field label="ボタンの下の文(iPhone)">
          <input value={value.hintText ?? ''} onChange={(e) => set({ hintText: e.target.value })} maxLength={120} placeholder={LANDING_DEFAULTS.hintText} className={inputCls} aria-label="ボタンの下の文" disabled={value.showHint === false} />
          <label className="mt-1 flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={value.showHint === false} onChange={(e) => set({ showHint: e.target.checked ? false : true })} className="accent-[#069e04]" /> 表示しない
          </label>
        </Field>
        <Field label="「うまく開けない方は」の行">
          <div className="flex gap-2">
            <input value={value.helpText ?? ''} onChange={(e) => set({ helpText: e.target.value })} maxLength={40} placeholder={LANDING_DEFAULTS.helpText} className={inputCls} aria-label="うまく開けない方への文" disabled={value.showHelp === false} />
            <input value={value.helpLinkText ?? ''} onChange={(e) => set({ helpLinkText: e.target.value })} maxLength={20} placeholder={LANDING_DEFAULTS.helpLinkText} className={`${inputCls} !w-28`} aria-label="リンクの文字" disabled={value.showHelp === false} />
          </div>
          <label className="mt-1 flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={value.showHelp === false} onChange={(e) => set({ showHelp: e.target.checked ? false : true })} className="accent-[#069e04]" /> 表示しない
          </label>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LANDING_COLOR_FIELDS.map((f) => {
            const current = value.colors?.[f.key] ?? ''
            const shown = colorOf(current, LANDING_DEFAULTS.colors[f.key])
            return (
              <Field key={f.key} label={f.label}>
                <div className="flex items-center gap-2">
                  <input type="color" value={shown} onChange={(e) => setColor(f.key, e.target.value)} aria-label={`${f.label}の色`} className="h-9 w-12 cursor-pointer rounded border border-[#cacace] bg-white p-0.5" />
                  <input value={current} onChange={(e) => setColor(f.key, e.target.value.trim())} placeholder={LANDING_DEFAULTS.colors[f.key]} maxLength={7} aria-label={`${f.label}の色コード`} className={`${inputCls} font-mono`} />
                </div>
              </Field>
            )
          })}
        </div>
        <button type="button" onClick={() => onChange({})} className="h-9 rounded border border-[#cacace] bg-white px-3 text-xs hover:bg-[#f7f7f9]">既定に戻す</button>
      </div>
      <LandingPreview style={value} />
    </div>
  )
}
