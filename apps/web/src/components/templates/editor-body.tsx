'use client'

import { useEffect, useRef, useState } from 'react'
import { EDITOR_TYPE_LABEL, STANDARD_EDITOR_TYPES } from '@line-crm/shared'
import type {
  AudioData, CarouselData, EditorData, EditorType, FlexEditorData, ImageData, LocationData, QuestionData, ReferralData, StickerData, TextData, VideoData,
} from '@line-crm/shared'
import { api } from '@/lib/api'
import type { PreviewMessage } from '@/lib/template-message'
import CarouselEditor from './editors/carousel-editor'
import FlexEditor from './editors/flex-editor'
import ImageEditor from './editors/image-editor'
import LocationEditor from './editors/location-editor'
import { AudioEditor, ReferralEditor, VideoEditor } from './editors/media-editors'
import QuestionEditor from './editors/question-editor'
import StickerEditor from './editors/sticker-editor'
import TextEditor from './editors/text-editor'
import type { EditorEnv } from './editors/types'
import LinePreview from './line-preview'

/** 種類ごとの入力画面(タブの中身) */
export function EditorBody({ type, data, onChange, env }: { type: EditorType; data: EditorData; onChange: (d: EditorData) => void; env: EditorEnv }) {
  const set = onChange as (d: unknown) => void
  switch (type) {
    case 'text': return <TextEditor value={data as TextData} onChange={set} env={env} />
    case 'sticker': return <StickerEditor value={data as StickerData} onChange={set} env={env} />
    case 'image': return <ImageEditor value={data as ImageData} onChange={set} env={env} />
    case 'question': return <QuestionEditor value={data as QuestionData} onChange={set} env={env} />
    case 'carousel': return <CarouselEditor value={data as CarouselData} onChange={set} env={env} />
    case 'location': return <LocationEditor value={data as LocationData} onChange={set} env={env} />
    case 'referral': return <ReferralEditor value={data as ReferralData} onChange={set} env={env} />
    case 'audio': return <AudioEditor value={data as AudioData} onChange={set} env={env} />
    case 'video': return <VideoEditor value={data as VideoData} onChange={set} env={env} />
    case 'flex': return <FlexEditor value={data as FlexEditorData} onChange={set} env={env} />
  }
}

/** 標準メッセージの9種類のタブ */
export function TypeTabs({ value, onSelect }: { value: EditorType; onSelect: (t: EditorType) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-x-1 border-b border-[#cacace]">
      {STANDARD_EDITOR_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={value === t}
          onClick={() => onSelect(t)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm ${value === t ? 'border-[#069e04] font-bold text-[#069e04]' : 'border-transparent text-[#414143] hover:bg-[#f7f7f9]'}`}
        >
          {EDITOR_TYPE_LABEL[t]}
        </button>
      ))}
    </div>
  )
}

/** 入力に合わせて更新する、LINE のトーク画面ふうのプレビュー(サーバーで本番と同じ変換をした結果) */
export function LiveEditorPreview({ type, data, senderId, templateId }: { type: EditorType; data: EditorData; senderId: string | null; templateId?: string }) {
  const [messages, setMessages] = useState<PreviewMessage[]>([])
  const seq = useRef(0)
  const key = JSON.stringify([type, data, senderId])
  useEffect(() => {
    const n = ++seq.current
    const t = setTimeout(() => {
      api.tpl
        .preview({ editorType: type, editorData: data, senderId, templateId })
        .then((r) => { if (r.success && n === seq.current) setMessages(r.data.messages as PreviewMessage[]) })
        .catch(() => {})
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, templateId])
  return <LinePreview messages={messages} className="min-h-[18rem]" />
}
