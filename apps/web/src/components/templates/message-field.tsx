'use client'

import { useRef, useState } from 'react'
import { EmojiPicker } from '@/components/rich-menus/emoji-picker'
import { FormTagPicker } from '@/components/forms/form-tag-picker'
import { Popover } from '@/components/lstep/ui'
import { TagTextEditor, type TagTextEditorHandle } from '@/components/ui/tag-text-editor'
import { DATE_FORMAT_OPTIONS } from '@/lib/form-tags'
import { useFriendFields } from './use-friend-fields'

export type ToolbarItem = 'undo' | 'name' | 'friend' | 'form' | 'date' | 'other' | 'emoji'

const toolBtn = 'inline-flex h-7 items-center gap-0.5 rounded border border-[#cacace] bg-white px-2 text-xs text-[#414143] hover:bg-[#f7f7f9]'

/** 必須・短縮URL対応などの小さなラベル(Lステップと同じ。赤=必須、灰=対応する機能) */
export function Badge({ kind, children }: { kind: 'required' | 'info'; children: React.ReactNode }) {
  return <span className={`rounded-sm px-1 py-0.5 text-[10px] font-bold text-white ${kind === 'required' ? 'bg-[#e5451f]' : 'bg-[#757578]'}`}>{children}</span>
}

/**
 * Lステップのメッセージ入力欄。上に、元に戻す・やり直す・名前・友だち情報・回答フォーム・配信日・その他・絵文字のボタン。
 * 差し込み語は、波かっこの文字ではなく、色つきの枠で入る(TagTextEditor)。
 */
export default function MessageField({
  label,
  required,
  badges,
  value,
  onChange,
  maxLength,
  rows = 10,
  toolbar = ['undo', 'name', 'friend', 'form', 'date', 'other', 'emoji'],
  placeholder,
  note,
  showCounter = true,
  disabled,
}: {
  label?: string
  required?: boolean
  badges?: string[]
  value: string
  onChange: (v: string) => void
  maxLength?: number
  rows?: number
  toolbar?: ToolbarItem[]
  placeholder?: string
  note?: string
  showCounter?: boolean
  disabled?: boolean
}) {
  const ref = useRef<TagTextEditorHandle>(null)
  const { fields, folders, labels } = useFriendFields()
  const [menu, setMenu] = useState<null | 'name' | 'friend' | 'date' | 'emoji'>(null)
  const [friendFolder, setFriendFolder] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [otherOpen, setOtherOpen] = useState(false)
  const [until, setUntil] = useState('')
  const [plusDays, setPlusDays] = useState(0)
  const [plusFmt, setPlusFmt] = useState('mdw')
  const has = (i: ToolbarItem) => toolbar.includes(i)
  const close = () => setMenu(null)
  const insert = (code: string) => {
    ref.current?.insertTag(code)
    close()
  }
  // 友だち情報欄: フォルダ(未分類を含む)ごとの2段メニュー
  const groups = [
    { id: '__none__', name: '未分類', fields: fields.filter((f) => !f.folderId) },
    ...folders.map((f) => ({ id: f.id, name: f.name, fields: fields.filter((x) => x.folderId === f.id) })),
  ].filter((g) => g.fields.length > 0)

  return (
    <div>
      {label ? (
        <div className="mb-1 flex items-center gap-1.5 text-xs font-bold">
          {label}
          {required ? <Badge kind="required">必須</Badge> : null}
          {(badges ?? []).map((b) => (
            <Badge key={b} kind="info">
              {b}
            </Badge>
          ))}
        </div>
      ) : null}

      {toolbar.length > 0 ? (
        <div className="mb-1 flex flex-wrap items-center gap-1" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault() }}>
          {has('undo') ? (
            <>
              <button type="button" className={toolBtn} aria-label="元に戻す" onClick={() => document.execCommand('undo')}>↶</button>
              <button type="button" className={toolBtn} aria-label="やり直す" onClick={() => document.execCommand('redo')}>↷</button>
            </>
          ) : null}
          {has('name') ? (
            <span className="relative">
              <button type="button" className={toolBtn} onClick={() => setMenu(menu === 'name' ? null : 'name')}>名前</button>
              <Popover open={menu === 'name'} onClose={close} align="left">
                <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => insert('{{name}}')}>LINE登録名</button>
                <button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => insert('{{real_name}}')}>本名</button>
              </Popover>
            </span>
          ) : null}
          {has('friend') ? (
            <span className="relative">
              <button type="button" className={toolBtn} onClick={() => { setMenu(menu === 'friend' ? null : 'friend'); setFriendFolder(null) }}>友だち情報 ▾</button>
              <Popover open={menu === 'friend'} onClose={close} align="left">
                <div className="max-h-72 min-w-[14rem] overflow-y-auto">
                  {groups.length === 0 ? <p className="px-3 py-2 text-xs text-[#757578]">友だち情報欄がありません</p> : null}
                  {groups.map((g) => (
                    <div key={g.id}>
                      <button type="button" className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => setFriendFolder(friendFolder === g.id ? null : g.id)}>
                        <span>{g.name}</span>
                        <span className="text-[#9a9a9e]">{friendFolder === g.id ? '▾' : '›'}</span>
                      </button>
                      {friendFolder === g.id
                        ? g.fields.map((f) => (
                            <button key={f.fieldKey} type="button" className="block w-full bg-[#fafafb] py-1.5 pl-7 pr-3 text-left hover:bg-[#f1f1f4]" onClick={() => insert(`{{metadata.${f.fieldKey}}}`)}>
                              {f.label}
                            </button>
                          ))
                        : null}
                    </div>
                  ))}
                </div>
              </Popover>
            </span>
          ) : null}
          {has('form') ? (
            <button type="button" className={toolBtn} onClick={() => setFormOpen(true)}>回答フォーム ▾</button>
          ) : null}
          {has('date') ? (
            <span className="relative">
              <button type="button" className={toolBtn} onClick={() => setMenu(menu === 'date' ? null : 'date')}>配信日 ▾</button>
              <Popover open={menu === 'date'} onClose={close} align="left">
                {DATE_FORMAT_OPTIONS.map((o) => (
                  <button key={o.id} type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left hover:bg-[#f1f1f4]" onClick={() => insert(`{{date.${o.id}}}`)}>
                    {o.label} ({o.example})
                  </button>
                ))}
              </Popover>
            </span>
          ) : null}
          {has('other') ? (
            <button type="button" className={toolBtn} onClick={() => setOtherOpen((v) => !v)}>その他</button>
          ) : null}
          {has('emoji') ? (
            <span className="relative">
              <button type="button" className={toolBtn} aria-label="絵文字" onClick={() => setMenu(menu === 'emoji' ? null : 'emoji')}>☺</button>
              {menu === 'emoji' ? (
                <div className="absolute left-0 top-full z-30 w-72 shadow-lg">
                  <EmojiPicker onPick={(e) => ref.current?.insertText(e)} />
                </div>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {otherOpen ? (
        <div className="mb-1 space-y-2 rounded border border-[#e3e3e6] bg-[#fafafb] p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span>配信日から</span>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="h-8 rounded border border-[#cacace] px-2" aria-label="日付" />
            <span>までの日数</span>
            <button type="button" disabled={!until} onClick={() => ref.current?.insertTag(`{{date_until.${until}}}`)} className="h-8 rounded border border-[#069e04] px-2 font-bold text-[#069e04] disabled:opacity-40">＋ 挿入</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span>配信日から</span>
            <input type="number" min={0} max={9999} value={plusDays} onChange={(e) => setPlusDays(Math.max(0, Number(e.target.value) || 0))} className="h-8 w-16 rounded border border-[#cacace] px-2" aria-label="日数" />
            <span>日後の日付(フォーマット:</span>
            <select value={plusFmt} onChange={(e) => setPlusFmt(e.target.value)} className="h-8 rounded border border-[#cacace] px-2" aria-label="フォーマット">
              {DATE_FORMAT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}({o.example})
                </option>
              ))}
            </select>
            <span>)</span>
            <button type="button" onClick={() => ref.current?.insertTag(`{{date_plus.${plusDays}.${plusFmt}}}`)} className="h-8 rounded border border-[#069e04] px-2 font-bold text-[#069e04]">＋ 挿入</button>
          </div>
        </div>
      ) : null}

      <div className="rounded border border-[#cacace] bg-white focus-within:border-[#069e04]">
        <TagTextEditor
          ref={ref}
          value={value}
          onChange={onChange}
          rows={rows}
          maxHeight={rows * 26 + 20}
          maxLength={maxLength}
          fieldLabels={labels}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={label ?? 'メッセージ'}
          className="block w-full px-3 py-2 text-sm text-gray-900"
        />
      </div>
      {note || (showCounter && maxLength) ? (
        <div className="mt-1 flex items-start justify-between gap-3 text-[11px] text-[#757578]">
          <span>{note}</span>
          {showCounter && maxLength ? <span className="whitespace-nowrap tabular-nums">{[...value].length}/{maxLength}</span> : null}
        </div>
      ) : null}
      <FormTagPicker open={formOpen} onClose={() => setFormOpen(false)} onPick={(form) => setTimeout(() => ref.current?.insertFormTag(form.id), 0)} />
    </div>
  )
}
