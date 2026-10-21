'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { getApiBase } from '@/lib/api-base'
import { blocksToApi, draftToPreviewFormDef, type FormDraft } from './editor-types'

/**
 * 右側のフォームのプレビュー。お客様が見る本番のフォームの画面そのものを、埋め込んで表示する
 * (別に作った見た目の真似ではないので、本番と必ず同じになる)。
 * 編集のたびに、編集中の内容を本番の画面へ送って描き直す。項目をクリックすると、左でその項目が選ばれる。
 */
export function PreviewFrame({
  draft,
  section,
  selectedRowId,
  onSelect,
}: {
  draft: FormDraft
  section: number
  selectedRowId: number | null
  onSelect: (rowId: number) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const origin = useMemo(() => {
    const base = getApiBase()
    return base ? new URL(base, window.location.href).origin : null
  }, [])

  // 項目の名前(本番の画面が付けているもの) ⇔ 編集中のブロック
  const names = useMemo(() => {
    const sorted = [...draft.blocks].sort((a, b) => a.section - b.section)
    const api = blocksToApi(draft.blocks)
    const byRow = new Map<number, string>()
    const byName = new Map<string, number>()
    sorted.forEach((b, i) => {
      const name = api[i]?.name
      if (!name) return
      byRow.set(b.rowId, name)
      byName.set(name, b.rowId)
    })
    return { byRow, byName }
  }, [draft.blocks])

  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect })
  const byNameRef = useRef(names.byName)
  useEffect(() => { byNameRef.current = names.byName })

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!origin || e.origin !== origin || e.source !== frame.current?.contentWindow) return
      const data = e.data as { type?: string; name?: string } | null
      if (data?.type === 'form-preview-ready') setReady(true)
      if (data?.type === 'form-preview-select' && data.name) {
        const rowId = byNameRef.current.get(data.name)
        if (rowId !== undefined) onSelectRef.current(rowId)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin])

  const selectedName = selectedRowId === null ? null : names.byRow.get(selectedRowId) ?? null
  useEffect(() => {
    if (!ready || !origin) return
    const t = setTimeout(() => {
      frame.current?.contentWindow?.postMessage(
        { type: 'form-preview', formDef: draftToPreviewFormDef(draft), sectionIndex: Math.max(0, section - 1), selectedName },
        origin,
      )
    }, 120)
    return () => clearTimeout(t)
  }, [ready, origin, draft, section, selectedName])

  if (!origin) {
    return <p className="p-4 text-xs text-[#757578]">プレビューの表示先(API)が設定されていません</p>
  }
  return (
    <iframe
      ref={frame}
      title="フォームのプレビュー"
      src={`${origin}/?page=form&preview=1&embed=1`}
      className="h-full w-full border-0 bg-[#f5f5f5]"
    />
  )
}
