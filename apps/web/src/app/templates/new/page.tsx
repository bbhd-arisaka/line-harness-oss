'use client'

import { useEffect, useState } from 'react'
import TemplateEditor from '@/components/templates/template-editor'

/** 新しいテンプレート。?kind=standard|flex ・ ?folder=フォルダID ・ ?draft=下書きID */
export default function NewTemplatePage() {
  const [params, setParams] = useState<{ kind: 'standard' | 'flex'; folder: string | null; draft: string | null } | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setParams({ kind: q.get('kind') === 'flex' ? 'flex' : 'standard', folder: q.get('folder') || null, draft: q.get('draft') })
  }, [])
  if (!params) return null
  return (
    <main className="mx-auto max-w-7xl p-6">
      <TemplateEditor key={`${params.kind}-${params.draft}`} mode="new" kind={params.kind} initialFolder={params.folder} draftId={params.draft} />
    </main>
  )
}
