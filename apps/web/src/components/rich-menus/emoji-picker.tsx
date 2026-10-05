'use client'

import { useState } from 'react'
import { EMOJI_GROUPS } from '@/lib/emoji-data'

/** 絵文字ピッカー(Lステップの「絵文字」ボタンと同じ使い方)。選んだ絵文字を onPick に渡す。 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [groupId, setGroupId] = useState(EMOJI_GROUPS[0].id)
  const group = EMOJI_GROUPS.find((g) => g.id === groupId) ?? EMOJI_GROUPS[0]
  return (
    <div className="mt-1 rounded border border-gray-300 bg-white" role="group" aria-label="絵文字を選ぶ">
      <div className="flex flex-wrap gap-0.5 border-b border-gray-200 p-1">
        {EMOJI_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            title={g.label}
            aria-label={g.label}
            aria-pressed={g.id === groupId}
            onClick={() => setGroupId(g.id)}
            className={`rounded px-1.5 py-0.5 text-base leading-none ${g.id === groupId ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
          >
            {g.icon}
          </button>
        ))}
      </div>
      <div className="max-h-40 overflow-y-auto p-1">
        <div className="mb-0.5 px-1 text-[11px] text-gray-500">{group.label}</div>
        <div className="grid grid-cols-8 gap-0.5">
          {group.emojis.map((e, i) => (
            <button
              key={`${e}-${i}`}
              type="button"
              onClick={() => onPick(e)}
              className="rounded py-0.5 text-lg leading-none hover:bg-gray-100"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
