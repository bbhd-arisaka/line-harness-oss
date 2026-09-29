'use client'

import type { ReactNode } from 'react'

/**
 * 開閉で高さがなめらかに変わる入れ物。閉じている間は中身に触れないようにする(タブ移動・読み上げの対象外)。
 * `open` を切り替えるだけで、展開・折りたたみのアニメーションが付く。
 */
export function Collapse({ open, children, className = '' }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`collapse ${className}`} data-open={open} aria-hidden={!open} inert={!open}>
      <div className="collapse-inner">{children}</div>
    </div>
  )
}
