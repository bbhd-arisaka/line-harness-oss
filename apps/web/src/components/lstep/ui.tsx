'use client'

import { useEffect, useRef, useState } from 'react'

// Lステップ風の一覧画面(友だち情報欄・回答フォーム等)で共通に使う小さな部品。

/** クリックした外側を押したら閉じる小さなポップオーバー用フック。 */
export function useDismiss(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onDismiss])
  return ref
}

/** ⋮メニュー等の小さなポップオーバー。開閉時に必ずフェード(閉じるときも消える前にフェードアウトする)。 */
export function Popover({
  open,
  onClose,
  children,
  align = 'right',
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 160)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  if (!mounted) return null
  return (
    <div
      ref={ref}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(-4px)',
        transition: 'opacity 160ms ease, transform 160ms ease',
        pointerEvents: shown ? 'auto' : 'none',
      }}
      className={`absolute top-full z-30 mt-1 min-w-[9rem] rounded border border-[#cacace] bg-white py-1 text-sm shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      {children}
    </div>
  )
}

export const DragHandle = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" className="flex-shrink-0 cursor-grab text-[#b5b5b9]" aria-hidden="true">
    {[2, 7, 12].map((y) => (
      <g key={y}>
        <circle cx="2" cy={y} r="1.2" fill="currentColor" />
        <circle cx="8" cy={y} r="1.2" fill="currentColor" />
      </g>
    ))}
  </svg>
)

export const FolderIcon = ({ open, className = '' }: { open?: boolean; className?: string }) => (
  <svg width="14" height="12" viewBox="0 0 14 12" className={`flex-shrink-0 ${className}`} aria-hidden="true">
    <path
      d={open ? 'M0 2a1 1 0 011-1h4l1.5 1.5H13a1 1 0 011 1V4H3L0 10V2zm3 3h11l-2.6 6H0.6L3 5z' : 'M0 1.5A1 1 0 011 .5h4l1.5 1.5H13a1 1 0 011 1V10a1 1 0 01-1 1H1a1 1 0 01-1-1V1.5z'}
      fill="currentColor"
    />
  </svg>
)

export const Star = ({ filled }: { filled: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.5 6 20.9l1.3-6.7-5-4.7 6.8-.8L12 2.5z"
      fill={filled ? '#f2b400' : 'none'}
      stroke={filled ? '#f2b400' : '#8a8a8e'}
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
)

export const btnBase = 'inline-flex h-9 items-center justify-center gap-1 rounded px-3 text-xs font-bold'
export const btnWhite = `${btnBase} border border-[#cacace] bg-white text-[#414143] hover:bg-[#f7f7f9]`
export const btnGreen = `${btnBase} bg-[#069e04] text-white hover:bg-[#058503]`

export function FolderRow({
  label,
  count,
  selected,
  draggable,
  onSelect,
  onDragStart,
  onDrop,
  menu,
}: {
  label: string
  count: number
  selected: boolean
  draggable?: boolean
  onSelect: () => void
  onDragStart?: () => void
  onDrop?: () => void
  menu?: React.ReactNode
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => { if (draggable) e.preventDefault() }}
      onDrop={onDrop}
      onClick={onSelect}
      className={`flex min-h-10 cursor-pointer items-center gap-2 px-3 py-1.5 ${selected ? 'bg-[#ffeccb]' : 'hover:bg-[#e8e8ec]'}`}
    >
      {draggable ? <DragHandle /> : <span className="w-[10px] flex-shrink-0" />}
      <FolderIcon open={selected} className={selected ? 'text-[#f2a100]' : 'text-[#9a9a9e]'} />
      <span className="min-w-0 flex-1 break-words leading-tight">{label}</span>
      {menu ?? <span className="flex-shrink-0 text-xs text-[#757578]">{count}</span>}
    </div>
  )
}
