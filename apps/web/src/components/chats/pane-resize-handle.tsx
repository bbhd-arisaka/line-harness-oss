'use client'

import { useRef } from 'react'
import { HANDLE_PX, KEY_STEP } from '@/lib/pane-widths'

/**
 * 列と列の境目の「取っ手」。左右にドラッグして、隣の列の横幅を変える。ダブルクリックでもとの幅に戻る。
 * キーボードでも動く(取っ手にフォーカスして、←→)。PC の画面(lg 以上)だけに出す。
 *
 * - grow='right': 取っ手より左の列の幅を変える(右へドラッグすると広がる)
 * - grow='left' : 取っ手より右の列の幅を変える(左へドラッグすると広がる)
 */
export function PaneResizeHandle({
  label,
  grow,
  getWidth,
  onResize,
  onCommit,
  onReset,
  className = '',
}: {
  label: string
  grow: 'right' | 'left'
  /** 動かし始めたときの、いまの幅(画面に出ている実際の幅) */
  getWidth: () => number
  /** ドラッグの最中。ほしい幅を渡す(範囲におさめるのは呼び出し側) */
  onResize: (width: number) => void
  /** ドラッグが終わった(保存のタイミング) */
  onCommit: () => void
  onReset: () => void
  className?: string
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const sign = grow === 'right' ? 1 : -1

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title={`${label}(ドラッグで変更・ダブルクリックでもとに戻す)`}
      style={{ width: HANDLE_PX }}
      className={`group relative hidden shrink-0 cursor-col-resize touch-none select-none focus:outline-none lg:block ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { startX: e.clientX, startWidth: getWidth() }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        onResize(d.startWidth + sign * (e.clientX - d.startX))
      }}
      onPointerUp={(e) => {
        if (!drag.current) return
        drag.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onCommit()
      }}
      onPointerCancel={() => {
        drag.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onCommit()
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const dir = e.key === 'ArrowRight' ? 1 : -1
        onResize(getWidth() + sign * dir * KEY_STEP)
        onCommit()
      }}
    >
      {/* 見える線(普段は細く、さわると太く色が付く) */}
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-200 transition-all group-hover:w-[3px] group-hover:bg-green-400 group-focus-visible:w-[3px] group-focus-visible:bg-green-500 group-active:w-[3px] group-active:bg-green-500" />
    </div>
  )
}
