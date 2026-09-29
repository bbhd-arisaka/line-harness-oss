'use client'

import { splitFormTags } from '@/lib/form-tags'
import { displayFormName } from '@/app/form-submissions/form-list'
import { useForms } from './use-form-names'

/** 文章の中のフォームのタグコードを、青い枠の「フォーム：○○」にして表示する(読み取り専用)。 */
export function TaggedText({ text }: { text: string }) {
  const { forms, loaded } = useForms()
  if (!text.includes('{{form_url:')) return <>{text}</>
  return (
    <>
      {splitFormTags(text).map((part, i) => {
        if ('text' in part) return <span key={i}>{part.text}</span>
        const name = forms.find((f) => f.id === part.formId)?.name
        return (
          <span
            key={i}
            className="mx-0.5 inline-block rounded border border-[#2b7bb9] bg-[#eef6ff] px-1.5 text-[13px] leading-5 text-[#1d5f92] align-baseline"
          >
            {name ? `フォーム：${displayFormName(name)}` : loaded ? 'フォーム(見つかりません)' : 'フォーム'}
          </span>
        )
      })}
    </>
  )
}
