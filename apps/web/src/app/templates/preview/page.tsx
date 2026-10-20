'use client'

import { useEffect, useState } from 'react'
import LinePreview from '@/components/templates/line-preview'
import { api } from '@/lib/api'
import { previewMessagesOf } from '@/lib/template-message'
import type { PreviewMessage } from '@/lib/template-message'

/** 一覧の「別窓」: テンプレートのプレビューだけを別ウィンドウで見せる */
export default function TemplatePreviewWindow() {
  const [state, setState] = useState<{ name: string; messages: PreviewMessage[] } | 'loading' | 'error'>('loading')
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id')
    if (!id) { setState('error'); return }
    api.tpl
      .item(id)
      .then((r) => {
        if (!r.success) { setState('error'); return }
        document.title = r.data.name
        setState({ name: r.data.name, messages: previewMessagesOf(r.data.messageType, r.data.messageContent) })
      })
      .catch(() => setState('error'))
  }, [])
  if (state === 'loading') return <p className="p-6 text-sm text-[#757578]">読み込み中...</p>
  if (state === 'error') return <p className="p-6 text-sm text-[#e5451f]">テンプレートを読み込めませんでした</p>
  return (
    <main className="mx-auto max-w-sm p-4">
      <h1 className="mb-2 truncate text-sm font-bold text-[#414143]">{state.name}</h1>
      <LinePreview messages={state.messages} className="min-h-[24rem]" />
    </main>
  )
}
