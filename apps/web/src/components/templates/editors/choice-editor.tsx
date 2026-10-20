'use client'

import { useState } from 'react'
import type { ChoiceBehavior, ChoiceDef, ReplyDef } from '@line-crm/shared'
import ActionSettingsModal from '@/components/friend-add/action-settings-modal'
import { describeAction } from '@/lib/friend-add-actions'
import type { FriendAddActionItem } from '@/lib/friend-add-actions'
import MessageField from '../message-field'
import { btnLine, fieldCls } from './types'
import type { EditorEnv } from './types'

export const BEHAVIOR_OPTIONS: Array<{ id: ChoiceBehavior['kind']; label: string }> = [
  { id: 'none', label: '選択時にメッセージを送信' },
  { id: 'url', label: 'URLを開く' },
  { id: 'tel', label: '電話をかける' },
  { id: 'friend_add', label: '友だち追加' },
  { id: 'mail', label: 'メールを送る' },
  { id: 'form', label: '回答フォームを開く' },
  { id: 'scenario', label: 'シナリオを移動・停止' },
  { id: 'event', label: 'イベント予約を開く' },
  { id: 'calendar', label: 'カレンダー予約を開く' },
  { id: 'actions', label: 'アクションを実行' },
]

export const emptyChoice = (label = ''): ChoiceDef => ({ label, behavior: { kind: 'none' } })

const VALUE_PLACEHOLDER: Partial<Record<ChoiceBehavior['kind'], string>> = {
  url: 'https://example.com',
  tel: '03-1234-5678',
  friend_add: '@abc1234x',
  mail: 'info@example.com',
  event: 'イベントID',
  calendar: 'カレンダーID',
}

const smallSelect = 'h-9 w-full rounded border border-[#cacace] bg-white px-2 text-sm outline-none focus:border-[#069e04]'

function ReplyEditor({ label, value, onChange, env }: { label: string; value: ReplyDef | undefined; onChange: (v: ReplyDef | undefined) => void; env: EditorEnv }) {
  const mode = value?.mode ?? null
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-bold">{label}</div>
      <div className="flex gap-4 text-xs">
        {([[null, 'なし'], ['text', 'テキスト'], ['template', 'テンプレート']] as const).map(([k, l]) => (
          <label key={String(k)} className="flex items-center gap-1">
            <input
              type="radio"
              checked={mode === k}
              onChange={() => onChange(k === null ? undefined : k === 'text' ? { mode: 'text', text: value?.text ?? '' } : { mode: 'template', templateId: value?.templateId ?? null })}
              className="accent-[#069e04]"
            />
            {l}
          </label>
        ))}
      </div>
      {mode === 'text' ? <MessageField value={value?.text ?? ''} onChange={(text) => onChange({ mode: 'text', text })} maxLength={4500} rows={4} toolbar={['name', 'friend', 'emoji']} showCounter /> : null}
      {mode === 'template' ? (
        <select value={value?.templateId ?? ''} onChange={(e) => onChange({ mode: 'template', templateId: e.target.value || null })} className={smallSelect} aria-label={`${label}のテンプレート`}>
          <option value="">テンプレートを選択</option>
          {env.lookups.templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      ) : null}
    </div>
  )
}

function TagPicker({ label, ids, onChange, env }: { label: string; ids: string[]; onChange: (v: string[]) => void; env: EditorEnv }) {
  return (
    <div>
      <div className="mb-1 text-xs font-bold">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const t = env.lookups.tags.find((x) => x.id === id)
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded bg-[#e3f1e3] px-2 py-1 text-xs">
              {t?.name ?? '(削除されたタグ)'}
              <button type="button" aria-label="外す" onClick={() => onChange(ids.filter((x) => x !== id))}>×</button>
            </span>
          )
        })}
        <select
          value=""
          onChange={(e) => { if (e.target.value) onChange([...ids, e.target.value]) }}
          className="h-7 rounded border border-[#cacace] bg-white px-1 text-xs"
          aria-label={`${label}を追加`}
        >
          <option value="">＋ タグを選択</option>
          {env.lookups.tags.filter((t) => !ids.includes(t.id)).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

/**
 * 選択肢1つ分: ラベル・押したときの動き。detail=ON のとき、友だちの発言・返信・二度押しの返信・タグ・友だち情報の設定も出る。
 */
export default function ChoiceEditor({
  value,
  onChange,
  env,
  detail,
  title,
  labelMax,
}: {
  value: ChoiceDef
  onChange: (v: ChoiceDef) => void
  env: EditorEnv
  detail: boolean
  title: string
  labelMax: number
}) {
  const [actionOpen, setActionOpen] = useState(false)
  const b = value.behavior
  const setB = (patch: Partial<ChoiceBehavior>) => onChange({ ...value, behavior: { ...b, ...patch } })
  const actions = (b.actions ?? []) as FriendAddActionItem[]

  return (
    <div className="space-y-3 rounded border border-[#e3e3e6] p-3">
      <div className="text-xs font-bold">{title}</div>
      <label className="block text-xs">
        <span className="mb-1 flex items-center gap-1.5 font-bold">
          ラベル <span className="rounded-sm bg-[#e5451f] px-1 py-0.5 text-[10px] text-white">必須</span>
          <span className="ml-auto font-normal text-[#757578]">{value.label.length}/{labelMax}</span>
        </span>
        <input value={value.label} maxLength={labelMax} onChange={(e) => onChange({ ...value, label: e.target.value })} className={fieldCls} aria-label={`${title}のラベル`} />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block font-bold">タップ時の動作</span>
        <select value={b.kind} onChange={(e) => onChange({ ...value, behavior: { kind: e.target.value as ChoiceBehavior['kind'] } })} className={smallSelect} aria-label={`${title}のタップ時の動作`}>
          {BEHAVIOR_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </label>

      {['url', 'tel', 'friend_add', 'mail', 'event', 'calendar'].includes(b.kind) ? (
        <input value={b.value ?? ''} onChange={(e) => setB({ value: e.target.value })} placeholder={VALUE_PLACEHOLDER[b.kind]} className={fieldCls} aria-label={`${title}の設定値`} />
      ) : null}
      {b.kind === 'form' ? (
        <select value={b.value ?? ''} onChange={(e) => setB({ value: e.target.value })} className={smallSelect} aria-label={`${title}のフォーム`}>
          <option value="">回答フォームを選択</option>
          {env.lookups.forms.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      ) : null}
      {b.kind === 'scenario' ? (
        <div className="grid grid-cols-2 gap-2">
          <select value={b.scenarioOp ?? 'move'} onChange={(e) => setB({ scenarioOp: e.target.value as 'move' | 'stop' })} className={smallSelect} aria-label={`${title}のシナリオ操作`}>
            <option value="move">移動</option>
            <option value="stop">停止</option>
          </select>
          <select value={b.value ?? ''} onChange={(e) => setB({ value: e.target.value })} className={smallSelect} aria-label={`${title}のシナリオ`}>
            <option value="">シナリオを選択</option>
            {env.lookups.scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      ) : null}
      {b.kind === 'actions' ? (
        <div className="space-y-1.5">
          {actions.length > 0 ? (
            <ul className="space-y-1 text-xs">
              {actions.map((a, i) => (
                <li key={i} className="rounded bg-[#f7f7f9] px-2 py-1">{describeAction(a, env.lookups)}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" onClick={() => setActionOpen(true)} className={btnLine}>アクション設定</button>
          {actionOpen ? (
            <ActionSettingsModal
              open
              initial={actions}
              lookups={env.lookups}
              accountId={env.accountId}
              onClose={() => setActionOpen(false)}
              onSave={(next) => { setB({ actions: next }); setActionOpen(false) }}
            />
          ) : null}
        </div>
      ) : null}

      {detail ? (
        <div className="space-y-3 border-t border-dashed border-[#cacace] pt-3">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-bold">
              友だちの発言として送る文章
              <label className="ml-auto flex items-center gap-1 font-normal">
                <input type="checkbox" checked={!!value.noUserMessage} onChange={(e) => onChange({ ...value, noUserMessage: e.target.checked })} className="accent-[#069e04]" />
                発言を送らない
              </label>
            </label>
            <input value={value.userMessage ?? ''} disabled={!!value.noUserMessage} onChange={(e) => onChange({ ...value, userMessage: e.target.value })} placeholder={value.label} className={fieldCls} aria-label={`${title}の友だちの発言`} />
          </div>
          <ReplyEditor label="選択時の返信" value={value.reply} onChange={(reply) => onChange({ ...value, reply })} env={env} />
          <ReplyEditor label="2回目以降にタップされたときの返信" value={value.repeatReply} onChange={(repeatReply) => onChange({ ...value, repeatReply })} env={env} />
          <TagPicker label="タグを追加" ids={value.addTagIds ?? []} onChange={(addTagIds) => onChange({ ...value, addTagIds })} env={env} />
          <TagPicker label="タグを削除" ids={value.removeTagIds ?? []} onChange={(removeTagIds) => onChange({ ...value, removeTagIds })} env={env} />
          <div>
            <div className="mb-1 text-xs font-bold">友だち情報を更新</div>
            <div className="grid grid-cols-2 gap-2">
              <select value={value.fieldId ?? ''} onChange={(e) => onChange({ ...value, fieldId: e.target.value || null })} className={smallSelect} aria-label={`${title}の友だち情報欄`}>
                <option value="">更新しない</option>
                {env.lookups.fields.map((f) => (
                  <option key={f.fieldKey} value={f.fieldKey}>{f.label}</option>
                ))}
              </select>
              <input value={value.fieldValue ?? ''} disabled={!value.fieldId} onChange={(e) => onChange({ ...value, fieldValue: e.target.value })} className={fieldCls} aria-label={`${title}の更新値`} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
