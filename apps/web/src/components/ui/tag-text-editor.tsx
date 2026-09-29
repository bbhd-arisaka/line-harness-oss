'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { splitFormTags, formTagCode, FORM_TAG_PATTERN } from '@/lib/form-tags'
import { displayFormName } from '@/app/form-submissions/form-list'
import { useForms } from '@/components/forms/use-form-names'

export interface TagTextEditorHandle {
  focus: () => void
  /** カーソル位置に、青い枠のフォームを挿入する */
  insertFormTag: (formId: string) => void
}

const CHIP_CLASS =
  'mx-0.5 inline-block select-none rounded border border-[#2b7bb9] bg-[#eef6ff] px-1.5 text-[13px] leading-5 text-[#1d5f92] align-baseline'

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

/** 入力欄の中身 → タグコード入りの文字列(青い枠は `{{form_url:ID}}` に戻す)。 */
function serialize(root: HTMLElement): string {
  let out = ''
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? '').replace(/​/g, '')
      } else if (child instanceof HTMLElement) {
        if (child.dataset.formId) out += formTagCode(child.dataset.formId)
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

function render(root: HTMLElement, value: string, names: Map<string, string>, loaded: boolean) {
  root.textContent = ''
  for (const part of splitFormTags(value)) {
    if ('formId' in part) root.appendChild(makeChip(part.formId, names.get(part.formId), loaded))
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

/**
 * メッセージ入力欄。文章の中に `{{form_url:フォームID}}`(フォームのタグコード)を貼り付ける/入力すると、
 * 青い枠の「フォーム：○○」に変換して表示する。送信されるのは元のタグコードで、
 * サーバー側が送信アカウントのリンクに置き換える。
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
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
    onFocus?: () => void
    onBlur?: () => void
    onCompositionStart?: () => void
    onCompositionEnd?: () => void
    'aria-label'?: string
  }
>(function TagTextEditor(
  { value, onChange, placeholder, className = '', rows = 3, maxHeight = 240, disabled, onKeyDown, onFocus, onBlur, onCompositionStart, onCompositionEnd, ...rest },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { forms, loaded } = useForms()
  const namesRef = useRef(new Map<string, string>())
  namesRef.current = new Map(forms.map((f) => [f.id, f.name]))
  const loadedRef = useRef(loaded)
  loadedRef.current = loaded

  /** 文字として入力/貼り付けされたタグコードを、青い枠に置き換える。 */
  const convertTypedTags = useCallback((root: HTMLElement) => {
    const re = new RegExp(FORM_TAG_PATTERN)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const targets: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (re.test((n as Text).data)) targets.push(n as Text)
    }
    let lastInserted: Node | null = null
    for (const node of targets) {
      const parent = node.parentNode
      if (!parent) continue
      for (const part of splitFormTags(node.data)) {
        const inserted = 'formId' in part
          ? makeChip(part.formId, namesRef.current.get(part.formId), loadedRef.current)
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
    let text = serialize(root)
    if (text === '') root.textContent = '' // 空のときに残る <br> を消して、プレースホルダーを出す
    onChange(text)
  }, [convertTypedTags, onChange])

  // 外から value が変わったとき(送信後のクリアなど)だけ、表示を作り直す
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (serialize(root) !== value) render(root, value, namesRef.current, loadedRef.current)
  }, [value])

  // フォーム名の読み込みが終わったら、青い枠の表示名を更新する
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.querySelectorAll<HTMLElement>('[data-form-id]').forEach((chip) => {
      chip.textContent = chipLabel(namesRef.current.get(chip.dataset.formId ?? ''), loaded)
    })
  }, [forms, loaded])

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
  }))

  return (
    <div
      ref={rootRef}
      role="textbox"
      aria-multiline="true"
      aria-label={rest['aria-label']}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      className={`whitespace-pre-wrap break-words outline-none empty:before:pointer-events-none empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)] ${className}`}
      style={{ minHeight: `${rows * 1.5}em`, maxHeight, overflowY: 'auto' }}
      onInput={emit}
      onFocus={onFocus}
      onBlur={onBlur}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={() => { onCompositionEnd?.(); emit() }}
      onPaste={(e) => {
        // 書式を持ち込まず、文字だけ貼り付ける。フォームのタグコードは青い枠にする
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
        const nodes: Node[] = []
        for (const part of splitFormTags(text)) {
          if ('formId' in part) nodes.push(makeChip(part.formId, namesRef.current.get(part.formId), loadedRef.current))
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
        // 改行は <br> で入れる(ブラウザ任せだとブロック要素ができて文字列に戻しにくい)
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
          e.preventDefault()
          document.execCommand('insertLineBreak')
          emit()
        }
      }}
    />
  )
})
