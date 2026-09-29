'use client'

import { useState, type ReactNode } from 'react'
import { FriendFieldPicker, type PickerField, type PickerFolder } from './friend-field-picker'
import { OptionActionDialog, OptionSettingsDialog } from './option-dialogs'
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
  onFieldCreated: (f: PickerField) => void
  onSelect: () => void
  onChange: (patch: Partial<BlockDraft>) => void
}) {
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [actionFor, setActionFor] = useState<string | null>(null)

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
      className={`flex gap-4 rounded bg-white p-4 transition-shadow ${selected ? 'border-2 border-[#069e04] shadow-md' : 'border border-[#dcdce0]'}`}
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
              <Label>画像URL</Label>
              <input className={input} placeholder="https://example.com/image.jpg" value={block.imageUrl} onChange={(e) => onChange({ imageUrl: e.target.value })} />
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
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={block.required} onChange={(e) => onChange({ required: e.target.checked })} />
                必須
              </label>
            </div>
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
            <div className="mt-2 space-y-2">
              {block.open.description && (
                <textarea rows={2} className="w-full rounded border border-[#cacace] px-3 py-2 text-sm outline-none focus:border-[#069e04]" placeholder="説明文" value={block.description} onChange={(e) => onChange({ description: e.target.value })} />
              )}
              {isText && block.open.defaultValue && (
                <input className={input} placeholder="初期値" value={block.defaultValue} onChange={(e) => onChange({ defaultValue: e.target.value })} />
              )}
              {isText && block.open.placeholder && (
                <input className={input} placeholder="プレースホルダ(入力例)" value={block.placeholder} onChange={(e) => onChange({ placeholder: e.target.value })} />
              )}
              {isText && block.open.maxLength && (
                <div className="flex items-center gap-2 text-sm">
                  <input type="number" min={1} className={`${input} max-w-[8rem]`} value={block.maxLength} onChange={(e) => onChange({ maxLength: e.target.value })} />
                  文字まで
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

