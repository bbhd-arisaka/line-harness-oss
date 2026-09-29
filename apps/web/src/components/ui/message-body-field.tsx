'use client'

import { useRef, useState } from 'react'
import { InputArea } from '@cloudflare/kumo/components/input'
import { TagTextEditor, type TagTextEditorHandle } from '@/components/ui/tag-text-editor'
import { FormTagPicker } from '@/components/forms/form-tag-picker'

/**
 * メッセージ本文の入力欄。
 * - テキスト: フォームのタグコード(`{{form_url:ID}}`)を貼り付けると、青い枠の「フォーム：○○」に変換して表示する。
 *   「フォームを挿入」ボタンで、フォルダ付きの選択画面から入れることもできる。
 * - Flex / 画像などの JSON: そのままの入力欄(JSON の中はタグコードのまま)。
 */
export function MessageBodyField({
  label,
  value,
  onChange,
  messageType = 'text',
  placeholder,
  rows = 4,
  required,
  description,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  messageType?: string
  placeholder?: string
  rows?: number
  required?: boolean
  description?: string
}) {
  const editorRef = useRef<TagTextEditorHandle>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  if (messageType !== 'text') {
    return (
      <InputArea
        label={label}
        required={required}
        description={description}
        className="font-mono"
        minRows={rows}
        placeholder={placeholder}
        value={value}
        onValueChange={onChange}
        aria-label={label ?? 'メッセージ内容'}
      />
    )
  }

  return (
    <div>
      {label ? (
        <div className="mb-1 text-sm font-medium text-kumo-strong">
          {label}
          {required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </div>
      ) : null}
      <div className="rounded-lg border border-kumo-line bg-white focus-within:border-[#069e04] focus-within:ring-2 focus-within:ring-green-100">
        <TagTextEditor
          ref={editorRef}
          value={value}
          onChange={onChange}
          rows={rows}
          maxHeight={320}
          placeholder={placeholder}
          aria-label={label ?? 'メッセージ内容'}
          className="block w-full px-3 py-2 text-sm text-gray-900"
        />
        <div className="flex items-center justify-between border-t border-kumo-line px-2 py-1">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="rounded px-2 py-1 text-xs text-[#2b7bb9] hover:bg-[#eef6ff]"
          >
            ＋ 回答フォームを挿入
          </button>
          <span className="text-[11px] text-gray-400">送信時に、送信アカウント用のフォームリンクに変換されます</span>
        </div>
      </div>
      <FormTagPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(form) => setTimeout(() => editorRef.current?.insertFormTag(form.id), 0)}
      />
    </div>
  )
}
