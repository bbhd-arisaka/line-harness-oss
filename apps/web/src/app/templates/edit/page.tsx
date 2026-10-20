'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import TemplateEditor from '@/components/templates/template-editor'
import { api } from '@/lib/api'

/** テンプレートの編集。?id=テンプレートID(種類は読み込んだ内容で決まる) */
export default function EditTemplatePage() {
  const router = useRouter()
  const [state, setState] = useState<{ id: string; kind: 'standard' | 'flex' } | null>(null)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id')
    if (!id) return
    api.tpl
      .item(id)
      .then((r) => {
        if (!r.success) return
        if (r.data.kind === 'pack') router.replace(`/templates/pack?id=${id}`)
        else setState({ id, kind: r.data.kind === 'flex' ? 'flex' : 'standard' })
      })
      .catch(() => {})
  }, [router])
  if (!state) return <p className="p-6 text-sm text-[#757578]">読み込み中...</p>
  return (
    <main className="mx-auto max-w-7xl p-6">
      <TemplateEditor key={state.id} mode="edit" id={state.id} kind={state.kind} />
    </main>
  )
}
