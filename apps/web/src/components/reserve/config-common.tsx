'use client'

import { useState } from 'react'
import { errorText } from '@/lib/error-text'
import { reserveApi } from '@/lib/reserve'
import type { CalendarSection } from '@/lib/reserve'

export const inputCls = 'w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm'
export const smallInput = 'rounded border border-gray-300 bg-white px-2 py-1.5 text-sm'
export const pinkBtn = 'rounded-full bg-[#e8355d] px-8 py-2.5 text-sm font-medium text-white shadow hover:bg-[#d02850] disabled:opacity-60'
export const orangeBtn = 'inline-flex items-center gap-1.5 rounded bg-[#f0ad4e] px-3 py-2 text-sm font-medium text-white hover:bg-[#ec9f35]'
export const outlineBtn = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60'

/** 設定画面の見出し(大) */
export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-6 text-xl font-semibold text-gray-900">{children}</h2>
}

/** 設定の区分(中見出し) */
export function Block({ title, id, children, hint }: { title: string; id?: string; children: React.ReactNode; hint?: string }) {
  return (
    <section id={id} className="mb-10 scroll-mt-4">
      <h3 className="mb-3 text-base font-semibold text-gray-900">{title}</h3>
      {hint ? <p className="mb-3 text-xs text-gray-500">{hint}</p> : null}
      <div className="divide-y divide-gray-200 border-y border-gray-200">{children}</div>
    </section>
  )
}

/** ラベルと入力の1行 */
export function Row({ label, children, note }: { label: React.ReactNode; children: React.ReactNode; note?: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[210px_1fr] sm:gap-4">
      <div className="pt-1.5 text-sm font-semibold text-gray-800">{label}</div>
      <div className="min-w-0 text-sm">
        {children}
        {note ? <p className="mt-1 text-xs text-gray-500">{note}</p> : null}
      </div>
    </div>
  )
}

export function Radio({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <label className={`mr-5 inline-flex items-center gap-1.5 ${disabled ? 'opacity-50' : ''}`}>
      <input type="radio" checked={checked} onChange={onChange} disabled={disabled} /> {label}
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
    <div className="sticky bottom-4 z-10 mt-6 flex items-center justify-center gap-4">
      <button type="button" className={pinkBtn} disabled={busy} onClick={onSave}>{busy ? '保存中…' : label}</button>
      {message ? <span className={`rounded bg-white px-3 py-1 text-sm shadow ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</span> : null}
    </div>
  )
}
