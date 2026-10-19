/**
 * 流入経路ごとの「友だち追加ページ」(/r/<ref>)の、文言・配色・背景画像・透過・角丸。画面に依存しない純粋な関数。
 * 保存は JSON(entry_routes.landing_style)。設定が無い項目は、既定のまま。
 * 画面(Web・アプリ)の既定値・範囲は、apps/web/src/lib/inflow-routes.ts と apps/mobile/src/lib/inflow.ts に同じものがある。
 */

export interface LandingColors {
  pageBg?: string | null;
  cardBg?: string | null;
  text?: string | null;
  button?: string | null;
  buttonText?: string | null;
  /** 背景画像の上にかぶせる色(暗くする・明るくする) */
  overlay?: string | null;
}

export interface LandingStyle {
  /** 見出し(既定: 友達追加して始める) */
  title?: string | null;
  /** 見出しの下の説明(既定: なし) */
  subtitle?: string | null;
  /** ボタンの文字(既定: LINEで開く) */
  buttonText?: string | null;
  /** ボタンの下の注意書き(iPhone のみ。既定: ※開かない場合は…) */
  hintText?: string | null;
  showHint?: boolean;
  /** 「うまく開けない方は こちら」の、前の文と、リンクの文字 */
  helpText?: string | null;
  helpLinkText?: string | null;
  showHelp?: boolean;
  /** パソコンで開いたときの見出し(既定: スマートフォンで QR コードを読み取ってください) */
  pcTitle?: string | null;
  /** 上のアイコンを出すか・自分の画像(https)に変えるか */
  showIcon?: boolean;
  iconUrl?: string | null;
  colors?: LandingColors;
  /** 背景の画像(https) */
  bgImageUrl?: string | null;
  /** 背景画像の上にかぶせる色の濃さ(0〜80 %) */
  bgOverlayOpacity?: number | null;
  /** カードの不透明度(20〜100 %。低いほど、背景が透ける) */
  cardOpacity?: number | null;
  /** ボタンの不透明度(30〜100 %) */
  buttonOpacity?: number | null;
  /** カードの後ろのぼかし(0〜24 px。背景が透けているときに効く) */
  cardBlur?: number | null;
  /** 角の丸み(0〜40 px) */
  cardRadius?: number | null;
  buttonRadius?: number | null;
}

export const LANDING_DEFAULTS = {
  title: '友達追加して始める',
  buttonText: 'LINEで開く',
  hintText: '※開かない場合はボタンを長押しして「LINEで開く」を選択',
  helpText: 'うまく開けない方は',
  helpLinkText: 'こちら',
  pcTitle: 'スマートフォンで QR コードを読み取ってください',
  colors: { pageBg: '#eef5f0', cardBg: '#ffffff', text: '#2a2f2c', button: '#06c755', buttonText: '#ffffff', overlay: '#000000' },
  bgOverlayOpacity: 0,
  cardOpacity: 100,
  buttonOpacity: 100,
  cardBlur: 0,
  cardRadius: 24,
  buttonRadius: 14,
} as const;

export const LANDING_LIMITS = { title: 60, subtitle: 120, buttonText: 30, hintText: 120, helpText: 40, helpLinkText: 20, pcTitle: 60 } as const;
/** 数値の範囲(最小・最大) */
export const LANDING_RANGES = {
  bgOverlayOpacity: [0, 80],
  cardOpacity: [20, 100],
  buttonOpacity: [30, 100],
  cardBlur: [0, 24],
  cardRadius: [0, 40],
  buttonRadius: [0, 40],
} as const;

const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_KEYS = ['pageBg', 'cardBg', 'text', 'button', 'buttonText', 'overlay'] as const;
const TEXT_KEYS = ['title', 'subtitle', 'buttonText', 'hintText', 'helpText', 'helpLinkText', 'pcTitle'] as const;
const NUMBER_KEYS = ['bgOverlayOpacity', 'cardOpacity', 'buttonOpacity', 'cardBlur', 'cardRadius', 'buttonRadius'] as const;

const TEXT_LABEL: Record<(typeof TEXT_KEYS)[number], string> = {
  title: '見出し',
  subtitle: '見出しの下の説明',
  buttonText: 'ボタンの文字',
  hintText: 'ボタンの下の文',
  helpText: '「うまく開けない方は」の文',
  helpLinkText: 'リンクの文字',
  pcTitle: 'パソコンで開いたときの見出し',
};
const COLOR_LABEL: Record<(typeof COLOR_KEYS)[number], string> = {
  pageBg: '背景色',
  cardBg: 'カードの色',
  text: '文字の色',
  button: 'ボタンの色',
  buttonText: 'ボタンの文字の色',
  overlay: '背景画像にかぶせる色',
};
const NUMBER_LABEL: Record<(typeof NUMBER_KEYS)[number], string> = {
  bgOverlayOpacity: '背景画像にかぶせる色の濃さ',
  cardOpacity: 'カードの不透明度',
  buttonOpacity: 'ボタンの不透明度',
  cardBlur: 'カードの後ろのぼかし',
  cardRadius: 'カードの角の丸み',
  buttonRadius: 'ボタンの角の丸み',
};

/** 画像のURL(https)を、CSS・HTML に安全に入れられる形にする。使えなければ null */
export function safeImageUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 600 || /[\s"'`\\<>(){}]/.test(t)) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** 画面から届いた設定を、検査して、保存する形(JSON文字列)にする。既定のままなら null */
export function parseLandingStyleInput(raw: unknown): { ok: true; json: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, json: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '友だち追加ページの設定の形が正しくありません' };
  const b = raw as Record<string, unknown>;
  const out: LandingStyle = {};
  for (const k of TEXT_KEYS) {
    const v = b[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return { ok: false, error: `${TEXT_LABEL[k]}は文字で入力してください` };
    const t = v.trim();
    if (!t) continue; // 空 = 既定
    if (Array.from(t).length > LANDING_LIMITS[k]) return { ok: false, error: `${TEXT_LABEL[k]}は${LANDING_LIMITS[k]}文字までです` };
    out[k] = t;
  }
  if (b.showHint === false) out.showHint = false;
  if (b.showHelp === false) out.showHelp = false;
  if (b.showIcon === false) out.showIcon = false;
  for (const [key, label] of [['iconUrl', 'アイコンの画像'], ['bgImageUrl', '背景の画像']] as const) {
    const v = b[key];
    if (v === undefined || v === null || v === '') continue;
    const url = safeImageUrl(v);
    if (!url) return { ok: false, error: `${label}は、https で始まるURLにしてください` };
    out[key] = url;
  }
  for (const k of NUMBER_KEYS) {
    const v = b[k];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    const [min, max] = LANDING_RANGES[k];
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return { ok: false, error: `${NUMBER_LABEL[k]}は、${min}〜${max}の整数で入力してください` };
    if (n !== LANDING_DEFAULTS[k]) out[k] = n; // 既定と同じなら、保存しない
  }
  if (b.colors !== undefined && b.colors !== null) {
    if (typeof b.colors !== 'object' || Array.isArray(b.colors)) return { ok: false, error: '色の設定の形が正しくありません' };
    const c = b.colors as Record<string, unknown>;
    const colors: LandingColors = {};
    for (const k of COLOR_KEYS) {
      const v = c[k];
      if (v === undefined || v === null || v === '') continue;
      if (typeof v !== 'string' || !HEX.test(v.trim())) return { ok: false, error: `${COLOR_LABEL[k]}は、「#06c755」の形で入力してください` };
      colors[k] = v.trim().toLowerCase();
    }
    if (Object.keys(colors).length > 0) out.colors = colors;
  }
  return { ok: true, json: Object.keys(out).length > 0 ? JSON.stringify(out) : null };
}

/** 保存された JSON を読む。壊れていても、既定のまま(空の設定)にする */
export function parseLandingStyle(json: string | null | undefined): LandingStyle {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as LandingStyle) : {};
  } catch {
    return {};
  }
}

export interface ResolvedLanding {
  title: string;
  subtitle: string | null;
  buttonText: string;
  /** 注意書きを出すか・その文(null = 既定の、「長押し」を色つきにした形) */
  showHint: boolean;
  hintText: string | null;
  showHelp: boolean;
  helpText: string;
  helpLinkText: string;
  pcTitle: string;
  showIcon: boolean;
  iconUrl: string | null;
  bgImageUrl: string | null;
  blur: number;
  cardRadius: number;
  buttonRadius: number;
  colors: {
    pageBg: string;
    /** 不透明度を含めた色(rgba) */
    cardBg: string;
    text: string;
    button: string;
    buttonText: string;
    /** 不透明度を含めたボタンの色(rgba) */
    buttonBg: string;
    /** 背景画像にかぶせる色(濃さを含めた rgba。かぶせないなら null) */
    veil: string | null;
    muted: string;
    mutedSoft: string;
    shadow: string;
    /** カードの縁(カードの色より少し濃い) */
    cardLine: string;
  };
}

export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(alpha * 1000) / 1000})`;
}

/** 設定と既定を合わせて、ページを作るのに必要な値にする */
export function resolveLanding(style: LandingStyle | null | undefined): ResolvedLanding {
  const s = style ?? {};
  const pick = (v: string | null | undefined, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const col = (v: string | null | undefined, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  const num = (v: number | null | undefined, key: (typeof NUMBER_KEYS)[number]) => {
    const [min, max] = LANDING_RANGES[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : LANDING_DEFAULTS[key];
  };
  const base = {
    pageBg: col(s.colors?.pageBg, LANDING_DEFAULTS.colors.pageBg),
    cardBg: col(s.colors?.cardBg, LANDING_DEFAULTS.colors.cardBg),
    text: col(s.colors?.text, LANDING_DEFAULTS.colors.text),
    button: col(s.colors?.button, LANDING_DEFAULTS.colors.button),
    buttonText: col(s.colors?.buttonText, LANDING_DEFAULTS.colors.buttonText),
    overlay: col(s.colors?.overlay, LANDING_DEFAULTS.colors.overlay),
  };
  const bgImageUrl = safeImageUrl(s.bgImageUrl);
  const overlayOpacity = num(s.bgOverlayOpacity, 'bgOverlayOpacity');
  const cardOpacity = num(s.cardOpacity, 'cardOpacity');
  const buttonOpacity = num(s.buttonOpacity, 'buttonOpacity');
  return {
    title: pick(s.title, LANDING_DEFAULTS.title),
    subtitle: typeof s.subtitle === 'string' && s.subtitle.trim() ? s.subtitle.trim() : null,
    buttonText: pick(s.buttonText, LANDING_DEFAULTS.buttonText),
    showHint: s.showHint !== false,
    hintText: typeof s.hintText === 'string' && s.hintText.trim() ? s.hintText.trim() : null,
    showHelp: s.showHelp !== false,
    helpText: pick(s.helpText, LANDING_DEFAULTS.helpText),
    helpLinkText: pick(s.helpLinkText, LANDING_DEFAULTS.helpLinkText),
    pcTitle: pick(s.pcTitle, LANDING_DEFAULTS.pcTitle),
    showIcon: s.showIcon !== false,
    iconUrl: safeImageUrl(s.iconUrl),
    bgImageUrl,
    blur: num(s.cardBlur, 'cardBlur'),
    cardRadius: num(s.cardRadius, 'cardRadius'),
    buttonRadius: num(s.buttonRadius, 'buttonRadius'),
    colors: {
      pageBg: base.pageBg,
      cardBg: cardOpacity >= 100 ? base.cardBg : rgba(base.cardBg, cardOpacity / 100),
      text: base.text,
      button: base.button,
      buttonText: base.buttonText,
      buttonBg: buttonOpacity >= 100 ? base.button : rgba(base.button, buttonOpacity / 100),
      veil: bgImageUrl && overlayOpacity > 0 ? rgba(base.overlay, overlayOpacity / 100) : null,
      // 小さな文字・リンクは、文字の色を薄くしたもの
      muted: rgba(base.text, 0.62),
      mutedSoft: rgba(base.text, 0.42),
      shadow: rgba(base.button, 0.28),
      cardLine: rgba(base.text, 0.07),
    },
  };
}
