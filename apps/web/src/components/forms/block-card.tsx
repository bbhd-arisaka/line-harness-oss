'use client'

import type { ReactNode } from 'react'
import {
  BLOCK_TYPE_LABEL,
  CHOICE_ACTION_TYPES,
  DISPLAY_ONLY_TYPES,
  OPTION_TYPES,
  REGISTRATION_TARGET_TYPES,
  TEXT_INPUT_TYPES,
  TEXT_SUBTYPES,
  targetKey,
  type BlockDraft,
  type RegistrationTarget,
} from './editor-types'

const input = 'h-9 w-full rounded border border-[#cacace] bg-white px-3 text-sm outline-none focus:border-[#069e04]'

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[11px] font-bold text-[#414143]">{children}</p>
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
  friendFields,
  tags,
  onSelect,
  onChange,
}: {
  block: BlockDraft
  number: number
  selected: boolean
  friendFields: Array<{ fieldKey: string; label: string }>
  tags: Array<{ id: string; name: string }>
  onSelect: () => void
  onChange: (patch: Partial<BlockDraft>) => void
}) {
  const isDisplay = DISPLAY_ONLY_TYPES.includes(block.type)
  const isText = TEXT_INPUT_TYPES.includes(block.type)
  const hasOptions = OPTION_TYPES.includes(block.type)
  const canRegister = REGISTRATION_TARGET_TYPES.includes(block.type)
  const titleEmpty = !block.label.trim()

  const toggleTarget = (t: RegistrationTarget) => {
    const key = targetKey(t)
    const has = block.registrationTargets.some((x) => targetKey(x) === key)
    onChange({
      registrationTargets: has
        ? block.registrationTargets.filter((x) => targetKey(x) !== key)
        : [...block.registrationTargets, t],
    })
  }
  const hasFriendField = block.registrationTargets.some((t) => t.type === 'friend_field')
  const selectedFriendField = block.registrationTargets.find((t) => t.type === 'friend_field') as
    | { type: 'friend_field'; fieldKey: string }
    | undefined
  const setFriendField = (fieldKey: string) => {
    const others = block.registrationTargets.filter((t) => t.type !== 'friend_field')
    onChange({ registrationTargets: fieldKey ? [...others, { type: 'friend_field', fieldKey }] : others })
  }

  const targetBtn = (label: string, on: boolean, click: () => void) => (
    <button
      type="button"
      onClick={click}
      className={`border border-[#cacace] px-3 py-1.5 text-xs first:rounded-l last:rounded-r [&:not(:first-child)]:-ml-px ${
        on ? 'relative z-10 border-[#069e04] bg-[#e6f5e5] font-bold text-[#069e04]' : 'bg-white hover:bg-[#f7f7f9]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div
      onClick={onSelect}
      className={`flex gap-4 rounded bg-white p-4 ${selected ? 'border-2 border-[#069e04]' : 'border border-[#dcdce0]'}`}
    >
      {/* 左: 番号と種別名 */}
      <div className="flex w-16 flex-shrink-0 flex-col items-center justify-center text-center">
        <span className="mb-1 flex h-6 w-6 items-center justify-center rounded-sm bg-[#069e04] text-xs font-bold text-white">{number}</span>
        <span className="whitespace-pre-line text-[11px] font-bold leading-tight text-[#069e04]">{BLOCK_TYPE_LABEL[block.type]}</span>
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-start gap-4">
          {['text', 'email', 'tel', 'number'].includes(block.type) && (
            <div>
              <Label>タイプ</Label>
              <select
                className="h-9 rounded border border-[#cacace] bg-white px-2 text-sm"
                value={block.type}
                onChange={(e) => onChange({ type: e.target.value as BlockDraft['type'] })}
              >
                {TEXT_SUBTYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          )}

          <div className="min-w-[14rem] flex-1">
            <Label>
              {block.type === 'paragraph' ? '本文' : block.type === 'button' ? 'ボタン文言' : 'タイトル'}
            </Label>
            <div className="flex items-center gap-2">
              {block.type === 'paragraph' ? (
                <textarea
                  rows={3}
                  className="w-full rounded border border-[#cacace] bg-white px-3 py-2 text-sm outline-none focus:border-[#069e04]"
                  value={block.label}
                  placeholder="本文を入力"
                  onChange={(e) => onChange({ label: e.target.value })}
                />
              ) : (
                <input
                  className={`${input} ${titleEmpty ? 'border-[#e5451f]' : ''}`}
                  value={block.label}
                  placeholder={block.type === 'image' ? '画像の代替テキスト' : 'タイトルを入力'}
                  onChange={(e) => onChange({ label: e.target.value })}
                />
              )}
              {titleEmpty && block.type !== 'image' && <span className="whitespace-nowrap text-[11px] font-bold text-[#e5451f]">必須</span>}
            </div>
          </div>

          {!isDisplay && !hasOptions && block.type !== 'file' && (
            <label className="mt-6 flex items-center gap-1.5 whitespace-nowrap text-xs">
              <input type="checkbox" checked={block.hidden} onChange={(e) => onChange({ hidden: e.target.checked })} />
              非表示
            </label>
          )}
        </div>

        {block.type === 'image' && (
          <div>
            <Label>画像URL</Label>
            <input className={input} placeholder="https://example.com/image.jpg" value={block.imageUrl} onChange={(e) => onChange({ imageUrl: e.target.value })} />
          </div>
        )}
        {block.type === 'button' && (
          <div>
            <Label>リンク先URL</Label>
            <input className={input} placeholder="https://example.com" value={block.buttonUrl} onChange={(e) => onChange({ buttonUrl: e.target.value })} />
          </div>
        )}

        {canRegister && (
          <div>
            <Label>回答の登録先(複数可)</Label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex">
                {targetBtn('友だち情報', hasFriendField, () => {
                  if (hasFriendField) setFriendField('')
                  else if (friendFields[0]) setFriendField(friendFields[0].fieldKey)
                })}
                {targetBtn('本名', block.registrationTargets.some((t) => t.type === 'real_name'), () => toggleTarget({ type: 'real_name' }))}
                {targetBtn('システム表示名', block.registrationTargets.some((t) => t.type === 'display_name'), () => toggleTarget({ type: 'display_name' }))}
                {targetBtn('個別メモ', block.registrationTargets.some((t) => t.type === 'memo'), () => toggleTarget({ type: 'memo' }))}
              </div>
              {hasFriendField && (
                <select
                  className="h-9 rounded border border-[#cacace] bg-white px-2 text-sm"
                  value={selectedFriendField?.fieldKey ?? ''}
                  onChange={(e) => setFriendField(e.target.value)}
                >
                  {friendFields.map((f) => <option key={f.fieldKey} value={f.fieldKey}>{f.label}</option>)}
                </select>
              )}
              {friendFields.length === 0 && <span className="text-[11px] text-[#757578]">友だち情報欄が未登録です</span>}
            </div>
          </div>
        )}

        {hasOptions && (
          <div>
            <Label>選択肢</Label>
            <div className="space-y-2">
              {block.options.map((o, i) => (
                <div key={i} className="rounded border border-[#e3e3e6] bg-[#fafafb] p-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-center text-xs text-[#757578]">{i + 1}</span>
                    <input
                      className={input}
                      value={o}
                      placeholder="選択肢を入力"
                      onChange={(e) => {
                        const next = [...block.options]
                        const old = next[i]
                        next[i] = e.target.value
                        // 選択肢名を変えたら、タグ・書き込み値の紐付けも追従させる
                        const optionTagIds = { ...block.optionTagIds }
                        const optionFriendFieldValues = { ...block.optionFriendFieldValues }
                        if (old && old !== e.target.value) {
                          if (optionTagIds[old]) { optionTagIds[e.target.value] = optionTagIds[old]; delete optionTagIds[old] }
                          if (optionFriendFieldValues[old] !== undefined) { optionFriendFieldValues[e.target.value] = optionFriendFieldValues[old]; delete optionFriendFieldValues[old] }
                        }
                        onChange({ options: next, optionTagIds, optionFriendFieldValues })
                      }}
                    />
                    <button
                      type="button"
                      aria-label="この選択肢を削除"
                      disabled={block.options.length <= 1}
                      onClick={() => onChange({ options: block.options.filter((_, j) => j !== i) })}
                      className="px-1 text-[#b5b5b9] hover:text-[#e5451f] disabled:opacity-40"
                    >
                      🗑
                    </button>
                  </div>
                  {CHOICE_ACTION_TYPES.includes(block.type) && o.trim() && tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-7">
                      <span className="text-[11px] text-[#757578]">選択時にタグを追加:</span>
                      {tags.map((tag) => {
                        const on = (block.optionTagIds[o] ?? []).includes(tag.id)
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => {
                              const cur = block.optionTagIds[o] ?? []
                              const next = on ? cur.filter((id) => id !== tag.id) : [...cur, tag.id]
                              const optionTagIds = { ...block.optionTagIds, [o]: next }
                              if (next.length === 0) delete optionTagIds[o]
                              onChange({ optionTagIds })
                            }}
                            className={`rounded border px-2 py-0.5 text-[11px] ${on ? 'border-[#069e04] bg-[#e6f5e5] font-bold text-[#069e04]' : 'border-[#cacace] bg-white'}`}
                          >
                            {tag.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {CHOICE_ACTION_TYPES.includes(block.type) && o.trim() && block.friendFieldKey && (
                    <div className="mt-2 pl-7">
                      <input
                        className={`${input} h-8 text-xs`}
                        placeholder={`友だち情報へ書き込む値(空欄なら「${o}」をそのまま使用)`}
                        value={block.optionFriendFieldValues[o] ?? ''}
                        onChange={(e) => {
                          const v = { ...block.optionFriendFieldValues }
                          if (e.target.value.trim()) v[o] = e.target.value
                          else delete v[o]
                          onChange({ optionFriendFieldValues: v })
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => onChange({ options: [...block.options, ''] })}
                className="flex h-8 w-full items-center justify-center gap-1 rounded border border-[#cacace] bg-white text-xs font-bold hover:bg-[#f7f7f9]"
              >
                <span className="text-base leading-none">＋</span> 新しい選択肢を追加
              </button>
            </div>
            {CHOICE_ACTION_TYPES.includes(block.type) && (
              <div className="mt-2">
                <Label>友だち情報に登録する場合の書き込み先(任意)</Label>
                <select
                  className="h-9 rounded border border-[#cacace] bg-white px-2 text-sm"
                  value={block.friendFieldKey}
                  onChange={(e) => onChange({ friendFieldKey: e.target.value })}
                >
                  <option value="">(設定しない)</option>
                  {friendFields.map((f) => <option key={f.fieldKey} value={f.fieldKey}>{f.label}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {/* 下段: 説明文 / 初期値 / プレースホルダ / 入力制限 / 必須 / 非表示 */}
        {!isDisplay && (
          <div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#414143]">
              {(isText ? OPT_FLAGS : OPT_FLAGS.filter((f) => f.key === 'description')).map((f) => (
                <label key={f.key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={block.open[f.key]}
                    onChange={(e) => onChange({ open: { ...block.open, [f.key]: e.target.checked } })}
                  />
                  {f.label}
                </label>
              ))}
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={block.required} onChange={(e) => onChange({ required: e.target.checked })} />
                必須
              </label>
              {(hasOptions || block.type === 'file') && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={block.hidden} onChange={(e) => onChange({ hidden: e.target.checked })} />
                  非表示
                </label>
              )}
            </div>
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
