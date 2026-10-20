'use client'

import { useState } from 'react'
import type { CarouselData, CarouselPanel, TapLimit } from '@line-crm/shared'
import ActionSettingsModal from '@/components/friend-add/action-settings-modal'
import type { FriendAddActionItem } from '@/lib/friend-add-actions'
import MediaDialog from '../media-dialog'
import MessageField from '../message-field'
import UrlSettingsSection from '../url-settings'
import ChoiceEditor, { emptyChoice } from './choice-editor'
import { btnLine, fieldCls } from './types'
import type { TabProps } from './types'

const TAP_LIMITS: Array<{ id: TapLimit; label: string }> = [
  { id: 'none', label: '制限しない' },
  { id: 'carousel_once', label: 'カルーセル全体で1回のみタップ可能' },
  { id: 'panel_once', label: 'パネルごとに1回のみタップ可能' },
  { id: 'choice_once', label: '選択肢ごとに1回のみタップ可能' },
]

export const emptyPanel = (): CarouselPanel => ({ title: '', text: '', imageUrl: '', choices: [emptyChoice()] })

/** カルーセル: パネル(最大10)を並べ、パネルごとに 画像・タイトル(40)・本文(60/120)・選択肢(最大4)。タップ回数の制限つき */
export default function CarouselEditor({ value, onChange, env }: TabProps<CarouselData>) {
  const [active, setActive] = useState(0)
  const [picker, setPicker] = useState(false)
  const [actionOpen, setActionOpen] = useState(false)
  const idx = Math.min(active, value.panels.length - 1)
  const panel = value.panels[idx]
  const hasImage = value.panels.some((p) => p.imageUrl)
  const setPanel = (patch: Partial<CarouselPanel>) => onChange({ ...value, panels: value.panels.map((p, i) => (i === idx ? { ...p, ...patch } : p)) })
  const limited = (value.tapLimit ?? 'none') !== 'none'
  const bodyMax = value.panels.some((p) => p.imageUrl || p.title) ? 60 : 120

  const addPanel = () => {
    if (value.panels.length >= 10) return
    onChange({ ...value, panels: [...value.panels, emptyPanel()] })
    setActive(value.panels.length)
  }
  const copyPanel = () => {
    if (value.panels.length >= 10) return
    const next = [...value.panels]
    next.splice(idx + 1, 0, JSON.parse(JSON.stringify(panel)) as CarouselPanel)
    onChange({ ...value, panels: next })
    setActive(idx + 1)
  }
  const removePanel = () => {
    if (value.panels.length <= 1) return
    onChange({ ...value, panels: value.panels.filter((_, i) => i !== idx) })
    setActive(Math.max(0, idx - 1))
  }
  const movePanel = (to: number) => {
    if (to < 0 || to >= value.panels.length) return
    const next = [...value.panels]
    const [p] = next.splice(idx, 1)
    next.splice(to, 0, p)
    onChange({ ...value, panels: next })
    setActive(to)
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {value.panels.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className={`h-9 rounded border px-4 text-xs font-bold ${i === idx ? 'border-[#069e04] bg-[#069e04] text-white' : 'border-[#cacace] bg-white hover:bg-[#f7f7f9]'}`}
            >
              パネル#{i + 1}
            </button>
          ))}
          <button type="button" disabled={value.panels.length >= 10} onClick={addPanel} className={`${btnLine} disabled:border-[#cacace] disabled:text-[#9a9a9e]`}>＋ パネルを追加</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={() => movePanel(idx - 1)} disabled={idx === 0} className="h-8 rounded border border-[#cacace] px-3 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">← 前へ</button>
          <button type="button" onClick={() => movePanel(idx + 1)} disabled={idx === value.panels.length - 1} className="h-8 rounded border border-[#cacace] px-3 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">後ろへ →</button>
          <button type="button" onClick={copyPanel} disabled={value.panels.length >= 10} className="h-8 rounded border border-[#cacace] px-3 hover:bg-[#f7f7f9] disabled:text-[#9a9a9e]">パネルをコピー</button>
          <button type="button" onClick={removePanel} disabled={value.panels.length <= 1} className="h-8 rounded border border-[#e5451f] px-3 text-[#e5451f] hover:bg-[#fff5f3] disabled:border-[#cacace] disabled:text-[#9a9a9e]">パネルを削除</button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-xs font-bold">画像{hasImage && !panel.imageUrl ? '(他のパネルが画像ありのときは、画像なしでも高さがそろいます)' : ''}</div>
            <div className="flex items-center gap-3">
              {panel.imageUrl ? <img src={panel.imageUrl} alt="" className="h-16 w-24 rounded border border-[#cacace] object-cover" /> : null}
              <button type="button" onClick={() => setPicker(true)} className={btnLine}>{panel.imageUrl ? '画像を変更' : '画像を選択'}</button>
              {panel.imageUrl ? <button type="button" onClick={() => setPanel({ imageUrl: '' })} className="text-xs text-[#e5451f]">画像を外す</button> : null}
            </div>
          </div>
          <label className="block text-xs">
            <span className="mb-1 flex items-center font-bold">タイトル<span className="ml-auto font-normal text-[#757578]">{(panel.title ?? '').length}/40</span></span>
            <input value={panel.title ?? ''} maxLength={40} onChange={(e) => setPanel({ title: e.target.value })} className={fieldCls} aria-label="パネルのタイトル" />
          </label>
          <MessageField
            label="本文"
            required
            value={panel.text}
            onChange={(text) => setPanel({ text })}
            maxLength={bodyMax}
            rows={4}
            toolbar={['name', 'friend', 'emoji']}
          />
        </div>
        <div className="space-y-3">
          {panel.choices.map((c, ci) => (
            <div key={ci} className="relative">
              <ChoiceEditor
                title={`選択肢${ci + 1}`}
                value={c}
                labelMax={20}
                detail
                env={env}
                onChange={(nc) => setPanel({ choices: panel.choices.map((x, j) => (j === ci ? nc : x)) })}
              />
              {panel.choices.length > 1 ? (
                <button type="button" aria-label={`選択肢${ci + 1}を削除`} onClick={() => setPanel({ choices: panel.choices.filter((_, j) => j !== ci) })} className="absolute right-2 top-2 text-lg leading-none text-[#e5451f]">×</button>
              ) : null}
            </div>
          ))}
          <button type="button" disabled={panel.choices.length >= 4} onClick={() => setPanel({ choices: [...panel.choices, emptyChoice()] })} className={`${btnLine} disabled:border-[#cacace] disabled:text-[#9a9a9e]`}>＋ 選択肢を追加</button>
        </div>
      </div>

      <div className="space-y-3 rounded border border-[#e3e3e6] p-4">
        <div className="text-xs font-bold">タップ回数の制限</div>
        <div className="space-y-1.5 text-xs">
          {TAP_LIMITS.map((t) => (
            <label key={t.id} className="flex items-center gap-1.5">
              <input type="radio" name="tap-limit" checked={(value.tapLimit ?? 'none') === t.id} onChange={() => onChange({ ...value, tapLimit: t.id })} className="accent-[#069e04]" />
              {t.label}
            </label>
          ))}
        </div>
        {limited ? (
          <div className="space-y-3 border-t border-dashed border-[#cacace] pt-3 text-xs">
            <div>
              <div className="mb-1 font-bold">上限を超えてタップされたとき</div>
              <div className="flex gap-4">
                {([['same', '全選択肢で同じ動作'], ['each', '選択肢ごとに設定']] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1">
                    <input type="radio" checked={(value.limitScope ?? 'same') === k} onChange={() => onChange({ ...value, limitScope: k })} className="accent-[#069e04]" />
                    {l}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 font-bold">返信メッセージ</div>
              <div className="flex gap-4">
                {([['default', 'お知らせを送る'], ['none', '何も送らない']] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1">
                    <input type="radio" checked={(value.limitReply ?? 'default') === k} onChange={() => onChange({ ...value, limitReply: k })} className="accent-[#069e04]" />
                    {l}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <button type="button" onClick={() => setActionOpen(true)} className={btnLine}>上限超過時のアクション設定{(value.limitActions ?? []).length ? `(${(value.limitActions ?? []).length})` : ''}</button>
              {actionOpen ? (
                <ActionSettingsModal
                  open
                  initial={(value.limitActions ?? []) as FriendAddActionItem[]}
                  lookups={env.lookups}
                  accountId={env.accountId}
                  onClose={() => setActionOpen(false)}
                  onSave={(next) => { onChange({ ...value, limitActions: next }); setActionOpen(false) }}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <MessageField
        label="PC版・通知欄での代替テキスト"
        value={value.altText ?? ''}
        onChange={(altText) => onChange({ ...value, altText })}
        maxLength={400}
        rows={3}
        toolbar={['name', 'friend', 'emoji']}
        placeholder="[LINEアプリよりご覧下さい]"
      />

      <UrlSettingsSection
        value={value.urlSettings}
        onChange={(urlSettings) => onChange({ ...value, urlSettings })}
        sourceText={() => value.panels.map((p) => [p.text, ...p.choices.map((c) => (c.behavior.kind === 'url' ? c.behavior.value ?? '' : ''))].join('\n')).join('\n')}
        lookups={env.lookups}
        accountId={env.accountId}
      />

      <MediaDialog open={picker} kind="image" onClose={() => setPicker(false)} onPick={(m) => { setPanel({ imageUrl: m.url }); setPicker(false) }} />
    </div>
  )
}
