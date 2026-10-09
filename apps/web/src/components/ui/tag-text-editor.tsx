'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import {
  splitTags,
  formTagCode,
  variableCode,
  variableLabel,
  variableChipClass,
  ANY_TAG_PATTERN,
} from '@/lib/form-tags'
import { displayFormName } from '@/app/form-submissions/form-list'
import { useForms } from '@/components/forms/use-form-names'

export interface TagTextEditorHandle {
  focus: () => void
  /** カーソル位置に、青い枠のフォームを挿入する */
  insertFormTag: (formId: string) => void
  /**
   * カーソル位置に、タグコード(`{{name}}` や `{{form_url:ID}}`)を、枠にして挿入する。
   * タグコードでなければ、ふつうの文字として入れる。
   */
  insertTag: (code: string) => void
  /** カーソル位置に、ふつうの文字(絵文字など)を挿入する */
  insertText: (text: string) => void
}

const CHIP_CLASS =
  'mx-0.5 inline-block select-none rounded border border-[#2b7bb9] bg-[#eef6ff] px-1.5 text-[13px] leading-5 text-[#1d5f92] align-baseline'

/**
 * 見えない文字(幅ゼロ)。枠の直後がいちばん端だと、ブラウザによってはその後ろに
 * カーソルを置けなくなる。幅ゼロの文字を置いて逃がし、取り出すときに除く。
 */
const ZW = '​'

function chipLabel(name: string | undefined, loaded: boolean): string {
  if (name) return `フォーム：${displayFormName(name)}`
  return loaded ? 'フォーム(見つかりません)' : 'フォーム(読み込み中)'
}

function makeChip(formId: string, name: string | undefined, loaded: boolean): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.contentEditable = 'false'
  chip.dataset.formId = formId
  chip.className = CHIP_CLASS
  chip.textContent = chipLabel(name, loaded)
  return chip
}

/**
 * 差し込み語(名前・友だち情報・予約など)の枠。
 * 画面には日本語名を出し、タグコード({{name}}など)は dataset に持つ。
 */
function makeVarChip(key: string, labels?: ReadonlyMap<string, string>): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.contentEditable = 'false'
  chip.dataset.variable = key
  chip.title = variableCode(key)
  chip.className = variableChipClass(key)
  chip.textContent = variableLabel(key, labels)
  return chip
}

/** 入力欄の中身 → タグコード入りの文字列(枠は `{{form_url:ID}}`・`{{name}}` などに戻す)。 */
function serialize(root: HTMLElement): string {
  let out = ''
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? '').replace(/​/g, '')
      } else if (child instanceof HTMLElement) {
        if (child.dataset.formId) out += formTagCode(child.dataset.formId)
        else if (child.dataset.variable) out += variableCode(child.dataset.variable)
        else if (child.tagName === 'BR') out += '\n'
        else {
          // ブラウザが Enter で作るブロック要素は改行として扱う
          if (out && !out.endsWith('\n')) out += '\n'
          walk(child)
        }
      }
    })
  }
  walk(root)
  // 末尾の改行を表すために、ブラウザが余分な <br> を1つ足す。その分は数えない。
  const last = root.lastChild
  if (last instanceof HTMLElement && last.tagName === 'BR' && out.endsWith('\n')) out = out.slice(0, -1)
  return out
}

function appendText(parent: Node, text: string, before?: Node | null) {
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (i > 0) parent.insertBefore(document.createElement('br'), before ?? null)
    if (line) parent.insertBefore(document.createTextNode(line), before ?? null)
  })
}

function render(
  root: HTMLElement,
  value: string,
  names: Map<string, string>,
  loaded: boolean,
  labels: ReadonlyMap<string, string>,
) {
  root.textContent = ''
  for (const part of splitTags(value)) {
    if ('formId' in part) root.appendChild(makeChip(part.formId, names.get(part.formId), loaded))
    else if ('variable' in part) root.appendChild(makeVarChip(part.variable, labels))
    else appendText(root, part.text)
  }
  // 末尾が改行のときは、表示上の空行を作るための <br> を足す
  if (value.endsWith('\n')) root.appendChild(document.createElement('br'))
}

function placeCaretAfter(node: Node) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

const isChip = (n: Node | null): n is HTMLElement =>
  n instanceof HTMLElement && Boolean(n.dataset.formId || n.dataset.variable)

const isEmptyText = (n: Node) =>
  n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').replace(/​/g, '') === ''

/**
 * カーソルのすぐ手前にある枠。間に空の文字や見えない文字しか無ければ、飛び越えて探す。
 *
 * 【カーソルの置かれ方が2通りある理由】
 * 文字の中にあるときと、入力欄そのもの(子の何番目の手前)にあるときがある。
 * 文字を消し切った直後は後者になるので、両方を見ないと、
 * 枠の手前でバックスペースを押しても枠が消えない。
 */
function chipBeforeCaret(): HTMLElement | null {
  const sel = window.getSelection()
  const node = sel?.anchorNode
  if (!sel || !sel.isCollapsed || !node) return null

  let cur: Node | null
  if (node.nodeType === Node.TEXT_NODE) {
    const before = (node.textContent ?? '').slice(0, sel.anchorOffset).replace(/​/g, '')
    if (before !== '') return null
    cur = node.previousSibling
  } else {
    cur = sel.anchorOffset > 0 ? node.childNodes[sel.anchorOffset - 1] ?? null : null
  }
  while (cur && isEmptyText(cur)) cur = cur.previousSibling
  return isChip(cur) ? cur : null
}

/**
 * メッセージ入力欄。文章の中のタグコードを、枠にして表示する。
 *   - `{{form_url:フォームID}}` → 青い枠の「フォーム：○○」
 *   - `{{name}}` `{{metadata.○○}}` `{{reserve.○○}}` など → 色付きの枠の日本語名
 * 送信されるのは元のタグコードで、サーバー側が送信アカウントのリンクや、
 * お客様ごとの値に置き換える。
 *
 * 【波かっこの文字をそのまま見せない理由】
 * 1文字でも消すと効かなくなる記号を、人が直接さわる必要は無い。枠にすれば、
 * バックスペース1回でまとめて消え、打ち間違いも起きない。
 */
export const TagTextEditor = forwardRef<
  TagTextEditorHandle,
  {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    className?: string
    /** 高さの目安(行数) */
    rows?: number
    maxHeight?: number
    disabled?: boolean
    /** 友だち情報欄のキー → 表示名。枠に「友だち情報：本名」のように出すのに使う */
    fieldLabels?: ReadonlyMap<string, string>
    /** 1行の欄にする。Enter での改行を入れない（貼り付けた改行も空白にする） */
    singleLine?: boolean
    /** 文字数の上限(タグコードも元の文字数で数える)。超える入力は受け付けない */
    maxLength?: number
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
    onFocus?: () => void
    onBlur?: () => void
    onCompositionStart?: () => void
    onCompositionEnd?: () => void
    'aria-label'?: string
  }
>(function TagTextEditor(
  { value, onChange, placeholder, className = '', rows = 3, maxHeight = 240, disabled, fieldLabels, singleLine, maxLength, onKeyDown, onFocus, onBlur, onCompositionStart, onCompositionEnd, ...rest },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { forms, loaded } = useForms()
  const namesRef = useRef(new Map<string, string>())
  namesRef.current = new Map(forms.map((f) => [f.id, f.name]))
  const loadedRef = useRef(loaded)
  loadedRef.current = loaded
  const labelsRef = useRef<ReadonlyMap<string, string>>(fieldLabels ?? new Map())
  labelsRef.current = fieldLabels ?? new Map()

  /** 文字として入力/貼り付けされたタグコードを、枠に置き換える。 */
  const convertTypedTags = useCallback((root: HTMLElement) => {
    const re = new RegExp(ANY_TAG_PATTERN)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const targets: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (re.test((n as Text).data)) targets.push(n as Text)
    }
    let lastInserted: Node | null = null
    for (const node of targets) {
      const parent = node.parentNode
      if (!parent) continue
      for (const part of splitTags(node.data)) {
        const inserted =
          'formId' in part
            ? makeChip(part.formId, namesRef.current.get(part.formId), loadedRef.current)
            : 'variable' in part
              ? makeVarChip(part.variable, labelsRef.current)
              : document.createTextNode(part.text)
        parent.insertBefore(inserted, node)
        lastInserted = inserted
      }
      parent.removeChild(node)
    }
    if (lastInserted) placeCaretAfter(lastInserted)
    return targets.length > 0
  }, [])

  const emit = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    convertTypedTags(root)
    const text = serialize(root)
    if (text === '') root.textContent = '' // 空のときに残る <br> を消して、プレースホルダーを出す
    onChange(text)
  }, [convertTypedTags, onChange])

  // 外から value が変わったとき(送信後のクリアなど)だけ、表示を作り直す
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (serialize(root) !== value) render(root, value, namesRef.current, loadedRef.current, labelsRef.current)
  }, [value])

  // フォーム名の読み込みが終わったら、青い枠の表示名を更新する
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.querySelectorAll<HTMLElement>('[data-form-id]').forEach((chip) => {
      chip.textContent = chipLabel(namesRef.current.get(chip.dataset.formId ?? ''), loaded)
    })
  }, [forms, loaded])

  // 友だち情報欄の名前が読めたら、「友だち情報：○○」の枠の表示名を更新する
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.querySelectorAll<HTMLElement>('[data-variable]').forEach((chip) => {
      chip.textContent = variableLabel(chip.dataset.variable ?? '', labelsRef.current)
    })
  }, [fieldLabels])

  /** 上限まであと何文字入れられるか。上限が無ければ無制限 */
  const remaining = () => {
    if (!maxLength) return Infinity
    const root = rootRef.current
    return root ? maxLength - [...serialize(root)].length : Infinity
  }

  const insertNodes = (nodes: Node[]) => {
    const root = rootRef.current
    if (!root) return
    root.focus()
    const sel = window.getSelection()
    let range: Range
    if (sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      range = sel.getRangeAt(0)
      range.deleteContents()
    } else {
      range = document.createRange()
      range.selectNodeContents(root)
      range.collapse(false)
    }
    let last: Node | null = null
    for (const node of nodes) {
      range.insertNode(node)
      range.setStartAfter(node)
      range.collapse(true)
      last = node
    }
    if (last) placeCaretAfter(last)
    emit()
  }

  useImperativeHandle(ref, () => ({
    focus: () => rootRef.current?.focus(),
    insertFormTag: (formId: string) => {
      insertNodes([makeChip(formId, namesRef.current.get(formId), loadedRef.current), document.createTextNode(' ')])
    },
    insertTag: (code: string) => {
      const parts = splitTags(code)
      const only = parts.length === 1 ? parts[0] : null
      if (only && 'variable' in only) {
        insertNodes([makeVarChip(only.variable, labelsRef.current), document.createTextNode(ZW)])
      } else if (only && 'formId' in only) {
        insertNodes([makeChip(only.formId, namesRef.current.get(only.formId), loadedRef.current), document.createTextNode(' ')])
      } else {
        const frag = document.createDocumentFragment()
        appendText(frag, code)
        insertNodes(Array.from(frag.childNodes))
      }
    },
    insertText: (text: string) => {
      const frag = document.createDocumentFragment()
      appendText(frag, text)
      insertNodes(Array.from(frag.childNodes))
    },
  }))

  return (
    <div
      ref={rootRef}
      role="textbox"
      aria-multiline={singleLine ? 'false' : 'true'}
      aria-label={rest['aria-label']}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      className={`whitespace-pre-wrap break-words outline-none empty:before:pointer-events-none empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)] ${className}`}
      style={{ minHeight: `${rows * 1.5}em`, maxHeight, overflowY: 'auto' }}
      onBeforeInput={(e) => {
        // 上限に達していたら、これ以上の入力は受け付けない（削除・取り消しは通す）
        if (!maxLength) return
        const type = (e.nativeEvent as InputEvent).inputType
        if (type.startsWith('insert') && remaining() <= 0) e.preventDefault()
      }}
      onInput={emit}
      onFocus={onFocus}
      onBlur={onBlur}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={() => { onCompositionEnd?.(); emit() }}
      onPaste={(e) => {
        // 書式を持ち込まず、文字だけ貼り付ける。タグコードは枠にする
        e.preventDefault()
        let text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
        if (singleLine) text = text.replace(/\n/g, ' ')
        // 上限があるときは、入る分だけ貼り付ける（タグコードの途中で切れないよう、枠にする前の文字で数える）
        const room = remaining()
        if (Number.isFinite(room)) text = [...text].slice(0, Math.max(0, room)).join('')
        const nodes: Node[] = []
        for (const part of splitTags(text)) {
          if ('formId' in part) nodes.push(makeChip(part.formId, namesRef.current.get(part.formId), loadedRef.current))
          else if ('variable' in part) nodes.push(makeVarChip(part.variable, labelsRef.current))
          else {
            const frag = document.createDocumentFragment()
            appendText(frag, part.text)
            nodes.push(...Array.from(frag.childNodes))
          }
        }
        insertNodes(nodes)
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        // 枠の直後でバックスペースを押したら、枠ごと消す
        // (間に見えない文字が挟まっていると、そのままでは2回押さないと消えない)
        if (e.key === 'Backspace' && !e.nativeEvent.isComposing) {
          const chip = chipBeforeCaret()
          if (chip) {
            e.preventDefault()
            chip.remove()
            emit()
            return
          }
        }
        // 改行は <br> で入れる(ブラウザ任せだとブロック要素ができて文字列に戻しにくい)
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
          e.preventDefault()
          if (singleLine) return
          document.execCommand('insertLineBreak')
          emit()
        }
      }}
    />
  )
})
