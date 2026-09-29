'use client'

/** 友だち情報・フォーム回答の「値」の表示。添付ファイルはサムネイル/リンク、選択肢は色付きで出す。 */
export interface FieldValueDef {
  fieldType?: string
  options?: string[]
  optionColors?: string[]
}

const UPLOAD_MARK = '/api/form-uploads/'

export function isUploadedFileUrl(v: unknown): v is string {
  return typeof v === 'string' && v.includes(UPLOAD_MARK)
}

function FileValue({ url }: { url: string }) {
  const isPdf = /\.pdf(\?|$)/i.test(url)
  if (isPdf) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#2b7bb9] underline">
        <span aria-hidden="true">📄</span> PDFを開く
      </a>
    )
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-block">
      <img src={url} alt="添付画像" loading="lazy" className="max-h-32 max-w-full rounded border border-[#dcdce0] object-contain" />
    </a>
  )
}

export function FieldValue({ value, def }: { value: unknown; def?: FieldValueDef }) {
  if (value === null || value === undefined || value === '') return <span>-</span>
  if (isUploadedFileUrl(value)) return <FileValue url={value} />
  if (Array.isArray(value) && value.length > 0 && value.every(isUploadedFileUrl)) {
    return <span className="flex flex-wrap gap-2">{value.map((u) => <FileValue key={u} url={u} />)}</span>
  }

  const text = Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)

  // 選択肢型で色が設定されていれば、色付きのバッジで表示する
  const colors = def?.optionColors ?? []
  const options = def?.options ?? []
  if (options.length > 0 && colors.some(Boolean)) {
    const parts = text.split(', ')
    return (
      <span className="flex flex-wrap gap-1">
        {parts.map((p) => {
          const color = colors[options.indexOf(p)]
          return (
            <span key={p} className="inline-flex items-center gap-1 rounded bg-[#f1f1f4] px-1.5 py-0.5">
              {color ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> : null}
              {p}
            </span>
          )
        })}
      </span>
    )
  }
  return <span className="whitespace-pre-wrap break-words">{text}</span>
}
