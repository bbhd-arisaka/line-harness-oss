import Link from 'next/link'

/** トークに残る「回答結果を見る」カードの内容(messages_log.content の JSON) */
export interface FormAnswerCardContent {
  formId: string
  formName: string
  submissionId: string
  title: string
  body: string
  buttonLabel: string
}

export function parseFormAnswerCard(content: string): FormAnswerCardContent | null {
  try {
    const v = JSON.parse(content) as Partial<FormAnswerCardContent> | null
    if (!v || typeof v.formId !== 'string' || typeof v.submissionId !== 'string') return null
    return {
      formId: v.formId,
      formName: typeof v.formName === 'string' ? v.formName : '',
      submissionId: v.submissionId,
      title: typeof v.title === 'string' ? v.title : '',
      body: typeof v.body === 'string' ? v.body : '',
      buttonLabel: typeof v.buttonLabel === 'string' && v.buttonLabel ? v.buttonLabel : '回答結果を見る',
    }
  } catch {
    return null
  }
}

/** お客様から届いた、フォームの回答カード。ボタンで、その回答の詳細(Web版の回答一覧)を開く */
export default function FormAnswerCard({ content }: { content: string }) {
  const card = parseFormAnswerCard(content)
  if (!card) return <span>[フォーム回答]</span>
  return (
    <div className="w-64 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-sm">
      <div className="space-y-1 px-4 py-3">
        <p className="break-words text-sm font-bold">{card.title}</p>
        {card.body ? <p className="whitespace-pre-wrap break-words text-xs text-gray-600">{card.body}</p> : null}
      </div>
      <div className="border-t border-gray-100 px-3 py-2">
        <Link
          href={`/form-submissions/answers?id=${encodeURIComponent(card.formId)}&submission=${encodeURIComponent(card.submissionId)}`}
          className="block rounded-md bg-green-600 px-3 py-2 text-center text-sm font-bold text-white hover:bg-green-700"
        >
          {card.buttonLabel}
        </Link>
      </div>
    </div>
  )
}
