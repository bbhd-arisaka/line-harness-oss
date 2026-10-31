import { memo, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View, type DimensionValue, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import {
  BORDER_WIDTH,
  ICON_SIZE,
  IMAGE_WIDTH,
  SPACE,
  bubbleWidthOf,
  colorOf,
  fontSizeOf,
  gradientColorAt,
  parseAspectRatio,
  parseFlexMessages,
  parseGradient,
  parseLength,
  px,
  rgbaCss,
  type FlexMessageItem,
  type Length,
} from '../lib/flex-style';

/**
 * カード(Flex メッセージ)を、お客様のLINEの見た目に合わせて描く。トークの吹き出しの代わりに、そのまま置く。
 * 対応: バブル・カルーセル / box(縦・横・baseline・絶対位置・グラデーション・角丸・枠線) / text(span・色・太字・折り返し・行数)
 *       / image(縦横比・cover・contain) / button(primary・secondary・link) / icon / separator / spacer / filler。
 * ※ 見るだけ。ボタンや画像を押しても、開かない(管理画面では、お客様に何が届いたかを確かめる用途)。
 */
type Node = Record<string, unknown> & { type?: string };

const TEXT_COLOR = '#111111';
const SEPARATOR_COLOR = '#b7b7b7';
const PRIMARY = '#17c950';
const SECONDARY_BG = '#dcdfe5';
const LINK = '#42659a';

function isRow(layout: unknown): boolean {
  return layout === 'horizontal' || layout === 'baseline';
}

function lengthStyle(l: Length | null): DimensionValue | undefined {
  if (!l) return undefined;
  return 'px' in l ? l.px : (`${l.pct}%` as DimensionValue);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function children(n: Node): Node[] {
  return Array.isArray(n.contents) ? (n.contents as Node[]).filter((c) => c && typeof c === 'object') : [];
}

/** 子の、親の中での「伸び方」。横並びの親: flex の比率(既定1。0は中身の幅)。縦並びの親: flex があるときだけ高さを分ける */
function flexStyle(child: Node, parentLayout: unknown): ViewStyle {
  const f = typeof child.flex === 'number' ? child.flex : undefined;
  if (isRow(parentLayout)) {
    // アイコン・余白・区切り線は、中身の大きさ(伸びない)
    if (child.type === 'icon' || child.type === 'spacer' || child.type === 'separator') return { flexGrow: 0, flexShrink: 0 };
    const v = f ?? 1;
    return v === 0 ? { flexGrow: 0, flexShrink: 1 } : { flexGrow: v, flexShrink: 1, flexBasis: 0 };
  }
  if (f !== undefined && f > 0) return { flexGrow: f, flexShrink: 1, flexBasis: 0 };
  return { flexGrow: 0, flexShrink: 0 };
}

/** 親の中での、子の margin(最初の子には付けない) */
function marginStyle(child: Node, parentLayout: unknown, index: number): ViewStyle {
  if (index === 0) return {};
  const m = px(child.margin);
  if (m == null) return {};
  return isRow(parentLayout) ? { marginLeft: m } : { marginTop: m };
}

/** 子の、親の中での位置合わせ(縦並びの親: align = 左右、横並びの親: gravity = 上下) */
function selfAlign(child: Node, parentLayout: unknown): ViewStyle {
  if (isRow(parentLayout)) {
    const g = child.gravity;
    if (g === 'center') return { alignSelf: 'center' };
    if (g === 'bottom') return { alignSelf: 'flex-end' };
    return {};
  }
  const a = child.align;
  if (a === 'center') return { alignSelf: 'center' };
  if (a === 'end') return { alignSelf: 'flex-end' };
  return {};
}

function positionStyle(n: Node): ViewStyle {
  if (n.position !== 'absolute') return {};
  const s: ViewStyle = { position: 'absolute' };
  const top = lengthStyle(parseLength(n.offsetTop));
  const bottom = lengthStyle(parseLength(n.offsetBottom));
  const start = lengthStyle(parseLength(n.offsetStart));
  const end = lengthStyle(parseLength(n.offsetEnd));
  if (top !== undefined) s.top = top;
  if (bottom !== undefined) s.bottom = bottom;
  if (start !== undefined) s.left = start;
  if (end !== undefined) s.right = end;
  return s;
}

function sizeStyle(n: Node): ViewStyle {
  const s: ViewStyle = {};
  const w = lengthStyle(parseLength(n.width));
  const h = lengthStyle(parseLength(n.height));
  if (w !== undefined) s.width = w;
  if (h !== undefined) s.height = h;
  const maxW = lengthStyle(parseLength(n.maxWidth));
  const maxH = lengthStyle(parseLength(n.maxHeight));
  if (maxW !== undefined) s.maxWidth = maxW;
  if (maxH !== undefined) s.maxHeight = maxH;
  return s;
}

/** グラデーションを、細い帯を重ねて描く(専用の部品を足さずに済ませるため。角度は上下・左右の4方向に丸める) */
function Gradient({ bg }: { bg: unknown }) {
  const g = parseGradient(bg);
  if (!g) return null;
  const a = ((g.angle % 360) + 360) % 360;
  // CSS と同じ: 0deg=下から上へ(開始色が下)、90deg=左から右へ、180deg=上から下へ、270deg=右から左へ
  const vertical = a < 45 || a >= 315 || (a >= 135 && a < 225);
  const reversed = vertical ? a >= 135 && a < 225 : a >= 225 && a < 315;
  const STEPS = 24;
  const slices = [];
  for (let i = 0; i < STEPS; i++) {
    // 0 番目の帯が、開始色
    const t = (i + 0.5) / STEPS;
    const color = rgbaCss(gradientColorAt(g, t));
    // 帯を置く向き。上→下に並べるとき、開始色が下なら、並びを逆にする
    const posFromStart = i / STEPS;
    const style: ViewStyle = vertical
      ? { position: 'absolute', left: 0, right: 0, height: `${100 / STEPS + 1}%`, [reversed ? 'top' : 'bottom']: `${posFromStart * 100}%`, backgroundColor: color }
      : { position: 'absolute', top: 0, bottom: 0, width: `${100 / STEPS + 1}%`, [reversed ? 'right' : 'left']: `${posFromStart * 100}%`, backgroundColor: color };
    slices.push(<View key={i} pointerEvents="none" style={style} />);
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {slices}
    </View>
  );
}

function FlexText({ node }: { node: Node }) {
  const spans = Array.isArray(node.contents) ? (node.contents as Node[]) : null;
  const size = fontSizeOf(node.size);
  const weight: TextStyle['fontWeight'] = node.weight === 'bold' ? '700' : '400';
  const align = node.align === 'center' ? 'center' : node.align === 'end' ? 'right' : 'left';
  const lineSpacing = px(node.lineSpacing);
  const style: TextStyle = {
    fontSize: size,
    fontWeight: weight,
    color: colorOf(node.color) ?? TEXT_COLOR,
    textAlign: align,
    lineHeight: Math.round(size * 1.4) + (lineSpacing ?? 0),
  };
  const maxLines = typeof node.maxLines === 'number' && node.maxLines > 0 ? node.maxLines : undefined;
  const oneLine = node.wrap !== true; // LINE の既定は、折り返さない(wrap: true で折り返す)
  return (
    <Text style={style} numberOfLines={maxLines ?? (oneLine ? 1 : undefined)} ellipsizeMode="tail">
      {spans && spans.length > 0
        ? spans.map((s, i) => {
            const st: TextStyle = {};
            if (s.size !== undefined) st.fontSize = fontSizeOf(s.size);
            if (colorOf(s.color)) st.color = colorOf(s.color);
            if (s.weight === 'bold') st.fontWeight = '700';
            else if (s.weight === 'regular') st.fontWeight = '400';
            if (s.style === 'italic') st.fontStyle = 'italic';
            if (s.decoration === 'underline') st.textDecorationLine = 'underline';
            else if (s.decoration === 'line-through') st.textDecorationLine = 'line-through';
            return (
              <Text key={i} style={st}>
                {str(s.text) ?? ''}
              </Text>
            );
          })
        : (str(node.text) ?? '')}
    </Text>
  );
}

function FlexButton({ node }: { node: Node }) {
  const style = node.style === 'primary' ? 'primary' : node.style === 'secondary' ? 'secondary' : 'link';
  const color = colorOf(node.color);
  const label = str((node.action as Node | undefined)?.label) ?? '';
  const h = node.height === 'sm' ? 40 : 52;
  const box: ViewStyle = { minHeight: h, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 };
  if (style === 'primary') box.backgroundColor = color ?? PRIMARY;
  else if (style === 'secondary') box.backgroundColor = colorOf(node.color) ? color : SECONDARY_BG;
  const textColor = style === 'primary' ? '#ffffff' : style === 'secondary' ? (color ? '#ffffff' : TEXT_COLOR) : (color ?? LINK);
  return (
    <View style={box}>
      <Text style={{ color: textColor, fontSize: node.height === 'sm' ? 14 : 16, fontWeight: style === 'link' ? '400' : '700', textAlign: 'center' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function FlexImage({ node, parentRow, inBubbleHero }: { node: Node; parentRow: boolean; inBubbleHero?: boolean }) {
  const url = str(node.url);
  if (!url) return null;
  const ratio = parseAspectRatio(node.aspectRatio) ?? 1;
  const mode = node.aspectMode === 'cover' ? 'cover' : 'contain';
  const size = str(node.size);
  const widthKeyword = size && size !== 'full' ? IMAGE_WIDTH[size] : undefined;
  const radius = px(node.cornerRadius);
  const style: ImageStyle = {
    aspectRatio: ratio,
    ...(radius != null ? { borderRadius: radius } : {}),
    ...(widthKeyword != null ? { width: widthKeyword } : parentRow && !inBubbleHero ? { width: '100%' } : { width: '100%' }),
  };
  const bg = colorOf(node.backgroundColor);
  return <Image source={{ uri: url }} resizeMode={mode} style={[style, bg ? { backgroundColor: bg } : null]} accessibilityIgnoresInvertColors />;
}

function FlexIcon({ node }: { node: Node }) {
  const url = str(node.url);
  if (!url) return null;
  const size = typeof node.size === 'string' && node.size in ICON_SIZE ? ICON_SIZE[node.size] : (px(node.size) ?? ICON_SIZE.md);
  const ratio = parseAspectRatio(node.aspectRatio) ?? 1;
  return <Image source={{ uri: url }} style={{ width: size, height: size / ratio }} resizeMode="contain" accessibilityIgnoresInvertColors />;
}

function FlexBox({ node }: { node: Node }) {
  const row = isRow(node.layout);
  const spacing = px(node.spacing) ?? 0;
  const pad = px(node.paddingAll);
  const style: ViewStyle = {
    flexDirection: row ? 'row' : 'column',
    overflow: 'hidden',
    ...sizeStyle(node),
    ...positionStyle(node),
  };
  const bg = colorOf(node.backgroundColor);
  if (bg) style.backgroundColor = bg;
  const radius = px(node.cornerRadius);
  if (radius != null) style.borderRadius = radius;
  const bw = typeof node.borderWidth === 'string' ? (node.borderWidth in BORDER_WIDTH ? BORDER_WIDTH[node.borderWidth] : px(node.borderWidth)) : null;
  if (bw) {
    style.borderWidth = bw;
    style.borderColor = colorOf(node.borderColor) ?? '#e0e0e0';
  }
  if (pad != null) style.padding = pad;
  const t = px(node.paddingTop);
  const b = px(node.paddingBottom);
  const s = px(node.paddingStart);
  const e = px(node.paddingEnd);
  if (t != null) style.paddingTop = t;
  if (b != null) style.paddingBottom = b;
  if (s != null) style.paddingLeft = s;
  if (e != null) style.paddingRight = e;
  // 横並びの子は、上下の位置を合わせる(baseline は、文字のそろえ位置)
  if (node.layout === 'baseline') style.alignItems = 'baseline';
  if (node.justifyContent) {
    const j = node.justifyContent;
    style.justifyContent = j === 'center' ? 'center' : j === 'flex-end' ? 'flex-end' : j === 'space-between' ? 'space-between' : j === 'space-around' ? 'space-around' : j === 'space-evenly' ? 'space-evenly' : 'flex-start';
  }
  if (node.alignItems) {
    const a = node.alignItems;
    style.alignItems = a === 'center' ? 'center' : a === 'flex-end' ? 'flex-end' : a === 'flex-start' ? 'flex-start' : 'stretch';
  }
  const kids = children(node);
  return (
    <View style={style}>
      <Gradient bg={node.background} />
      {kids.map((c, i) => {
        // 子どうしの間隔(spacing)。margin の指定があれば、そちらを優先する
        const gap = c.margin !== undefined ? 0 : i === 0 ? 0 : spacing;
        const space: ViewStyle = gap ? (row ? { marginLeft: gap } : { marginTop: gap }) : {};
        return (
          <View
            key={i}
            style={[
              c.position === 'absolute' ? null : flexStyle(c, node.layout),
              c.position === 'absolute' ? null : space,
              c.position === 'absolute' ? null : marginStyle(c, node.layout, i),
              c.position === 'absolute' ? null : selfAlign(c, node.layout),
              c.position === 'absolute' ? positionStyle(c) : null,
              c.position === 'absolute' ? { width: lengthStyle(parseLength(c.width)) } : null,
            ]}
          >
            <FlexNode node={c} parentRow={row} />
          </View>
        );
      })}
    </View>
  );
}

function FlexNode({ node, parentRow }: { node: Node; parentRow: boolean }) {
  switch (node.type) {
    case 'box': {
      // 絶対位置の箱は、外側の View に位置を持たせているので、中身の箱には持たせない
      const inner = node.position === 'absolute' ? { ...node, position: undefined, width: undefined } : node;
      return <FlexBox node={inner as Node} />;
    }
    case 'text':
      return <FlexText node={node} />;
    case 'image':
      return <FlexImage node={node} parentRow={parentRow} />;
    case 'icon':
      return <FlexIcon node={node} />;
    case 'button':
      return <FlexButton node={node} />;
    case 'separator':
      return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: colorOf(node.color) ?? SEPARATOR_COLOR, alignSelf: 'stretch' }} />;
    case 'spacer': {
      const sizes: Record<string, number> = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 40 };
      return <View style={{ height: sizes[str(node.size) ?? 'md'] ?? 16, width: sizes[str(node.size) ?? 'md'] ?? 16 }} />;
    }
    case 'filler':
      return <View style={{ flexGrow: 1 }} />;
    default:
      return null;
  }
}

/** バブル1枚: hero・header・body・footer を縦に並べる。角丸・影つき、白地(styles で上書きできる) */
function FlexBubble({ bubble, width, stretch }: { bubble: Node; width?: number; stretch?: boolean }) {
  const w = width ?? bubbleWidthOf(bubble.size);
  const styles = (bubble.styles ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const block = (key: 'header' | 'body' | 'footer') => {
    const n = bubble[key] as Node | undefined;
    if (!n) return null;
    const bg = colorOf(styles[key]?.backgroundColor) ?? colorOf(n.backgroundColor);
    // ブロック自身の padding の既定は 16(box の padding の指定があれば、box 側が持つ)
    const hasOwnPad = ['paddingAll', 'paddingTop', 'paddingBottom', 'paddingStart', 'paddingEnd'].some((k) => n[k] !== undefined);
    return (
      <View key={key} style={[{ backgroundColor: bg }, key === 'body' && stretch ? { flexGrow: 1 } : null, hasOwnPad ? null : { padding: 16 }]}>
        <FlexBox node={{ ...n, backgroundColor: undefined }} />
      </View>
    );
  };
  const hero = bubble.hero as Node | undefined;
  const heroBg = colorOf(styles.hero?.backgroundColor);
  return (
    <View style={[bubbleStyles.bubble, { width: w }, stretch ? { alignSelf: 'stretch' } : null, colorOf(styles.body?.backgroundColor) ? null : null]}>
      {hero ? (
        <View style={heroBg ? { backgroundColor: heroBg } : null}>
          {hero.type === 'image' ? <FlexImage node={hero} parentRow={false} inBubbleHero /> : <FlexNode node={hero} parentRow={false} />}
        </View>
      ) : null}
      {block('header')}
      {block('body')}
      {block('footer')}
    </View>
  );
}

const CAROUSEL_GAP = 8;

const bubbleStyles = StyleSheet.create({
  bubble: { backgroundColor: '#ffffff', borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.12)' },
  carousel: { gap: CAROUSEL_GAP, paddingRight: CAROUSEL_GAP },
  textBubble: { maxWidth: '85%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#a7e99e' },
  image: { width: 200, height: 200, borderRadius: 10 },
});

/** カード1件(バブル or カルーセル) */
export const FlexCard = memo(function FlexCard({ flex }: { flex: unknown }) {
  if (!flex || typeof flex !== 'object') return null;
  const node = flex as Node;
  if (node.type === 'carousel' && Array.isArray(node.contents)) {
    // 横にめくる枠の幅は、カードの幅の合計で決める(親の幅が決まっていなくても、広い画面でつぶれない)。親より広ければ、親の幅までで、めくれる
    const cards = node.contents as Node[];
    const total = cards.reduce((sum, b) => sum + bubbleWidthOf(b.size), 0) + CAROUSEL_GAP * (cards.length - 1) + CAROUSEL_GAP;
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ width: total, maxWidth: '100%', flexGrow: 0 }} contentContainerStyle={bubbleStyles.carousel} nestedScrollEnabled>
        {(node.contents as Node[]).map((b, i) => (
          // 高さをそろえる(いちばん高いカードに合わせ、フッターのボタンが下に並ぶ)
          <FlexBubble key={i} bubble={b} stretch />
        ))}
      </ScrollView>
    );
  }
  if (node.type === 'bubble') return <FlexBubble bubble={node} />;
  return null;
});

/**
 * 記録されたカードの本文(JSON の文字列)を、届いた順に描く。
 * 複数のメッセージを1件で記録したもの(テキスト・画像・カードが混ざる)も、順番どおりに出す。
 * 読めないときは null(呼び出し側が、文字の代わりの表示を出す)。
 */
export const FlexMessageView = memo(function FlexMessageView({ content, outgoingColor }: { content: string; outgoingColor?: string }) {
  const items: FlexMessageItem[] = useMemo(() => parseFlexMessages(content), [content]);
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      {items.map((it, i) => {
        if (it.kind === 'flex') return <FlexCard key={i} flex={it.flex} />;
        if (it.kind === 'text') {
          return (
            <View key={i} style={[bubbleStyles.textBubble, outgoingColor ? { backgroundColor: outgoingColor } : null]}>
              <Text style={{ fontSize: 16, lineHeight: 22, color: '#0b2a0a' }}>{it.text}</Text>
            </View>
          );
        }
        if (it.kind === 'image' && it.imageUrl) return <Image key={i} source={{ uri: it.imageUrl }} style={bubbleStyles.image} resizeMode="cover" accessibilityIgnoresInvertColors />;
        return (
          <Text key={i} style={{ color: '#666666', fontSize: 12 }}>
            {it.text}
          </Text>
        );
      })}
    </View>
  );
});
