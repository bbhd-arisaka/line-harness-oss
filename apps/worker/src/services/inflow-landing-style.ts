/**
 * 流入経路ごとの「友だち追加ページ」(/r/<ref>)の、文言と配色。画面に依存しない純粋な関数。
 * 保存は JSON(entry_routes.landing_style)。設定が無い項目は、既定のまま。
 */

export interface LandingColors {
  pageBg?: string | null;
  cardBg?: string | null;
  text?: string | null;
  button?: string | null;
  buttonText?: string | null;
}

export interface LandingStyle {
  /** 見出し(既定: 友達追加して始める) */
  title?: string | null;
  /** ボタンの文字(既定: LINEで開く) */
  buttonText?: string | null;
  /** ボタンの下の注意書き(iPhone のみ。既定: ※開かない場合は…) */
  hintText?: string | null;
  showHint?: boolean;
  /** 「うまく開けない方は こちら」の、前の文と、リンクの文字 */
  helpText?: string | null;
  helpLinkText?: string | null;
  showHelp?: boolean;
  colors?: LandingColors;
}

export const LANDING_DEFAULTS = {
  title: '友達追加して始める',
  buttonText: 'LINEで開く',
  hintText: '※開かない場合はボタンを長押しして「LINEで開く」を選択',
  helpText: 'うまく開けない方は',
  helpLinkText: 'こちら',
  colors: { pageBg: '#f5f7f5', cardBg: '#ffffff', text: '#444444', button: '#06c755', buttonText: '#ffffff' },
} as const;

export const LANDING_LIMITS = { title: 60, buttonText: 30, hintText: 120, helpText: 40, helpLinkText: 20 } as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_KEYS = ['pageBg', 'cardBg', 'text', 'button', 'buttonText'] as const;
const TEXT_KEYS = ['title', 'buttonText', 'hintText', 'helpText', 'helpLinkText'] as const;

const TEXT_LABEL: Record<(typeof TEXT_KEYS)[number], string> = {
  title: '見出し',
  buttonText: 'ボタンの文字',
  hintText: 'ボタンの下の文',
  helpText: '「うまく開けない方は」の文',
  helpLinkText: 'リンクの文字',
};
const COLOR_LABEL: Record<(typeof COLOR_KEYS)[number], string> = {
  pageBg: '背景色',
  cardBg: 'カードの色',
  text: '文字の色',
  button: 'ボタンの色',
  buttonText: 'ボタンの文字の色',
};

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
  buttonText: string;
  /** 注意書きを出すか・その文(null = 既定の、「長押し」を色つきにした形) */
  showHint: boolean;
  hintText: string | null;
  showHelp: boolean;
  helpText: string;
  helpLinkText: string;
  colors: { pageBg: string; cardBg: string; text: string; button: string; buttonText: string; muted: string; mutedSoft: string; shadow: string };
}

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** 設定と既定を合わせて、ページを作るのに必要な値にする */
export function resolveLanding(style: LandingStyle | null | undefined): ResolvedLanding {
  const s = style ?? {};
  const pick = (v: string | null | undefined, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const col = (v: string | null | undefined, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  const colors = {
    pageBg: col(s.colors?.pageBg, LANDING_DEFAULTS.colors.pageBg),
    cardBg: col(s.colors?.cardBg, LANDING_DEFAULTS.colors.cardBg),
    text: col(s.colors?.text, LANDING_DEFAULTS.colors.text),
    button: col(s.colors?.button, LANDING_DEFAULTS.colors.button),
    buttonText: col(s.colors?.buttonText, LANDING_DEFAULTS.colors.buttonText),
  };
  return {
    title: pick(s.title, LANDING_DEFAULTS.title),
    buttonText: pick(s.buttonText, LANDING_DEFAULTS.buttonText),
    showHint: s.showHint !== false,
    hintText: typeof s.hintText === 'string' && s.hintText.trim() ? s.hintText.trim() : null,
    showHelp: s.showHelp !== false,
    helpText: pick(s.helpText, LANDING_DEFAULTS.helpText),
    helpLinkText: pick(s.helpLinkText, LANDING_DEFAULTS.helpLinkText),
    colors: {
      ...colors,
      // 小さな文字・リンクは、文字の色を薄くしたもの
      muted: colors.text === LANDING_DEFAULTS.colors.text ? '#999999' : rgba(colors.text, 0.62),
      mutedSoft: colors.text === LANDING_DEFAULTS.colors.text ? '#bbbbbb' : rgba(colors.text, 0.4),
      shadow: rgba(colors.button, 0.2),
    },
  };
}
