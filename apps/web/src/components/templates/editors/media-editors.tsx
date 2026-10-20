'use client'

import { useState } from 'react'
import type { AudioData, ReferralData, VideoData } from '@line-crm/shared'
import MediaDialog from '../media-dialog'
import MessageField from '../message-field'
import UrlSettingsSection from '../url-settings'
import { btnLine, fieldCls } from './types'
import type { TabProps } from './types'

const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 音声: m4a。長さ(ミリ秒)はブラウザで読み取る */
export function AudioEditor({ value, onChange }: TabProps<AudioData>) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-bold">
        音声をアップロード、または選択する <span className="rounded-sm bg-[#e5451f] px-1 py-0.5 text-[10px] text-white">必須</span>
      </div>
      <button type="button" onClick={() => setOpen(true)} className={btnLine}>音声を選択する</button>
      {value.url ? (
        <div className="max-w-md space-y-1 rounded border border-[#e3e3e6] p-3 text-xs">
          <div className="font-bold">{value.name || '選択した音声'}{value.durationMs ? `(${fmtDuration(value.durationMs)})` : ''}</div>
          <audio controls src={value.url} className="w-full" />
        </div>
      ) : null}
      <MediaDialog open={open} kind="audio" onClose={() => setOpen(false)} onPick={(m) => { onChange({ url: m.url, durationMs: m.durationMs ?? value.durationMs ?? 1000, name: m.name }); setOpen(false) }} />
    </div>
  )
}

/** 動画: mp4 と、サムネイル(プレビュー画像)の2つを選ぶ */
export function VideoEditor({ value, onChange }: TabProps<VideoData>) {
  const [open, setOpen] = useState<null | 'video' | 'preview'>(null)
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-xs font-bold">
          動画をアップロード、または選択する <span className="rounded-sm bg-[#e5451f] px-1 py-0.5 text-[10px] text-white">必須</span>
        </div>
        <button type="button" onClick={() => setOpen('video')} className={btnLine}>動画を選択する</button>
        {value.url ? <video controls src={value.url} poster={value.previewUrl || undefined} className="mt-3 max-h-64 rounded border border-[#e3e3e6]" /> : null}
      </div>
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-xs font-bold">
          サムネイル <span className="rounded-sm bg-[#e5451f] px-1 py-0.5 text-[10px] text-white">必須</span>
        </div>
        <div className="flex items-center gap-3">
          {value.previewUrl ? <img src={value.previewUrl} alt="" className="h-20 rounded border border-[#cacace] object-cover" /> : null}
          <button type="button" onClick={() => setOpen('preview')} className={btnLine}>画像を選択する</button>
        </div>
      </div>
      <MediaDialog open={open === 'video'} kind="video" onClose={() => setOpen(null)} onPick={(m) => { onChange({ ...value, url: m.url, name: m.name }); setOpen(null) }} />
      <MediaDialog open={open === 'preview'} kind="image" onClose={() => setOpen(null)} onPick={(m) => { onChange({ ...value, previewUrl: m.url }); setOpen(null) }} />
    </div>
  )
}

/** 友だち紹介: 紹介文と、紹介するLINE公式アカウントのID(@xxxx)。詳細設定ONでURL設定も */
export function ReferralEditor({ value, onChange, env }: TabProps<ReferralData>) {
  return (
    <div className="space-y-5">
      <MessageField
        label="紹介文"
        required
        badges={['短縮URL対応']}
        value={value.text}
        onChange={(text) => onChange({ ...value, text })}
        maxLength={1000}
        rows={6}
        toolbar={['name', 'friend', 'emoji']}
      />
      <label className="block text-xs">
        <span className="mb-1 flex items-center gap-1.5 font-bold">
          紹介するLINEアカウントID <span className="rounded-sm bg-[#e5451f] px-1 py-0.5 text-[10px] text-white">必須</span>
        </span>
        <input value={value.accountId} onChange={(e) => onChange({ ...value, accountId: e.target.value })} placeholder="@abc1234x" className={fieldCls} aria-label="紹介するLINEアカウントID" />
      </label>
      <label className="flex items-center gap-1.5 text-xs font-bold">
        <input type="checkbox" checked={!!value.detail} onChange={(e) => onChange({ ...value, detail: e.target.checked })} className="accent-[#069e04]" />
        詳細設定
      </label>
      {value.detail ? (
        <UrlSettingsSection value={value.urlSettings} onChange={(urlSettings) => onChange({ ...value, urlSettings })} sourceText={() => value.text} lookups={env.lookups} accountId={env.accountId} />
      ) : null}
    </div>
  )
}
