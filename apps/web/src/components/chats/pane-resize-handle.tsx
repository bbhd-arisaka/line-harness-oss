'use client'

import { useEffect, useRef } from 'react'
import { HANDLE_PX, KEY_STEP } from '@/lib/pane-widths'

/**
 * 列と列の境目の「取っ手」。左右にドラッグして、隣の列の横幅を変える。ダブルクリックでもとの幅に戻る。
 * キーボードでも動く(取っ手にフォーカスして、←→)。PC の画面(lg 以上)だけに出す。
 *
 * - grow='right': 取っ手より左の列の幅を変える(右へドラッグすると広がる)
 * - grow='left' : 取っ手より右の列の幅を変える(左へドラッグすると広がる)
 *
 * 【動きは、取っ手ではなく画面全体(window)で拾う】
 * 取っ手は8pxしかなく、速く動かすと、ポインターが取っ手から外れる。取っ手の上のイベントだけに頼ると、そこで止まってしまう。
 * 押したときに window へ移動・離すのイベントを付け、離したら外す。
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
  const sign = grow === 'right' ? 1 : -1
  // 最新の関数を、window に付けたイベントから呼ぶ(描画のたびに付け替えない)
  const latest = useRef({ getWidth, onResize, onCommit, sign })
  latest.current = { getWidth, onResize, onCommit, sign }
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])

  const start = (clientX: number) => {
    cleanup.current?.()
    const startX = clientX
    const startWidth = latest.current.getWidth()
    const move = (e: PointerEvent) => {
      latest.current.onResize(startWidth + latest.current.sign * (e.clientX - startX))
    }
    const end = () => {
      cleanup.current?.()
      latest.current.onCommit()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    cleanup.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      cleanup.current = null
    }
  }

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
        e.preventDefault()
        start(e.clientX)
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
