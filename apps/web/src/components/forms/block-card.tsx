'use client'

import { useState, type ReactNode } from 'react'
import { FriendFieldPicker, type PickerField, type PickerFolder } from './friend-field-picker'
import { OptionActionDialog, OptionSettingsDialog } from './option-dialogs'
import { MediaPickerModal } from '@/components/media/media-picker'
import { Collapse } from '@/components/ui/collapse'
import {
  BLOCK_TYPE_LABEL,
  CHOICE_TYPES,
  DISPLAY_ONLY_TYPES,
  FRIEND_FIELD_ONLY_TYPES,
  OPTION_TYPES,
  REGISTRATION_TARGET_TYPES,
  TEXT_INPUT_TYPES,
  TEXT_SUBTYPES,
  targetKey,
  type BlockDraft,
  type ChoiceMode,
  type DateBound,
  type DateRule,
  type OptionAction,
  type RegistrationTarget,
} from './editor-types'

const input = 'h-9 w-full rounded border border-[#cacace] bg-white px-3 text-sm outline-none focus:border-[#069e04]'
const selectCls = 'h-9 rounded border border-[#cacace] bg-white px-2 text-sm'
const emptyAction: OptionAction = { addTagIds: [], removeTagIds: [], scenarioId: '' }

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[11px] font-bold text-[#414143]">{children}</p>
}

/** 横並びの切り替えボタン(Lステップの「本名/システム表示名…」「タグ追加/友だち情報に登録/アクション」) */
function Segmented({ items }: { items: Array<{ label: string; on: boolean; click: () => void }> }) {
  return (
    <div className="inline-flex">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={it.click}
          className={`border border-[#cacace] px-3 py-1.5 text-xs first:rounded-l last:rounded-r [&:not(:first-child)]:-ml-px ${
            it.on ? 'relative z-10 border-[#069e04] bg-[#e6f5e5] font-bold text-[#069e04]' : 'bg-white hover:bg-[#f7f7f9]'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

const OPT_FLAGS: Array<{ key: 'description' | 'defaultValue' | 'placeholder' | 'maxLength'; label: string }> = [
  { key: 'description', label: '説明文' },
  { key: 'defaultValue', label: '初期値' },
  { key: 'placeholder', label: 'プレースホルダ' },
  { key: 'maxLength', label: '入力制限' },
]

export function BlockCard({
  block,
  number,
  selected,
  pickerFields,
  pickerFolders,
  tags,
  scenarios,
  reminders,
  onFieldCreated,
  onSelect,
  onChange,
}: {
  block: BlockDraft
  number: number
  selected: boolean
  pickerFields: PickerField[]
  pickerFolders: PickerFolder[]
  tags: Array<{ id: string; name: string }>
  scenarios: Array<{ id: string; name: string }>
  reminders: Array<{ id: string; name: string }>
  onFieldCreated: (f: PickerField) => void
  onSelect: () => void
  onChange: (patch: Partial<BlockDraft>) => void
}) {
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [actionFor, setActionFor] = useState<string | null>(null)
  const [mediaOpen, setMediaOpen] = useState(false)

  const isDisplay = DISPLAY_ONLY_TYPES.includes(block.type)
  const isText = TEXT_INPUT_TYPES.includes(block.type)
  const hasOptions = OPTION_TYPES.includes(block.type)
  const canRegister = REGISTRATION_TARGET_TYPES.includes(block.type) && !FRIEND_FIELD_ONLY_TYPES.includes(block.type)
  const friendOnly = FRIEND_FIELD_ONLY_TYPES.includes(block.type)
  const titleEmpty = !block.label.trim()
  const isHeading = block.type === 'heading' || block.type === 'subheading'

  const friendTarget = block.registrationTargets.find((t) => t.type === 'friend_field') as
    | { type: 'friend_field'; fieldKey: string }
    | undefined
  const hasFriendTarget = block.registrationTargets.some((t) => t.type === 'friend_field')
  const setFriendTarget = (fieldKey: string | null) => {
    const others = block.registrationTargets.filter((t) => t.type !== 'friend_field')
    onChange({ registrationTargets: fieldKey !== null ? [...others, { type: 'friend_field', fieldKey }] : others })
  }
  const toggleTarget = (t: RegistrationTarget) => {
    const key = targetKey(t)
    const has = block.registrationTargets.some((x) => targetKey(x) === key)
    onChange({
      registrationTargets: has ? block.registrationTargets.filter((x) => targetKey(x) !== key) : [...block.registrationTargets, t],
    })
  }

  const optionNames = block.options.map((o) => o.trim()).filter(Boolean)
  const setOptionName = (i: number, value: string) => {
    const next = [...block.options]
    const old = next[i]
    next[i] = value
    // 選択肢名を変えたら、タグ・登録値・アクション等の紐付けも追従させる
    const move = <T,>(rec: Record<string, T>) => {
      const r = { ...rec }
      if (old && old !== value && old in r) { r[value] = r[old]; delete r[old] }
      return r
    }
    onChange({
      options: next,
      optionTagIds: move(block.optionTagIds),
      optionFriendFieldValues: move(block.optionFriendFieldValues),
      optionActions: move(block.optionActions),
      optionCapacity: move(block.optionCapacity),
      defaultOptions: block.defaultOptions.map((d) => (d === old ? value : d)),
    })
  }

  const setMode = (m: ChoiceMode) => onChange({ choiceMode: m })

  return (
    <div
      id={`block-card-${block.rowId}`}
      onClick={onSelect}
      className={`item-enter flex gap-4 rounded bg-white p-4 transition-shadow duration-200 ${selected ? 'border-2 border-[#069e04] shadow-md' : 'border border-[#dcdce0]'}`}
    >
      <div className="flex w-16 flex-shrink-0 flex-col items-center justify-center text-center">
        <span className="mb-1 flex h-6 w-6 items-center justify-center rounded-sm bg-[#069e04] text-xs font-bold text-white">{number}</span>
        <span className="whitespace-pre-line text-[11px] font-bold leading-tight text-[#069e04]">{BLOCK_TYPE_LABEL[block.type]}</span>
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-start gap-4">
          {(['text', 'email', 'tel', 'number'] as const).includes(block.type as 'text') && (
            <div>
              <Label>タイプ</Label>
              <select className={selectCls} value={block.type} onChange={(e) => onChange({ type: e.target.value as BlockDraft['type'] })}>
                {TEXT_SUBTYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          )}
          {hasOptions && (
            <div>
              <Label>タイプ</Label>
              <select className={selectCls} value={block.type} onChange={(e) => onChange({ type: e.target.value as BlockDraft['type'] })}>
                {CHOICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          )}
          {isHeading && (
            <div>
              <Label>タイプ</Label>
              <select className={selectCls} value={block.type} onChange={(e) => onChange({ type: e.target.value as BlockDraft['type'] })}>
                <option value="heading">見出し1</option>
                <option value="subheading">見出し2</option>
              </select>
            </div>
          )}
          {block.type === 'file' && (
            <div className="order-last">
              <Label>ファイル種別</Label>
              <select className={selectCls} value={block.fileKind} onChange={(e) => onChange({ fileKind: e.target.value as 'image' | 'pdf' })}>
                <option value="image">画像</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
          )}

          {block.type === 'date' && (
            <div className="order-last">
              <Label>入力形式</Label>
              <select className={selectCls} value={block.dateFormat} onChange={(e) => onChange({ dateFormat: e.target.value as 'calendar' | 'ymd' })}>
                <option value="calendar">カレンダー</option>
                <option value="ymd">年月日入力</option>
              </select>
            </div>
          )}

          <div className="min-w-[14rem] flex-1">
            <Label>{block.type === 'paragraph' ? 'テキスト' : block.type === 'button' ? 'ボタン' : block.type === 'image' ? '画像の説明(代替テキスト)' : isHeading ? '見出し' : 'タイトル'}</Label>
            <div className="flex items-center gap-2">
              {block.type === 'paragraph' ? (
                <textarea
                  rows={3}
                  className="w-full rounded border border-[#cacace] bg-white px-3 py-2 text-sm outline-none focus:border-[#069e04]"
                  value={block.label}
                  placeholder="テキストを入力"
                  onChange={(e) => onChange({ label: e.target.value })}
                />
              ) : (
                <input
                  className={`${input} ${titleEmpty && block.type !== 'image' ? 'border-[#e5451f]' : ''}`}
                  value={block.label}
                  placeholder={block.type === 'button' ? 'ボタン名を入力' : block.type === 'image' ? '(任意)' : 'タイトルを入力'}
                  onChange={(e) => onChange({ label: e.target.value })}
                />
              )}
              {titleEmpty && block.type !== 'image' && <span className="whitespace-nowrap text-[11px] font-bold text-[#e5451f]">必須</span>}
            </div>
          </div>

          {!isDisplay && (
            <label className="mt-6 flex items-center gap-1.5 whitespace-nowrap text-xs">
              <input type="checkbox" checked={block.hidden} onChange={(e) => onChange({ hidden: e.target.checked })} />
              非表示
            </label>
          )}
        </div>

        {block.type === 'image' && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[16rem] flex-1">
              <Label>画像</Label>
              <div className="flex items-center gap-2">
                {block.imageUrl && <img src={block.imageUrl} alt="" className="h-9 w-9 rounded border border-[#cacace] object-cover" />}
                <button
                  type="button"
                  onClick={() => setMediaOpen(true)}
                  className={`h-9 whitespace-nowrap rounded border px-3 text-xs font-bold ${block.imageUrl ? 'border-[#cacace] bg-white hover:bg-[#f7f7f9]' : 'border-[#e5451f] bg-[#fff8f6] text-[#e5451f]'}`}
                >
                  {block.imageUrl ? '変更' : 'なし(選択)'}
                </button>
                <input className={input} placeholder="または画像のURLを直接入力" value={block.imageUrl} onChange={(e) => onChange({ imageUrl: e.target.value })} />
              </div>
              <MediaPickerModal
                open={mediaOpen}
                selectedUrl={block.imageUrl}
                onClose={() => setMediaOpen(false)}
                onPick={(m) => { onChange({ imageUrl: m.url }); setMediaOpen(false) }}
              />
            </div>
            <div>
              <Label>サイズ</Label>
              <select className={selectCls} value={block.imageSize} onChange={(e) => onChange({ imageSize: e.target.value as BlockDraft['imageSize'] })}>
                <option value="small">小</option>
                <option value="normal">通常</option>
                <option value="large">大</option>
              </select>
            </div>
            <div className="min-w-[14rem] flex-1">
              <Label>リンクURL(任意)</Label>
              <input className={input} placeholder="画像をタップしたときの移動先" value={block.imageLinkUrl} onChange={(e) => onChange({ imageLinkUrl: e.target.value })} />
            </div>
          </div>
        )}

        {block.type === 'button' && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[16rem] flex-1">
              <Label>URL</Label>
              <input className={input} placeholder="URLを入力" value={block.buttonUrl} onChange={(e) => onChange({ buttonUrl: e.target.value })} />
            </div>
            <div>
              <Label>ボタンスタイル</Label>
              <select className={selectCls} value={block.buttonStyle} onChange={(e) => onChange({ buttonStyle: e.target.value as BlockDraft['buttonStyle'] })}>
                <option value="default">デフォルト</option>
                <option value="outline">枠線のみ</option>
                <option value="rounded">丸型</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs">
              色
              <input type="color" value={block.buttonColor || '#0e9aa7'} onChange={(e) => onChange({ buttonColor: e.target.value })} className="h-9 w-12 rounded border border-[#cacace]" />
              {block.buttonColor && <button type="button" className="text-[#2b7bb9] underline" onClick={() => onChange({ buttonColor: '' })}>既定</button>}
            </label>
          </div>
        )}

        {canRegister && (
          <div>
            <Label>回答の登録先(複数可)</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                items={[
                  { label: '友だち情報', on: hasFriendTarget, click: () => setFriendTarget(hasFriendTarget ? null : '') },
                  { label: '本名', on: block.registrationTargets.some((t) => t.type === 'real_name'), click: () => toggleTarget({ type: 'real_name' }) },
                  { label: 'システム表示名', on: block.registrationTargets.some((t) => t.type === 'display_name'), click: () => toggleTarget({ type: 'display_name' }) },
                  { label: '個別メモ', on: block.registrationTargets.some((t) => t.type === 'memo'), click: () => toggleTarget({ type: 'memo' }) },
                ]}
              />
              {hasFriendTarget && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#757578]">友だち情報欄</span>
                  <FriendFieldPicker
                    value={friendTarget?.fieldKey ?? ''}
                    fields={pickerFields}
                    folders={pickerFolders}
                    onChange={(k) => setFriendTarget(k)}
                    onCreated={onFieldCreated}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {hasOptions && (
          <div>
            <Label>選択時の動作</Label>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Segmented
                items={[
                  { label: 'タグ追加', on: block.choiceMode === 'tag', click: () => setMode('tag') },
                  { label: '友だち情報に登録', on: block.choiceMode === 'friend', click: () => setMode('friend') },
                  { label: 'アクション', on: block.choiceMode === 'action', click: () => setMode('action') },
                ]}
              />
              {block.choiceMode === 'friend' && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#757578]">友だち情報欄</span>
                  <FriendFieldPicker
                    value={block.friendFieldKey}
                    fields={pickerFields}
                    folders={pickerFolders}
                    onChange={(k) => onChange({ friendFieldKey: k })}
                    onCreated={onFieldCreated}
                  />
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded border border-[#e3e3e6]">
              <div className="grid grid-cols-[1fr_1fr_5rem_2rem] gap-2 bg-[#f1f1f4] px-3 py-2 text-[11px] text-[#757578]">
                <span>選択肢</span>
                <span>{block.choiceMode === 'tag' ? 'タグ' : block.choiceMode === 'friend' ? '登録する値' : 'アクション'}</span>
                <span>オプション</span>
                <span />
              </div>
              {block.options.map((o, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_5rem_2rem] items-center gap-2 border-t border-[#f0f0f2] px-3 py-2">
                  <input className={`${input} ${o.trim() ? '' : 'border-[#e5451f]'}`} value={o} placeholder="項目名を入力" onChange={(e) => setOptionName(i, e.target.value)} />

                  {block.choiceMode === 'tag' && (
                    <select
                      className={`${selectCls} w-full`}
                      disabled={!o.trim()}
                      value={block.optionTagIds[o]?.[0] ?? ''}
                      onChange={(e) => {
                        const optionTagIds = { ...block.optionTagIds }
                        if (e.target.value) optionTagIds[o] = [e.target.value]
                        else delete optionTagIds[o]
                        onChange({ optionTagIds })
                      }}
                    >
                      <option value="">タグ名を選択</option>
                      {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                  {block.choiceMode === 'friend' && (
                    <input
                      className={input}
                      disabled={!o.trim()}
                      placeholder={o.trim() ? `空欄なら「${o}」を登録` : '値を入力'}
                      value={block.optionFriendFieldValues[o] ?? ''}
                      onChange={(e) => onChange({ optionFriendFieldValues: { ...block.optionFriendFieldValues, [o]: e.target.value } })}
                    />
                  )}
                  {block.choiceMode === 'action' && (
                    <button
                      type="button"
                      disabled={!o.trim()}
                      onClick={() => setActionFor(o)}
                      className="h-9 rounded bg-[#f0b03c] px-3 text-sm font-bold text-white hover:bg-[#e0a02c] disabled:opacity-50"
                    >
                      ⚡ アクション設定
                      {(() => {
                        const a = block.optionActions[o]
                        const n = a ? a.addTagIds.length + a.removeTagIds.length + (a.scenarioId ? 1 : 0) : 0
                        return n > 0 ? `(${n})` : ''
                      })()}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={!o.trim()}
                    onClick={() => setSettingsFor(o)}
                    className="h-9 rounded border border-[#cacace] bg-white text-xs hover:bg-[#f7f7f9] disabled:opacity-50"
                  >
                    設定
                  </button>
                  <button
                    type="button"
                    aria-label="この選択肢を削除"
                    disabled={block.options.length <= 1}
                    onClick={() => onChange({ options: block.options.filter((_, j) => j !== i) })}
                    className="text-lg text-[#b5b5b9] hover:text-[#e5451f] disabled:opacity-40"
                  >
                    ×
                  </button>
                </div>
              ))}
              {block.allowOther && (
                <div className="grid grid-cols-[1fr_1fr_5rem_2rem] items-center gap-2 border-t border-[#f0f0f2] bg-[#fafafb] px-3 py-2">
                  <span className="px-1 text-sm">その他<span className="ml-2 text-[11px] text-[#757578]">(回答者が自由に入力)</span></span>
                  <span />
                  <span />
                  <button type="button" aria-label="「その他」を削除" onClick={() => onChange({ allowOther: false })} className="text-lg text-[#b5b5b9] hover:text-[#e5451f]">×</button>
                </div>
              )}
              <div className="flex gap-4 border-t border-[#f0f0f2] px-3 py-2 text-xs font-bold text-[#069e04]">
                <button type="button" onClick={() => onChange({ options: [...block.options, ''] })}>＋選択肢を追加</button>
                {!block.allowOther && <button type="button" onClick={() => onChange({ allowOther: true })}>＋その他を追加</button>}
              </div>
            </div>

            <OptionSettingsDialog
              open={settingsFor !== null}
              optionName={settingsFor ?? ''}
              initialSelected={settingsFor !== null && block.defaultOptions.includes(settingsFor)}
              capacity={settingsFor !== null ? (block.optionCapacity[settingsFor] ?? null) : null}
              onClose={() => setSettingsFor(null)}
              onSave={(v) => {
                const name = settingsFor
                if (name === null) return
                let defaults = block.defaultOptions.filter((d) => d !== name)
                if (v.initialSelected) defaults = block.type === 'checkbox' ? [...defaults, name] : [name]
                const optionCapacity = { ...block.optionCapacity }
                if (v.capacity !== null) optionCapacity[name] = v.capacity
                else delete optionCapacity[name]
                onChange({ defaultOptions: defaults, optionCapacity })
                setSettingsFor(null)
              }}
            />
            <OptionActionDialog
              open={actionFor !== null}
              optionName={actionFor ?? ''}
              action={actionFor !== null ? (block.optionActions[actionFor] ?? emptyAction) : emptyAction}
              tags={tags}
              scenarios={scenarios}
              onClose={() => setActionFor(null)}
              onSave={(a) => {
                if (actionFor === null) return
                onChange({ optionActions: { ...block.optionActions, [actionFor]: a } })
                setActionFor(null)
              }}
            />
          </div>
        )}

        {/* 下段: 説明文 / 初期値 / プレースホルダ / 入力制限 / 友だち情報に登録 / 必須 */}
        {!isDisplay && (
          <div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#414143]">
              {(isText ? OPT_FLAGS : OPT_FLAGS.filter((f) => f.key === 'description')).map((f) => (
                <label key={f.key} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={block.open[f.key]} onChange={(e) => onChange({ open: { ...block.open, [f.key]: e.target.checked } })} />
                  {f.label}
                </label>
              ))}
              {friendOnly && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={hasFriendTarget} onChange={(e) => setFriendTarget(e.target.checked ? '' : null)} />
                  友だち情報に登録
                </label>
              )}
              {block.type === 'date' && (
                <>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={block.reminderOn} onChange={(e) => onChange({ reminderOn: e.target.checked })} />
                    リマインダを設定
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={block.dateLimitOn} onChange={(e) => onChange({ dateLimitOn: e.target.checked })} />
                    入力制限
                  </label>
                </>
              )}
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={block.required} onChange={(e) => onChange({ required: e.target.checked })} />
                必須
              </label>
            </div>
            {block.type === 'date' && (
              <DatePanels block={block} reminders={reminders} onChange={onChange} />
            )}
            {friendOnly && hasFriendTarget && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-[#757578]">友だち情報欄</span>
                <FriendFieldPicker
                  value={friendTarget?.fieldKey ?? ''}
                  fields={pickerFields}
                  folders={pickerFolders}
                  onChange={(k) => setFriendTarget(k)}
                  onCreated={onFieldCreated}
                />
              </div>
            )}
            <div className="mt-1">
              <Collapse open={block.open.description}>
                <textarea rows={2} className="mt-2 w-full rounded border border-[#cacace] px-3 py-2 text-sm outline-none focus:border-[#069e04]" placeholder="説明文" value={block.description} onChange={(e) => onChange({ description: e.target.value })} />
              </Collapse>
              {isText && (
                <>
                  <Collapse open={block.open.defaultValue}>
                    <input className={`${input} mt-2`} placeholder="初期値" value={block.defaultValue} onChange={(e) => onChange({ defaultValue: e.target.value })} />
                  </Collapse>
                  <Collapse open={block.open.placeholder}>
                    <input className={`${input} mt-2`} placeholder="プレースホルダ(入力例)" value={block.placeholder} onChange={(e) => onChange({ placeholder: e.target.value })} />
                  </Collapse>
                  <Collapse open={block.open.maxLength}>
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <input type="number" min={1} className={`${input} max-w-[8rem]`} value={block.maxLength} onChange={(e) => onChange({ maxLength: e.target.value })} />
                      文字まで
                    </div>
                  </Collapse>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function BoundEditor({
  label,
  value,
  onChange,
}: {
  label: string
  value: DateBound | undefined
  onChange: (b: DateBound) => void
}) {
  const mode = value?.mode ?? 'none'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-12 text-xs text-[#757578]">{label}</span>
      <select
        className={selectCls}
        value={mode}
        onChange={(e) => {
          const m = e.target.value
          if (m === 'relative') onChange({ mode: 'relative', days: 0 })
          else if (m === 'fixed') onChange({ mode: 'fixed', date: '' })
          else onChange({ mode: 'none' })
        }}
      >
        <option value="none">制限しない</option>
        <option value="relative">回答日を起点に指定</option>
        <option value="fixed">特定の日付</option>
      </select>
      {value?.mode === 'relative' && (
        <span className="flex items-center gap-1.5 text-xs">
          回答日の
          <input
            type="number"
            className={`${input} w-20`}
            value={value.days}
            onChange={(e) => onChange({ mode: 'relative', days: Number(e.target.value) || 0 })}
          />
          日後(0=当日、マイナス=過去)
        </span>
      )}
      {value?.mode === 'fixed' && (
        <input type="date" className={`${input} w-44`} value={value.date} onChange={(e) => onChange({ mode: 'fixed', date: e.target.value })} />
      )}
    </div>
  )
}

/** 日付ブロックの「リマインダを設定」「入力制限」の設定欄(Lステップ準拠)。 */
function DatePanels({
  block,
  reminders,
  onChange,
}: {
  block: BlockDraft
  reminders: Array<{ id: string; name: string }>
  onChange: (patch: Partial<BlockDraft>) => void
}) {
  const rule = block.dateRule
  const setRule = (patch: Partial<DateRule>) => onChange({ dateRule: { ...rule, ...patch } })
  const weekdays = rule.weekdays ?? []
  return (
    <div className="mt-3 space-y-3">
      <Collapse open={block.reminderOn}>
        <div className="flex flex-wrap items-center gap-2 rounded border border-[#e3e3e6] bg-[#fafafb] p-3">
          <span className="text-xs font-bold">リマインダを設定</span>
          <select className={`${selectCls} min-w-[14rem]`} value={block.reminderId} onChange={(e) => onChange({ reminderId: e.target.value })}>
            <option value="">リマインダを選択</option>
            {reminders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <span className="text-xs text-[#757578]">友だちが入力した日付の</span>
          <input type="time" className={`${selectCls} w-28`} value={block.reminderTime} onChange={(e) => onChange({ reminderTime: e.target.value })} />
          {reminders.length === 0 && <span className="text-[11px] text-[#e5451f]">リマインダ配信が未作成です(先に「リマインダ配信」で作成してください)</span>}
        </div>
      </Collapse>
      <Collapse open={block.dateLimitOn}>
        <div className="space-y-2 rounded border border-[#e3e3e6] bg-[#fafafb] p-3">
          <span className="text-xs font-bold">入力制限</span>
          <BoundEditor label="開始日" value={rule.start} onChange={(b) => setRule({ start: b })} />
          <BoundEditor label="終了日" value={rule.end} onChange={(b) => setRule({ end: b })} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 text-xs text-[#757578]">曜日</span>
            <span className="text-[11px] text-[#757578]">選択可能な曜日(未選択なら全曜日)</span>
            <div className="inline-flex">
              {WEEKDAYS.map((w, i) => {
                const on = weekdays.includes(i)
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setRule({ weekdays: on ? weekdays.filter((d) => d !== i) : [...weekdays, i].sort() })}
                    className={`h-8 w-8 border border-[#cacace] text-xs first:rounded-l last:rounded-r [&:not(:first-child)]:-ml-px ${
                      on ? 'relative z-10 border-[#069e04] bg-[#e6f5e5] font-bold text-[#069e04]' : 'bg-white'
                    }`}
                  >
                    {w}
                  </button>
                )
              })}
            </div>
            <span className="ml-2 text-[11px] text-[#757578]">祝日オプション</span>
            <select className={selectCls} value={rule.holiday ?? 'ignore'} onChange={(e) => setRule({ holiday: e.target.value as DateRule['holiday'] })}>
              <option value="ignore">なし(考慮しない)</option>
              <option value="allow">選択した曜日 + 祝日もOK</option>
              <option value="deny">選択した曜日のうち祝日はNG</option>
            </select>
          </div>
        </div>
      </Collapse>
    </div>
  )
}
