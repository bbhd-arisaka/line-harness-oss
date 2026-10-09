'use client'

import { useState } from 'react'
import { errorText } from '@/lib/error-text'
import { reserveApi } from '@/lib/reserve'
import type { CalendarSection } from '@/lib/reserve'

export const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:bg-gray-50 disabled:text-gray-500';
export const smallInput = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:bg-gray-50 disabled:text-gray-500';
export const pinkBtn = 'rounded-full bg-[#e8355d] px-8 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-200 transition hover:bg-[#d02850] hover:shadow-lg disabled:opacity-60';
export const orangeBtn = 'inline-flex items-center gap-1.5 rounded-lg bg-[#f0ad4e] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#ec9f35]';
export const outlineBtn = 'rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-60';

/** 設定画面の見出し(大) */
export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-5 text-2xl font-bold tracking-tight text-gray-900">{children}</h2>
}

/** 設定の区分(カード) */
export function Block({ title, id, children, hint }: { title: string; id?: string; children: React.ReactNode; hint?: string }) {
  return (
    <section id={id} className="mb-6 scroll-mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white px-5 py-4">
        <h3 className="flex items-center gap-2 text-base font-bold text-gray-900"><span className="h-4 w-1 rounded-full bg-emerald-500" />{title}</h3>
        {hint ? <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{hint}</p> : null}
      </div>
      <div className="divide-y divide-gray-100 px-5">{children}</div>
    </section>
  )
}

/** ラベルと入力の1行 */
export function Row({ label, children, note }: { label: React.ReactNode; children: React.ReactNode; note?: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 py-4 sm:grid-cols-[210px_1fr] sm:gap-6">
      <div className="pt-1.5 text-sm font-semibold text-gray-800">{label}</div>
      <div className="min-w-0 text-sm">
        {children}
        {note ? <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{note}</p> : null}
      </div>
    </div>
  )
}

export function Radio({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <label className={`mr-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${checked ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      <input type="radio" className="accent-emerald-600" checked={checked} onChange={onChange} disabled={disabled} /> {label}
    </label>
  )
}

/** 区分ごとの保存(失敗の理由を、画面に出す) */
export function useSectionSave(calendarId: string, section: CalendarSection, reload: () => void) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const save = async (value: unknown): Promise<boolean> => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await reserveApi.saveSection(calendarId, section, value)
      if (!res.success) throw new Error(res.error)
      setMessage({ ok: true, text: '保存しました' })
      reload()
      return true
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, '保存できませんでした') })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, message, save, setMessage }
}

export function SaveBar({ busy, message, onSave, label = '設定を保存する' }: { busy: boolean; message: { ok: boolean; text: string } | null; onSave: () => void; label?: string }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-2 flex items-center justify-center gap-4 border-t border-gray-200 bg-white/90 px-4 py-3 backdrop-blur">
      <button type="button" className={pinkBtn} disabled={busy} onClick={onSave}>{busy ? '保存中…' : label}</button>
      {message ? <span className={`rounded-full px-3 py-1 text-sm font-medium ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{message.text}</span> : null}
    </div>
  )
}
