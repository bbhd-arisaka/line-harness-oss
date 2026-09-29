'use client'

import { OPTION_TYPES, type BlockDraft, type FormDraft } from './editor-types'

const PREFECTURE_SAMPLE = '選択してください'

/** 左側のスマホ風プレビュー。編集中のセクション(+共通ヘッダ)を、デザイン設定の配色で描く。 */
export function PreviewPane({
  draft,
  section,
  selectedRowId,
  onSelect,
}: {
  draft: FormDraft
  section: number
  selectedRowId: number | null
  onSelect: (rowId: number) => void
}) {
  const accent = draft.lstep.buttonColor || draft.primaryColor || draft.themeMainColor || '#0e9aa7'
  const text = draft.themeTextColor || '#333333'
  const error = draft.themeErrorColor || '#e53e3e'
  const pageBg = draft.backgroundColor || '#f4f4f4'
  const cardBg = draft.formBackgroundColor || '#ffffff'
  const radius = draft.lstep.buttonStyle === 'rounded' ? 999 : draft.lstep.buttonStyle === 'square' ? 0 : 8

  const header = draft.blocks.filter((b) => b.section === 0)
  const body = draft.blocks.filter((b) => b.section === section && section !== 0)
  const shown = [...header, ...body]
  const isLastSection = section === draft.sectionCount || section === 0
  const numberOf = (b: BlockDraft) => {
    const list = draft.blocks.filter((x) => x.section === b.section)
    return list.findIndex((x) => x.rowId === b.rowId) + 1
  }

  return (
    <div className="h-full overflow-y-auto p-3" style={{ background: '#5b9a98' }}>
      <div className="mx-auto min-h-full max-w-[320px] rounded" style={{ background: pageBg, color: text }}>
        {draft.headerImageUrl && <img src={draft.headerImageUrl} alt="" className="w-full rounded-t object-cover" />}
        <div className="space-y-3 p-3" style={{ background: cardBg }}>
          {shown.length === 0 && <p className="py-6 text-center text-xs text-black/40">ブロックを追加するとここに表示されます</p>}
          {shown.map((b) => {
            const active = b.rowId === selectedRowId
            return (
              <div
                key={b.rowId}
                onClick={() => onSelect(b.rowId)}
                className={`relative cursor-pointer rounded p-1 ${active ? 'outline outline-2 outline-[#0e9aa7]' : ''}`}
              >
                {active && (
                  <span className="absolute -left-1 -top-1 z-10 rounded-sm bg-[#069e04] px-1 text-[10px] font-bold text-white">{numberOf(b)}</span>
                )}
                <PreviewBlock b={b} accent={accent} error={error} />
              </div>
            )
          })}
          {shown.length > 0 && section !== 0 && (
            <div className="pt-1">
              <div
                className="py-2.5 text-center text-sm font-bold text-white"
                style={{ background: accent, borderRadius: radius }}
              >
                {isLastSection ? draft.lstep.submitLabel || '送信' : draft.lstep.nextLabel || '次へ'}
              </div>
            </div>
          )}
          {shown.length === 0 && (
            <div className="py-2.5 text-center text-sm font-bold text-white opacity-60" style={{ background: accent, borderRadius: radius }}>
              {draft.lstep.submitLabel || '送信'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PreviewBlock({ b, accent, error }: { b: BlockDraft; accent: string; error: string }) {
  const title = b.label || '(タイトル未入力)'
  if (b.type === 'heading') return <h3 className="rounded px-2 py-1.5 text-sm font-bold" style={{ background: `${accent}22` }}>{title}</h3>
  if (b.type === 'subheading') return <h4 className="text-xs font-bold">{title}</h4>
  if (b.type === 'paragraph') return <p className="whitespace-pre-wrap text-xs leading-relaxed">{b.label || '(本文未入力)'}</p>
  if (b.type === 'image') {
    return b.imageUrl
      ? <img src={b.imageUrl} alt={b.label} className="w-full rounded" />
      : <div className="flex h-20 items-center justify-center rounded bg-black/10 text-xs text-black/40">画像</div>
  }
  if (b.type === 'button') {
    return <div className="rounded border py-2 text-center text-xs font-bold" style={{ borderColor: accent, color: accent }}>{b.label || 'ボタン'}</div>
  }
  return (
    <div className={b.hidden ? 'opacity-40' : ''}>
      <p className="mb-1 text-xs font-bold">
        {title}
        {b.required && <span style={{ color: error }}> *</span>}
        {b.hidden && <span className="ml-1 text-[10px] font-normal text-black/50">(非表示)</span>}
      </p>
      {b.open.description && b.description && <p className="mb-1 text-[10px] text-black/50">{b.description}</p>}
      {OPTION_TYPES.includes(b.type) && b.type !== 'select' ? (
        <div className="space-y-1">
          {(b.options.length ? b.options : ['']).map((o, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded border border-black/15 bg-white px-2 py-1 text-xs">
              <span className={`inline-block h-3 w-3 border border-black/30 ${b.type === 'radio' ? 'rounded-full' : 'rounded-sm'}`} />
              {o || '選択肢'}
            </div>
          ))}
        </div>
      ) : b.type === 'select' || b.type === 'prefecture' ? (
        <div className="rounded border border-black/15 bg-white px-2 py-1.5 text-xs text-black/50">{b.type === 'select' ? '選択してください' : PREFECTURE_SAMPLE} ▾</div>
      ) : b.type === 'textarea' ? (
        <div className="h-14 rounded border border-black/15 bg-white px-2 py-1 text-xs text-black/40">{b.placeholder}</div>
      ) : b.type === 'file' ? (
        <div className="rounded border border-dashed border-black/30 bg-white px-2 py-2 text-xs text-black/50">ファイルを選択</div>
      ) : (
        <div className="rounded border border-black/15 bg-white px-2 py-1.5 text-xs text-black/40">{b.defaultValue || b.placeholder}</div>
      )}
    </div>
  )
}
