'use client'

import { memo, useMemo } from 'react'
import {
  BORDER_WIDTH,
  ICON_SIZE,
  IMAGE_WIDTH,
  bubbleWidthOf,
  colorOf,
  fontSizeOf,
  parseAspectRatio,
  parseFlexMessages,
  parseGradient,
  parseLength,
  px,
  rgbaCss,
  type Length,
} from '@/lib/flex-style'

/**
 * Flex Message(カード・カルーセル)を、お客様のLINEの見た目に合わせて描く。
 * 対応: バブル・カルーセル / box(縦・横・baseline・絶対位置・グラデーション・角丸・枠線) / text(span・色・太字・折り返し・行数)
 *       / image(縦横比・cover・contain) / button(primary・secondary・link) / icon / separator / spacer / filler。
 * 複数のメッセージを1件で記録したもの(lineMessages: テキスト・画像・カードが混ざる)も、届いた順に出す。
 * 値の読み取り(キーワード→px、グラデーション、本文の分解)は lib/flex-style.ts(アプリと同じ内容)。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlexNode = Record<string, any> & { type?: string }

const TEXT_COLOR = '#111111'
const SEPARATOR_COLOR = '#b7b7b7'
const PRIMARY = '#17c950'
const SECONDARY_BG = '#dcdfe5'
const LINK = '#42659a'

function isRow(layout: unknown): boolean {
  return layout === 'horizontal' || layout === 'baseline'
}

function css(l: Length | null): string | undefined {
  if (!l) return undefined
  return 'px' in l ? `${l.px}px` : `${l.pct}%`
}

function kids(n: FlexNode): FlexNode[] {
  return Array.isArray(n.contents) ? (n.contents as FlexNode[]).filter((c) => c && typeof c === 'object') : []
}

function gradientCss(bg: unknown): string | undefined {
  const g = parseGradient(bg)
  if (!g) return undefined
  const stops = g.center
    ? `${rgbaCss(g.start)} 0%, ${rgbaCss(g.center.color)} ${Math.round(g.center.position * 100)}%, ${rgbaCss(g.end)} 100%`
    : `${rgbaCss(g.start)}, ${rgbaCss(g.end)}`
  return `linear-gradient(${g.angle}deg, ${stops})`
}


function FlexText({ node }: { node: FlexNode }) {
  const size = fontSizeOf(node.size)
  const spans = Array.isArray(node.contents) ? (node.contents as FlexNode[]) : null
  const oneLine = node.wrap !== true // LINE の既定は、折り返さない(wrap: true で折り返す)
  const maxLines = typeof node.maxLines === 'number' && node.maxLines > 0 ? node.maxLines : undefined
  const style: React.CSSProperties = {
    fontSize: size,
    fontWeight: node.weight === 'bold' ? 700 : 400,
    color: colorOf(node.color) ?? TEXT_COLOR,
    margin: 0,
    lineHeight: `${Math.round(size * 1.4) + (px(node.lineSpacing) ?? 0)}px`,
    textAlign: node.align === 'center' ? 'center' : node.align === 'end' ? 'right' : 'left',
    wordBreak: 'break-word',
    whiteSpace: oneLine && !maxLines ? 'nowrap' : 'pre-wrap',
    ...(oneLine && !maxLines ? { overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
    ...(maxLines ? { display: '-webkit-box', WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
  }
  return (
    <p style={style}>
      {spans && spans.length > 0
        ? spans.map((s, i) => (
            <span
              key={i}
              style={{
                ...(s.size !== undefined ? { fontSize: fontSizeOf(s.size) } : {}),
                ...(colorOf(s.color) ? { color: colorOf(s.color) } : {}),
                ...(s.weight === 'bold' ? { fontWeight: 700 } : s.weight === 'regular' ? { fontWeight: 400 } : {}),
                ...(s.style === 'italic' ? { fontStyle: 'italic' } : {}),
                ...(s.decoration === 'underline' ? { textDecoration: 'underline' } : s.decoration === 'line-through' ? { textDecoration: 'line-through' } : {}),
              }}
            >
              {typeof s.text === 'string' ? s.text : ''}
            </span>
          ))
        : typeof node.text === 'string'
          ? node.text
          : ''}
    </p>
  )
}

function FlexButton({ node }: { node: FlexNode }) {
  const style = node.style === 'primary' ? 'primary' : node.style === 'secondary' ? 'secondary' : 'link'
  const color = colorOf(node.color)
  const sm = node.height === 'sm'
  const label = typeof node.action?.label === 'string' ? node.action.label : ''
  const box: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: sm ? 40 : 52,
    padding: '0 12px',
    borderRadius: 8,
    fontSize: sm ? 14 : 16,
    fontWeight: style === 'link' ? 400 : 700,
    textAlign: 'center',
    backgroundColor: style === 'primary' ? (color ?? PRIMARY) : style === 'secondary' ? (color ?? SECONDARY_BG) : 'transparent',
    color: style === 'primary' ? '#ffffff' : style === 'secondary' ? (color ? '#ffffff' : TEXT_COLOR) : (color ?? LINK),
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }
  return <div style={box}>{label}</div>
}

function FlexImage({ node }: { node: FlexNode }) {
  const url = typeof node.url === 'string' ? node.url : ''
  if (!url) return null
  const ratio = parseAspectRatio(node.aspectRatio) ?? 1
  const size = typeof node.size === 'string' ? node.size : undefined
  const widthKeyword = size && size !== 'full' ? IMAGE_WIDTH[size] : undefined
  const radius = px(node.cornerRadius)
  const bg = colorOf(node.backgroundColor)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      style={{
        display: 'block',
        width: widthKeyword ?? '100%',
        maxWidth: '100%',
        aspectRatio: String(ratio),
        objectFit: node.aspectMode === 'cover' ? 'cover' : 'contain',
        ...(radius != null ? { borderRadius: radius } : {}),
        ...(bg ? { backgroundColor: bg } : {}),
      }}
    />
  )
}

function FlexIcon({ node }: { node: FlexNode }) {
  const url = typeof node.url === 'string' ? node.url : ''
  if (!url) return null
  const size = typeof node.size === 'string' && node.size in ICON_SIZE ? ICON_SIZE[node.size] : (px(node.size) ?? ICON_SIZE.md)
  const ratio = parseAspectRatio(node.aspectRatio) ?? 1
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" style={{ display: 'block', width: size, height: size / ratio, objectFit: 'contain' }} />
}

/** 子が、親の中でどう伸びるか(横並び: flex の比率 [既定1・0は中身の幅]、縦並び: flex があるときだけ高さを分ける) */
function itemStyle(child: FlexNode, parentLayout: unknown): React.CSSProperties {
  const f = typeof child.flex === 'number' ? child.flex : undefined
  const s: React.CSSProperties = { minWidth: 0 }
  if (isRow(parentLayout)) {
    if (child.type === 'icon' || child.type === 'spacer' || child.type === 'separator') s.flex = '0 0 auto'
    else {
      const v = f ?? 1
      s.flex = v === 0 ? '0 1 auto' : `${v} 1 0%`
    }
    if (child.gravity === 'center') s.alignSelf = 'center'
    else if (child.gravity === 'bottom') s.alignSelf = 'flex-end'
  } else {
    s.flex = f !== undefined && f > 0 ? `${f} 1 0%` : '0 0 auto'
    if (child.align === 'center') s.alignSelf = 'center'
    else if (child.align === 'end') s.alignSelf = 'flex-end'
  }
  return s
}

function FlexBox({ node }: { node: FlexNode }) {
  const row = isRow(node.layout)
  const spacing = px(node.spacing) ?? 0
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: row ? 'row' : 'column',
    boxSizing: 'border-box',
    position: 'relative',
    overflow: 'hidden',
  }
  const bg = colorOf(node.backgroundColor)
  if (bg) style.backgroundColor = bg
  const gradient = gradientCss(node.background)
  if (gradient) style.backgroundImage = gradient
  const radius = px(node.cornerRadius)
  if (radius != null) style.borderRadius = radius
  const bw = typeof node.borderWidth === 'string' ? (node.borderWidth in BORDER_WIDTH ? BORDER_WIDTH[node.borderWidth] : px(node.borderWidth)) : null
  if (bw) style.border = `${bw}px solid ${colorOf(node.borderColor) ?? '#e0e0e0'}`
  const pad = px(node.paddingAll)
  if (pad != null) style.padding = pad
  const t = px(node.paddingTop)
  const b = px(node.paddingBottom)
  const s = px(node.paddingStart)
  const e = px(node.paddingEnd)
  if (t != null) style.paddingTop = t
  if (b != null) style.paddingBottom = b
  if (s != null) style.paddingLeft = s
  if (e != null) style.paddingRight = e
  const w = css(parseLength(node.width))
  const h = css(parseLength(node.height))
  if (w) style.width = w
  if (h) style.height = h
  const mw = css(parseLength(node.maxWidth))
  const mh = css(parseLength(node.maxHeight))
  if (mw) style.maxWidth = mw
  if (mh) style.maxHeight = mh
  if (node.layout === 'baseline') style.alignItems = 'baseline'
  if (node.justifyContent) {
    const j = node.justifyContent
    style.justifyContent = j === 'center' ? 'center' : j === 'flex-end' ? 'flex-end' : j === 'space-between' ? 'space-between' : j === 'space-around' ? 'space-around' : j === 'space-evenly' ? 'space-evenly' : 'flex-start'
  }
  if (node.alignItems) {
    const a = node.alignItems
    style.alignItems = a === 'center' ? 'center' : a === 'flex-end' ? 'flex-end' : a === 'flex-start' ? 'flex-start' : 'stretch'
  }
  const list = kids(node)
  return (
    <div style={style}>
      {list.map((c, i) => {
        if (c.position === 'absolute') {
          const pos: React.CSSProperties = { position: 'absolute', boxSizing: 'border-box' }
          const top = css(parseLength(c.offsetTop))
          const bottom = css(parseLength(c.offsetBottom))
          const start = css(parseLength(c.offsetStart))
          const end = css(parseLength(c.offsetEnd))
          if (top) pos.top = top
          if (bottom) pos.bottom = bottom
          if (start) pos.left = start
          if (end) pos.right = end
          const cw = css(parseLength(c.width))
          if (cw) pos.width = cw
          return (
            <div key={i} style={pos}>
              <FlexNode node={{ ...c, position: undefined, width: undefined }} />
            </div>
          )
        }
        // 子どうしの間隔(spacing)。margin の指定があれば、そちらを優先する
        const m = c.margin !== undefined ? px(c.margin) : i === 0 ? 0 : spacing
        const space: React.CSSProperties = i === 0 ? {} : { [row ? 'marginLeft' : 'marginTop']: m ?? 0 }
        return (
          <div key={i} style={{ ...itemStyle(c, node.layout), ...space }}>
            <FlexNode node={c} />
          </div>
        )
      })}
    </div>
  )
}

function FlexNode({ node }: { node: FlexNode }) {
  switch (node.type) {
    case 'box':
      return <FlexBox node={node} />
    case 'text':
      return <FlexText node={node} />
    case 'image':
      return <FlexImage node={node} />
    case 'icon':
      return <FlexIcon node={node} />
    case 'button':
      return <FlexButton node={node} />
    case 'separator':
      return <div style={{ height: 1, backgroundColor: colorOf(node.color) ?? SEPARATOR_COLOR }} />
    case 'spacer': {
      const sizes: Record<string, number> = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 40 }
      const v = sizes[typeof node.size === 'string' ? node.size : 'md'] ?? 16
      return <div style={{ height: v, width: v }} />
    }
    case 'filler':
      return <div style={{ flexGrow: 1 }} />
    default:
      return null
  }
}

/** バブル1枚: hero・header・body・footer を縦に並べる。角丸・影つき、白地(styles で上書きできる) */
function FlexBubble({ bubble, maxWidth, fixedWidth }: { bubble: FlexNode; maxWidth?: number; fixedWidth?: boolean }) {
  const sizeW = bubbleWidthOf(bubble.size)
  const w = maxWidth ? Math.min(sizeW, maxWidth) : sizeW
  const styles = (bubble.styles ?? {}) as Record<string, Record<string, unknown> | undefined>
  const block = (key: 'header' | 'body' | 'footer') => {
    const n = bubble[key] as FlexNode | undefined
    if (!n) return null
    const bg = colorOf(styles[key]?.backgroundColor) ?? colorOf(n.backgroundColor)
    // ブロック自身の padding の既定は 16(box 側に padding の指定があれば、box 側が持つ)
    const hasOwnPad = ['paddingAll', 'paddingTop', 'paddingBottom', 'paddingStart', 'paddingEnd'].some((k) => n[k] !== undefined)
    return (
      <div
        style={{
          ...(bg ? { backgroundColor: bg } : {}),
          ...(hasOwnPad ? {} : { padding: 16 }),
          // 本文は伸びて、フッターのボタンを下にそろえる(カルーセルで高さがそろうとき)
          ...(key === 'body' ? { flex: '1 0 auto' } : {}),
        }}
      >
        <FlexBox node={{ ...n, backgroundColor: undefined }} />
      </div>
    )
  }
  const hero = bubble.hero as FlexNode | undefined
  const heroBg = colorOf(styles.hero?.backgroundColor)
  return (
    <div
      style={{
        ...(fixedWidth ? { width: w, flex: '0 0 auto' } : { width: '100%', maxWidth: w }),
        backgroundColor: '#ffffff',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {hero ? <div style={heroBg ? { backgroundColor: heroBg } : undefined}><FlexNode node={hero} /></div> : null}
      {block('header')}
      {block('body')}
      {block('footer')}
    </div>
  )
}

function FlexCard({ flex, maxWidth }: { flex: unknown; maxWidth?: number }) {
  if (!flex || typeof flex !== 'object') return null
  const node = flex as FlexNode
  if (node.type === 'carousel' && Array.isArray(node.contents)) {
    // 高さをそろえる(いちばん高いカードに合わせ、フッターのボタンが下に並ぶ)。はみ出す分は、横にスクロール
    return (
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 0', maxWidth: '100%', alignItems: 'stretch' }}>
        {(node.contents as FlexNode[]).map((b, i) => (
          <FlexBubble key={i} bubble={b} maxWidth={maxWidth} fixedWidth />
        ))}
      </div>
    )
  }
  if (node.type === 'bubble') return <FlexBubble bubble={node} maxWidth={maxWidth} />
  return null
}

function FlexPreview({ content, maxWidth }: { content: string; maxWidth?: number }) {
  // 入力のたびに再描画されないよう、読み取りは覚えておく
  const items = useMemo(() => parseFlexMessages(content), [content])
  if (items.length === 0) {
    // 吹き出しなしで描画されることがあるので、背景を自前で持つ
    return <p className="rounded-lg bg-white px-3 py-2 text-xs text-red-600">カードの内容を読み取れませんでした</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '100%' }}>
      {items.map((it, i) => {
        if (it.kind === 'flex') return <FlexCard key={i} flex={it.flex} maxWidth={maxWidth} />
        if (it.kind === 'text') {
          return (
            <div key={i} className="max-w-[85%] self-start whitespace-pre-wrap break-words rounded-2xl bg-white px-3 py-2 text-sm text-gray-900">
              {it.text}
            </div>
          )
        }
        if (it.kind === 'image' && it.imageUrl) {
          // eslint-disable-next-line @next/next/no-img-element
          return <img key={i} src={it.imageUrl} alt="" style={{ maxWidth: 240, borderRadius: 10 }} />
        }
        return (
          <span key={i} className="text-xs text-gray-500">
            {it.text}
          </span>
        )
      })}
    </div>
  )
}

export default memo(FlexPreview)
