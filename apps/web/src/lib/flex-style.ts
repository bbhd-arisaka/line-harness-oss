/**
 * LINE の Flex メッセージ(カード・カルーセル)を、お客様のLINEの見た目に合わせて描くための、値の読み取り。
 * 画面の部品(RN / Web)に依存しない純粋な関数だけ。アプリ(apps/mobile/src/lib/flex-style.ts)と同じ内容にしておく。
 * LINE の仕様: https://developers.line.biz/ja/reference/messaging-api/#flex-message
 */

/** 文字の大きさ(px)。LINE の既定値 */
export const FONT_SIZE: Record<string, number> = {
  xxs: 11,
  xs: 13,
  sm: 14,
  md: 16,
  lg: 19,
  xl: 22,
  xxl: 29,
  '3xl': 35,
  '4xl': 48,
  '5xl': 74,
};

/** 余白・間隔・角丸のキーワード(px) */
export const SPACE: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };

/** 枠線の太さのキーワード(px) */
export const BORDER_WIDTH: Record<string, number> = { none: 0, light: 0.5, normal: 1, medium: 2, 'semi-bold': 3, bold: 4 };

/** 画像の幅のキーワード(px) */
export const IMAGE_WIDTH: Record<string, number> = { xxs: 40, xs: 60, sm: 80, md: 100, lg: 120, xl: 140, xxl: 160, '3xl': 180, '4xl': 200, '5xl': 220 };

/** アイコンの大きさのキーワード(px) */
export const ICON_SIZE: Record<string, number> = { xxs: 12, xs: 14, sm: 16, md: 18, lg: 20, xl: 22, xxl: 24, '3xl': 28, '4xl': 32, '5xl': 36 };

/** バブルの幅(px)。指定がなければ mega */
export const BUBBLE_WIDTH: Record<string, number> = { nano: 120, micro: 160, deca: 220, hecto: 265, kilo: 260, mega: 300, giga: 340 };

export type Length = { px: number } | { pct: number };

/** "12px" / "50%" / "xl" / 12 などを、px か % にする。読めなければ null */
export function parseLength(v: unknown, keywords: Record<string, number> = SPACE): Length | null {
  if (typeof v === 'number' && Number.isFinite(v)) return { px: v };
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (s in keywords) return { px: keywords[s] };
  const m = /^(-?\d+(?:\.\d+)?)(px|%)?$/.exec(s);
  if (!m) return null;
  return m[2] === '%' ? { pct: Number(m[1]) } : { px: Number(m[1]) };
}

/** px だけ欲しいとき(% は null) */
export function px(v: unknown, keywords: Record<string, number> = SPACE): number | null {
  const l = parseLength(v, keywords);
  return l && 'px' in l ? l.px : null;
}

/** "1024:678" → 横÷縦 */
export function parseAspectRatio(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : null;
}

export function fontSizeOf(size: unknown, fallback = FONT_SIZE.md): number {
  if (typeof size === 'string') {
    if (size in FONT_SIZE) return FONT_SIZE[size];
    const v = px(size);
    if (v != null) return v;
  }
  return fallback;
}

export function bubbleWidthOf(size: unknown): number {
  return typeof size === 'string' && size in BUBBLE_WIDTH ? BUBBLE_WIDTH[size] : BUBBLE_WIDTH.mega;
}

/** "#RRGGBB" / "#RRGGBBAA"(LINE の形式)。それ以外は無視 */
export function colorOf(v: unknown): string | undefined {
  return typeof v === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim()) ? v.trim() : undefined;
}

/** "#RRGGBBAA" を [r,g,b,a(0〜1)] に */
export function rgbaOf(color: string | undefined, fallback: [number, number, number, number] = [0, 0, 0, 0]): [number, number, number, number] {
  const c = colorOf(color);
  if (!c) return fallback;
  const hex = c.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

export interface LinearGradient {
  angle: number;
  start: [number, number, number, number];
  end: [number, number, number, number];
  center?: { color: [number, number, number, number]; position: number };
}

/** box の background(linearGradient)を読む。角度は CSS と同じ(0deg=下から上)。それ以外の背景は null */
export function parseGradient(bg: unknown): LinearGradient | null {
  if (!bg || typeof bg !== 'object') return null;
  const b = bg as Record<string, unknown>;
  if (b.type !== 'linearGradient') return null;
  const angle = typeof b.angle === 'string' ? Number.parseFloat(b.angle) : 0;
  const start = rgbaOf(colorOf(b.startColor));
  const end = rgbaOf(colorOf(b.endColor));
  const center = colorOf(b.centerColor)
    ? { color: rgbaOf(colorOf(b.centerColor)), position: Math.min(1, Math.max(0, (Number.parseFloat(String(b.centerPosition ?? '50')) || 50) / 100)) }
    : undefined;
  return { angle: Number.isFinite(angle) ? angle : 0, start, end, center };
}

/** 勾配の、位置 t(0〜1)での色 */
export function gradientColorAt(g: LinearGradient, t: number): [number, number, number, number] {
  const mix = (a: [number, number, number, number], b: [number, number, number, number], k: number): [number, number, number, number] => [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
    a[3] + (b[3] - a[3]) * k,
  ];
  if (g.center) {
    return t <= g.center.position
      ? mix(g.start, g.center.color, g.center.position === 0 ? 1 : t / g.center.position)
      : mix(g.center.color, g.end, g.center.position === 1 ? 1 : (t - g.center.position) / (1 - g.center.position));
  }
  return mix(g.start, g.end, t);
}

export function rgbaCss(c: [number, number, number, number]): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(c[3] * 1000) / 1000})`;
}

export interface FlexMessageItem {
  kind: 'flex' | 'text' | 'image' | 'other';
  /** flex: バブル or カルーセルの中身(JSON) */
  flex?: unknown;
  text?: string;
  imageUrl?: string;
  altText?: string;
}

/**
 * メッセージの本文(JSON の文字列)から、お客様に届いた順のメッセージの並びを取り出す。
 * - バブル / カルーセル そのもの
 * - { type:'flex', contents:{…} }(LINE に送った形)
 * - { lineMessages:[…] }(複数のメッセージを1件として記録したもの。テキスト・画像・カードが混ざる)
 * 読めなければ空。
 */
export function parseFlexMessages(content: string): FlexMessageItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const out: FlexMessageItem[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.lineMessages)) {
      for (const m of o.lineMessages) visit(m);
      return;
    }
    if (o.type === 'bubble' || o.type === 'carousel') {
      out.push({ kind: 'flex', flex: o });
      return;
    }
    if (o.type === 'flex') {
      if (o.contents && typeof o.contents === 'object') out.push({ kind: 'flex', flex: o.contents, altText: typeof o.altText === 'string' ? o.altText : undefined });
      return;
    }
    if (o.type === 'text' && typeof o.text === 'string') {
      out.push({ kind: 'text', text: o.text });
      return;
    }
    if (o.type === 'image') {
      const url = typeof o.originalContentUrl === 'string' ? o.originalContentUrl : typeof o.previewImageUrl === 'string' ? o.previewImageUrl : undefined;
      if (url) out.push({ kind: 'image', imageUrl: url });
      return;
    }
    if (typeof o.type === 'string') out.push({ kind: 'other', text: `[${o.type}]` });
  };
  visit(parsed);
  return out;
}
