'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** ポップアップの表示・非表示にかける時間(ms)。CSS の duration と合わせる。 */
export const MODAL_FADE_MS = 220

/**
 * 全画面ポップアップの共通部品。
 * - 背景は暗く(黒55%)+ぼかし
 * - 開くとき/閉じるときは必ずフェード(閉じるアニメーションが終わるまで DOM を残す)
 */
export function Modal({
  open,
  onClose,
  children,
  maxWidthClass = 'max-w-3xl',
  closeOnBackdrop = true,
  align = 'top',
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidthClass?: string
  closeOnBackdrop?: boolean
  align?: 'top' | 'center'
}) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // マウント直後の次フレームで「表示」状態にして、フェードインを効かせる
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), MODAL_FADE_MS)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={`fixed inset-0 z-[70] flex justify-center overflow-y-auto p-4 ${align === 'center' ? 'items-center' : 'items-start pt-12'}`}
      style={{
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        opacity: shown ? 1 : 0,
        transition: `opacity ${MODAL_FADE_MS}ms ease`,
      }}
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose() }}
    >
      <div
        className={`w-full ${maxWidthClass} rounded bg-white shadow-2xl`}
        style={{
          opacity: shown ? 1 : 0,
          transform: shown ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.97)',
          transition: `opacity ${MODAL_FADE_MS}ms ease, transform ${MODAL_FADE_MS}ms ease`,
        }}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
