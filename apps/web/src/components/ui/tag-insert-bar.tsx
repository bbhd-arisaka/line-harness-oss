'use client'

import type { RefObject } from 'react'
import { splitTags, variableChipClass } from '@/lib/form-tags'
import type { TagTextEditorHandle } from '@/components/ui/tag-text-editor'

/**
 * 入力欄の下に並べる「差し込み語」のボタン。押すと、いまのカーソルの位置に枠として入る。
 * ボタンの色は、入力欄の中の枠と同じ（種類ごとに色を分けている）。
 */
export function TagInsertBar({
  editorRef,
  tags,
}: {
  editorRef: RefObject<TagTextEditorHandle | null>
  /** code は {{name}} の形、label は画面に出す名前 */
  tags: { code: string; label: string }[]
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-gray-500">差し込み(押すと入ります):</span>
      {tags.map((t) => {
        const p = splitTags(t.code)[0]
        const key = p && 'variable' in p ? p.variable : ''
        return (
          <button
            key={t.code}
            type="button"
            // ボタンを押しても、入力欄のカーソル位置を失わない
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editorRef.current?.insertTag(t.code)}
            className={`${variableChipClass(key)} cursor-pointer hover:brightness-95`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
