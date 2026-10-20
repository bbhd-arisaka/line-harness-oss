'use client'

import { stickerImageUrl } from '@line-crm/shared'
import FlexPreviewComponent from '@/components/flex-preview'
import { TaggedText } from '@/components/forms/tagged-text'
import type { PreviewMessage } from '@/lib/template-message'

/** LINE のトーク画面の色(青みのある背景) */
const CHAT_BG = '#8ca0d0'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function Bubble({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[16rem] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[13px] leading-5 text-[#222]">{children}</div>
}

function ConfirmButtons({ actions }: { actions: Array<Record<string, unknown>> }) {
  return (
    <div className="mt-2 flex divide-x divide-[#e5e5e5] overflow-hidden rounded-lg border border-[#e5e5e5] text-center text-[13px] text-[#06c755]">
      {actions.map((a, i) => (
        <div key={i} className="flex-1 truncate px-2 py-2">
          {str(a.label)}
        </div>
      ))}
    </div>
  )
}

function OneMessage({ m }: { m: PreviewMessage }) {
  if (m.type === 'text') {
    return (
      <Bubble>
        <TaggedText text={str(m.text)} />
      </Bubble>
    )
  }
  if (m.type === 'sticker') {
    const id = str(m.stickerId)
    return id ? <img src={stickerImageUrl(id)} alt="スタンプ" className="h-28 w-28 object-contain" /> : null
  }
  if (m.type === 'image') {
    const url = str(m.originalContentUrl) || str(m.previewImageUrl)
    return url ? <img src={url} alt="画像" className="max-h-72 max-w-[16rem] rounded-lg object-contain" /> : <div className="rounded-lg bg-white/70 px-4 py-8 text-xs text-[#757578]">画像が選択されていません</div>
  }
  if (m.type === 'imagemap') {
    const size = (m.baseSize ?? { width: 1040, height: 1040 }) as { width: number; height: number }
    const actions = (Array.isArray(m.actions) ? m.actions : []) as Array<Record<string, unknown>>
    return (
      <div className="relative w-64 overflow-hidden rounded-lg bg-white" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
        <img src={`${str(m.baseUrl)}/1040`} alt="画像" className="h-full w-full object-cover" />
        {actions.map((a, i) => {
          const area = a.area as { x: number; y: number; width: number; height: number }
          return (
            <div
              key={i}
              className="absolute flex items-center justify-center border border-white/70 bg-sky-500/20 text-[11px] font-bold text-white"
              style={{ left: `${(area.x / size.width) * 100}%`, top: `${(area.y / size.height) * 100}%`, width: `${(area.width / size.width) * 100}%`, height: `${(area.height / size.height) * 100}%` }}
            >
              {['A', 'B', 'C', 'D', 'E', 'F'][i] ?? i + 1}
            </div>
          )
        })}
      </div>
    )
  }
  if (m.type === 'location') {
    return (
      <div className="w-64 overflow-hidden rounded-lg bg-white text-[13px]">
        <div className="flex h-24 items-center justify-center bg-[#e8f0e0] text-2xl">📍</div>
        <div className="px-3 py-2">
          <div className="font-bold">{str(m.title)}</div>
          <div className="text-xs text-[#757578]">{str(m.address)}</div>
        </div>
      </div>
    )
  }
  if (m.type === 'audio') {
    const sec = Math.round(Number(m.duration ?? 0) / 1000)
    return (
      <div className="flex w-40 items-center gap-2 rounded-2xl bg-white px-3 py-2 text-[13px]">
        <span>🎤</span>
        <span className="flex-1 border-t-2 border-dashed border-[#bbb]" />
        <span className="text-xs text-[#757578]">{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</span>
      </div>
    )
  }
  if (m.type === 'video') {
    const url = str(m.previewImageUrl)
    return (
      <div className="relative w-64 overflow-hidden rounded-lg bg-black" style={{ aspectRatio: '16 / 9' }}>
        {url ? <img src={url} alt="動画" className="h-full w-full object-cover" /> : null}
        <div className="absolute inset-0 flex items-center justify-center text-4xl text-white/90">▶</div>
      </div>
    )
  }
  if (m.type === 'template') {
    const t = m.template as { type?: string; text?: string; actions?: Array<Record<string, unknown>> }
    return (
      <div className="w-64 rounded-2xl bg-white px-3 py-3 text-[13px] leading-5">
        <div className="whitespace-pre-wrap break-words">
          <TaggedText text={str(t?.text)} />
        </div>
        <ConfirmButtons actions={t?.actions ?? []} />
      </div>
    )
  }
  if (m.type === 'flex') {
    const contents = typeof m.contents === 'string' ? m.contents : JSON.stringify(m.contents)
    return (
      <div className="max-w-full">
        <FlexPreviewComponent content={contents} maxWidth={240} />
      </div>
    )
  }
  return <Bubble>{`[${m.type}]`}</Bubble>
}

/** LINE のトーク画面のように、メッセージを上から並べて見せる(テンプレートのプレビュー用) */
export default function LinePreview({ messages, className = '' }: { messages: PreviewMessage[]; className?: string }) {
  return (
    <div className={`rounded-lg p-3 ${className}`} style={{ background: CHAT_BG }}>
      <div className="flex flex-col items-start gap-2">
        {messages.length === 0 ? <div className="rounded-lg bg-white/60 px-3 py-6 text-xs text-[#757578]">メッセージがありません</div> : null}
        {messages.map((m, i) => (
          <OneMessage key={i} m={m} />
        ))}
      </div>
    </div>
  )
}
