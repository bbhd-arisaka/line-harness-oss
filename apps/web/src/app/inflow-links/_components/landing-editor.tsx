'use client'

import { useEffect, useRef, useState } from 'react'
import ImageUploader from '@/components/shared/image-uploader'
import { api } from '@/lib/api'
import { LANDING_COLOR_FIELDS, LANDING_DEFAULTS, LANDING_PRESETS, LANDING_SLIDERS, applyLandingPreset } from '@/lib/inflow-routes'
import type { LandingColors, LandingStyle } from '@/lib/inflow-routes'

const HEX = /^#[0-9a-fA-F]{6}$/
const inputCls = 'h-9 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04] disabled:bg-[#f7f7f9] disabled:text-[#757578]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold">{label}</label>
      {children}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-[#e3e3e6] pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-bold text-[#757578]">{title}</h3>
      {children}
    </section>
  )
}

function ColorRow({ k, label, value, onSet }: { k: keyof LandingColors; label: string; value: LandingStyle; onSet: (key: keyof LandingColors, v: string) => void }) {
  const current = value.colors?.[k] ?? ''
  const shown = colorOf(current, LANDING_DEFAULTS.colors[k])
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={shown} onChange={(e) => onSet(k, e.target.value)} aria-label={`${label}の色`} className="h-9 w-12 cursor-pointer rounded border border-[#cacace] bg-white p-0.5" />
        <input value={current} onChange={(e) => onSet(k, e.target.value.trim())} placeholder={LANDING_DEFAULTS.colors[k]} maxLength={7} aria-label={`${label}の色コード`} className={`${inputCls} font-mono`} />
      </div>
    </Field>
  )
}

function colorOf(v: string | null | undefined, d: string): string {
  return typeof v === 'string' && HEX.test(v) ? v : d
}

/** 友だち追加ページのプレビュー。実際のページと同じ HTML(サーバーで作る)を、枠の中に出す。編集するたびに、すぐ更新される */
export function LandingPreviewFrame({ style, openUrl }: { style: LandingStyle; openUrl?: string }) {
  const [kind, setKind] = useState<'mobile' | 'pc'>('mobile')
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    const t = setTimeout(async () => {
      try {
        const res = await api.inflow.landingPreview(style, kind, openUrl?.replace(/&preview=1$/, ''))
        if (mine !== seq.current) return
        if (res.success) {
          setHtml(res.data.html)
          setError('')
        }
      } catch (e) {
        if (mine !== seq.current) return
        // 入力の途中(色コードが途中など)は、直前のプレビューを残して、理由だけ出す
        setError(e instanceof Error && e.message && !/^API error/.test(e.message) ? e.message : '')
      }
    }, 350)
    return () => clearTimeout(t)
  }, [style, kind, openUrl])

  return (
    <div className="lg:sticky lg:top-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded border border-[#cacace] text-xs">
          {(['mobile', 'pc'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`px-3 py-1.5 ${kind === k ? 'bg-[#069e04] font-bold text-white' : 'bg-white hover:bg-[#f7f7f9]'}`}>
              {k === 'mobile' ? 'スマホ' : 'パソコン'}
            </button>
          ))}
        </div>
        {openUrl ? (
          <a href={openUrl} target="_blank" rel="noreferrer" className="text-xs text-[#2b7bb9] underline">実際のページを開く</a>
        ) : null}
      </div>
      <div
        className={`mx-auto overflow-hidden border border-[#cacace] bg-white shadow-sm ${kind === 'mobile' ? 'w-[300px] rounded-[28px] border-[6px] border-[#2b2b2e]' : 'w-full rounded-lg'}`}
        style={{ height: kind === 'mobile' ? 560 : 420 }}
      >
        <iframe title="友だち追加ページのプレビュー" srcDoc={html} sandbox="" className="h-full w-full border-0" />
      </div>
      {error ? <p className="mt-2 text-xs text-[#e5451f]">{error}</p> : null}
    </div>
  )
}

/** 友だち追加ページの、文言・配色・背景画像・透過・角丸の編集(左: 入力、右: プレビュー)。空にすると、既定に戻る */
export default function LandingEditor({ value, onChange, openUrl }: { value: LandingStyle; onChange: (v: LandingStyle) => void; openUrl?: string }) {
  const set = (patch: Partial<LandingStyle>) => onChange({ ...value, ...patch })
  const setColor = (key: keyof LandingColors, v: string) => onChange({ ...value, colors: { ...(value.colors ?? {}), [key]: v || null } })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        <Group title="デザインのひな形">
          <div className="flex flex-wrap gap-2">
            {LANDING_PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => onChange(applyLandingPreset(value, p.id))} className="h-9 rounded border border-[#cacace] bg-white px-3 text-xs font-bold hover:bg-[#f7f7f9]">
                {p.label}
              </button>
            ))}
          </div>
        </Group>

        <Group title="文言">
          <Field label="見出し">
            <input value={value.title ?? ''} onChange={(e) => set({ title: e.target.value })} maxLength={60} placeholder={LANDING_DEFAULTS.title} className={inputCls} aria-label="見出し" />
          </Field>
          <Field label="見出しの下の説明">
            <input value={value.subtitle ?? ''} onChange={(e) => set({ subtitle: e.target.value })} maxLength={120} className={inputCls} aria-label="見出しの下の説明" />
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
          <Field label="パソコンで開いたときの見出し">
            <input value={value.pcTitle ?? ''} onChange={(e) => set({ pcTitle: e.target.value })} maxLength={60} placeholder={LANDING_DEFAULTS.pcTitle} className={inputCls} aria-label="パソコンで開いたときの見出し" />
          </Field>
        </Group>

        <Group title="背景画像">
          <ImageUploader
            mode="url"
            label="背景画像"
            value={value.bgImageUrl ? { mode: 'url', url: value.bgImageUrl } : null}
            onChange={(v) => set({ bgImageUrl: v && v.mode === 'url' ? v.url : null })}
          />
        </Group>

        <Group title="色">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {LANDING_COLOR_FIELDS.map((f) => <ColorRow key={f.key} k={f.key} label={f.label} value={value} onSet={setColor} />)}
            <ColorRow k="overlay" label="背景画像にかぶせる色" value={value} onSet={setColor} />
          </div>
        </Group>

        <Group title="透過・ぼかし・角の丸み">
          <div className="space-y-3">
            {LANDING_SLIDERS.map((sl) => {
              const v = value[sl.key] ?? LANDING_DEFAULTS[sl.key]
              return (
                <Field key={sl.key} label={`${sl.label}　${v}${sl.unit}`}>
                  <input
                    type="range"
                    min={sl.min}
                    max={sl.max}
                    step={1}
                    value={v}
                    onChange={(e) => set({ [sl.key]: Number(e.target.value) } as Partial<LandingStyle>)}
                    aria-label={sl.label}
                    className="w-full accent-[#069e04]"
                  />
                </Field>
              )
            })}
          </div>
        </Group>

        <Group title="アイコン">
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={value.showIcon === false} onChange={(e) => set({ showIcon: e.target.checked ? false : true })} className="accent-[#069e04]" /> 表示しない
          </label>
          {value.showIcon === false ? null : (
            <ImageUploader
              mode="url"
              label="自分の画像にする"
              value={value.iconUrl ? { mode: 'url', url: value.iconUrl } : null}
              onChange={(v) => set({ iconUrl: v && v.mode === 'url' ? v.url : null })}
            />
          )}
        </Group>

        <button type="button" onClick={() => onChange({})} className="h-9 rounded border border-[#cacace] bg-white px-3 text-xs hover:bg-[#f7f7f9]">すべて既定に戻す</button>
      </div>
      <LandingPreviewFrame style={value} openUrl={openUrl} />
    </div>
  )
}
