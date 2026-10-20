'use client'

import { useState } from 'react'
import { STICKER_PACKAGES, stickerIdsOf, stickerImageUrl } from '@line-crm/shared'
import type { StickerData } from '@line-crm/shared'
import type { TabProps } from './types'

/** スタンプ: 左にスタンプセットの縦リスト、右にそのセットのスタンプ。押すと選択 */
export default function StickerEditor({ value, onChange }: TabProps<StickerData>) {
  const initial = STICKER_PACKAGES.find((p) => p.packageId === value.packageId) ?? STICKER_PACKAGES[0]
  const [pkgId, setPkgId] = useState(initial.packageId)
  const pkg = STICKER_PACKAGES.find((p) => p.packageId === pkgId) ?? STICKER_PACKAGES[0]
  return (
    <div className="grid min-h-[22rem] gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="max-h-[26rem] overflow-y-auto rounded border border-[#e3e3e6] bg-[#f7f7f9]">
        {STICKER_PACKAGES.map((p) => (
          <button
            key={p.packageId}
            type="button"
            onClick={() => setPkgId(p.packageId)}
            className={`flex w-full items-center gap-2 border-b border-[#e3e3e6] px-3 py-2 text-left text-xs ${p.packageId === pkgId ? 'bg-[#e3f1e3] font-bold' : 'hover:bg-white'}`}
          >
            <img src={stickerImageUrl(String(p.firstId))} alt="" className="h-9 w-9 flex-shrink-0 object-contain" loading="lazy" />
            <span className="min-w-0 flex-1 break-words">{p.title}</span>
          </button>
        ))}
      </div>
      <div className="max-h-[26rem] overflow-y-auto rounded border border-[#e3e3e6] p-3">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {stickerIdsOf(pkg).map((id) => {
            const on = value.packageId === pkg.packageId && value.stickerId === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange({ packageId: pkg.packageId, stickerId: id })}
                className={`rounded border p-1 ${on ? 'border-2 border-[#069e04] bg-[#f3fbf3]' : 'border-transparent hover:bg-[#f7f7f9]'}`}
                aria-label={`スタンプ ${id}`}
                aria-pressed={on}
              >
                <img src={stickerImageUrl(id)} alt="" className="h-16 w-16 object-contain" loading="lazy" />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
