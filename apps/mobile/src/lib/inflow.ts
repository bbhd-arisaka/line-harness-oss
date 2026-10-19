// 流入経路(友だち追加のQR・URLを、流入経路ごとに分ける)の、型と、画面に依存しない補助。
// サーバー側は apps/worker/src/routes/inflow-routes.ts(Web の流入経路分析と同じもの)。

export interface InflowAction {
  type: string;
  params: Record<string, unknown>;
  condition: unknown | null;
  timing?: unknown;
}

/** 友だち追加ページ(/r/<ref>)の文言・配色・背景画像・透過・角丸。空・未設定の項目は、既定のまま。サーバーは apps/worker/src/services/inflow-landing-style.ts */
export interface LandingStyle {
  title?: string | null;
  subtitle?: string | null;
  buttonText?: string | null;
  hintText?: string | null;
  showHint?: boolean;
  helpText?: string | null;
  helpLinkText?: string | null;
  showHelp?: boolean;
  pcTitle?: string | null;
  showIcon?: boolean;
  iconUrl?: string | null;
  colors?: { pageBg?: string | null; cardBg?: string | null; text?: string | null; button?: string | null; buttonText?: string | null; overlay?: string | null };
  bgImageUrl?: string | null;
  bgOverlayOpacity?: number | null;
  cardOpacity?: number | null;
  buttonOpacity?: number | null;
  cardBlur?: number | null;
  cardRadius?: number | null;
  buttonRadius?: number | null;
}

/** 設定が無いときの、ページの文言・色・数値(サーバーの既定と同じ) */
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

export type LandingColorKey = 'pageBg' | 'cardBg' | 'text' | 'button' | 'buttonText' | 'overlay';

export const LANDING_COLOR_FIELDS: Array<{ key: LandingColorKey; label: string }> = [
  { key: 'pageBg', label: '背景' },
  { key: 'cardBg', label: 'カード' },
  { key: 'text', label: '文字' },
  { key: 'button', label: 'ボタン' },
  { key: 'buttonText', label: 'ボタンの文字' },
  { key: 'overlay', label: '背景画像にかぶせる色' },
];

/** 数値の調整(−/＋)の項目・範囲・刻み */
export const LANDING_STEPPERS: Array<{ key: 'bgOverlayOpacity' | 'cardOpacity' | 'cardBlur' | 'cardRadius' | 'buttonOpacity' | 'buttonRadius'; label: string; min: number; max: number; step: number; unit: string }> = [
  { key: 'bgOverlayOpacity', label: '背景画像にかぶせる色の濃さ', min: 0, max: 80, step: 5, unit: '%' },
  { key: 'cardOpacity', label: 'カードの不透明度', min: 20, max: 100, step: 5, unit: '%' },
  { key: 'cardBlur', label: 'カードの後ろのぼかし', min: 0, max: 24, step: 2, unit: 'px' },
  { key: 'cardRadius', label: 'カードの角の丸み', min: 0, max: 40, step: 2, unit: 'px' },
  { key: 'buttonOpacity', label: 'ボタンの不透明度', min: 30, max: 100, step: 5, unit: '%' },
  { key: 'buttonRadius', label: 'ボタンの角の丸み', min: 0, max: 40, step: 2, unit: 'px' },
];

/** デザインのひな形。色・透過・角丸だけを入れ替える(文言・画像はそのまま) */
export const LANDING_PRESETS: Array<{ id: string; label: string; style: Pick<LandingStyle, 'colors' | 'cardOpacity' | 'cardBlur' | 'cardRadius' | 'buttonRadius' | 'bgOverlayOpacity' | 'buttonOpacity'> }> = [
  { id: 'standard', label: '標準', style: {} },
  { id: 'white', label: 'ホワイト', style: { colors: { pageBg: '#ffffff', cardBg: '#ffffff', text: '#222222', button: '#06c755' }, cardRadius: 16, buttonRadius: 12 } },
  { id: 'dark', label: 'ダーク', style: { colors: { pageBg: '#0f172a', cardBg: '#1e293b', text: '#f1f5f9', button: '#06c755', buttonText: '#ffffff' } } },
  { id: 'blush', label: 'ブラッシュ', style: { colors: { pageBg: '#fdf1f3', cardBg: '#ffffff', text: '#4a3b3e', button: '#d9667d', buttonText: '#ffffff' }, cardRadius: 28, buttonRadius: 40 } },
  { id: 'glass', label: 'ガラス風(写真向き)', style: { colors: { pageBg: '#6fcf97', cardBg: '#ffffff', text: '#1f2a24', button: '#06c755', buttonText: '#ffffff', overlay: '#000000' }, cardOpacity: 68, cardBlur: 14, bgOverlayOpacity: 25, cardRadius: 28 } },
];

/** ひな形を当てる。文言・表示の切り替え・画像は残し、色・透過・ぼかし・角丸は、ひな形のもの(無い項目は既定)にする */
export function applyLandingPreset(style: LandingStyle, presetId: string): LandingStyle {
  const preset = LANDING_PRESETS.find((p) => p.id === presetId);
  if (!preset) return style;
  const { colors: _c, cardOpacity: _a, cardBlur: _b, cardRadius: _r, buttonRadius: _br, bgOverlayOpacity: _o, buttonOpacity: _bo, ...keep } = style;
  void [_c, _a, _b, _r, _br, _o, _bo];
  return { ...keep, ...preset.style };
}

export function isHexColor(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/** #rrggbb と 不透明度(0〜1)から、rgba(...) */
export function rgbaOf(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** プレビューに使う、設定と既定を合わせた値 */
export function resolveLandingView(style: LandingStyle) {
  const col = (v: string | null | undefined, d: string) => (isHexColor(v) ? v.toLowerCase() : d);
  const num = (v: number | null | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const d = LANDING_DEFAULTS;
  const colors = {
    pageBg: col(style.colors?.pageBg, d.colors.pageBg),
    cardBg: col(style.colors?.cardBg, d.colors.cardBg),
    text: col(style.colors?.text, d.colors.text),
    button: col(style.colors?.button, d.colors.button),
    buttonText: col(style.colors?.buttonText, d.colors.buttonText),
    overlay: col(style.colors?.overlay, d.colors.overlay),
  };
  const bgImage = style.bgImageUrl && /^https:\/\//.test(style.bgImageUrl) ? style.bgImageUrl : null;
  const overlay = num(style.bgOverlayOpacity, d.bgOverlayOpacity);
  return {
    title: style.title?.trim() || d.title,
    subtitle: style.subtitle?.trim() || null,
    buttonText: style.buttonText?.trim() || d.buttonText,
    hintText: style.showHint === false ? null : style.hintText?.trim() || d.hintText,
    helpText: style.showHelp === false ? null : `${style.helpText?.trim() || d.helpText} ${style.helpLinkText?.trim() || d.helpLinkText}`,
    showIcon: style.showIcon !== false,
    iconUrl: style.iconUrl && /^https:\/\//.test(style.iconUrl) ? style.iconUrl : null,
    bgImage,
    veil: bgImage && overlay > 0 ? rgbaOf(colors.overlay, overlay / 100) : null,
    cardBg: rgbaOf(colors.cardBg, num(style.cardOpacity, d.cardOpacity) / 100),
    buttonBg: rgbaOf(colors.button, num(style.buttonOpacity, d.buttonOpacity) / 100),
    cardRadius: num(style.cardRadius, d.cardRadius),
    buttonRadius: num(style.buttonRadius, d.buttonRadius),
    colors,
    muted: rgbaOf(colors.text, 0.62),
  };
}

export interface InflowFolder {
  id: string;
  name: string;
  count: number;
}

export interface InflowRoute {
  id: string;
  refCode: string;
  name: string;
  lineAccountId: string | null;
  folderId: string | null;
  qrText: string | null;
  /** 日本時間の「YYYY-MM-DDTHH:mm」 */
  validFrom: string | null;
  validTo: string | null;
  outOfPeriodMessage: string | null;
  /** 旧来の流入経路(Web の古い画面で作ったもの)。アプリでは編集できない */
  legacy: boolean;
  actions: InflowAction[];
  scenarioId: string | null;
  ignoreFriendAddSettings: boolean;
  actionMode: 'first' | 'always';
  adImportMode: 'first' | 'always';
  adParamMap: Array<{ param: string; fieldKey: string }>;
  htmlHead: string | null;
  htmlBody: string | null;
  geoLat: number | null;
  geoLng: number | null;
  geoRadius: number | null;
  landingStyle?: LandingStyle;
  url: string;
  createdAt: string;
  people?: number;
  times?: number;
}

/** 作成・更新で送る内容(サーバーは、送られなかった項目を空に戻すので、いつも全項目を送る) */
export type InflowRouteInput = Omit<InflowRoute, 'id' | 'refCode' | 'legacy' | 'url' | 'createdAt' | 'people' | 'times'> & { lineAccountId: string };

export function toInput(r: InflowRoute, accountId: string): InflowRouteInput {
  return {
    lineAccountId: accountId,
    name: r.name,
    folderId: r.folderId,
    qrText: r.qrText,
    validFrom: r.validFrom,
    validTo: r.validTo,
    outOfPeriodMessage: r.outOfPeriodMessage,
    actions: r.actions,
    scenarioId: r.scenarioId,
    ignoreFriendAddSettings: r.ignoreFriendAddSettings,
    actionMode: r.actionMode,
    adImportMode: r.adImportMode,
    adParamMap: r.adParamMap,
    htmlHead: r.htmlHead,
    htmlBody: r.htmlBody,
    geoLat: r.geoLat,
    geoLng: r.geoLng,
    geoRadius: r.geoRadius,
    landingStyle: r.landingStyle ?? {},
  };
}

export function emptyInput(accountId: string, folderId: string | null = null): InflowRouteInput {
  return {
    lineAccountId: accountId,
    name: '',
    folderId,
    qrText: null,
    validFrom: null,
    validTo: null,
    outOfPeriodMessage: null,
    actions: [],
    scenarioId: null,
    ignoreFriendAddSettings: false,
    actionMode: 'first',
    adImportMode: 'always',
    adParamMap: [],
    htmlHead: null,
    htmlBody: null,
    geoLat: null,
    geoLng: null,
    geoRadius: null,
    landingStyle: {},
  };
}

const isTagAdd = (a: InflowAction): boolean => a.type === 'tag' && a.params.op !== 'remove' && a.condition === null;

/** 「タグを追加」のアクション(条件なし)に入っているタグ。複数あれば、まとめて */
export function tagAddIds(actions: InflowAction[]): string[] {
  const ids: string[] = [];
  for (const a of actions) {
    if (!isTagAdd(a)) continue;
    for (const id of (a.params.tagIds as string[] | undefined) ?? []) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** アプリで編集できる「タグを追加」以外のアクション(Web で設定したもの)。保存のとき、そのまま残す */
export function otherActions(actions: InflowAction[]): InflowAction[] {
  return actions.filter((a) => !isTagAdd(a));
}

/** タグの追加を、1つのアクションにまとめて差し替える。ほかのアクションは、そのまま・順番も保つ */
export function withTagAddIds(actions: InflowAction[], ids: string[]): InflowAction[] {
  const next: InflowAction[] = [];
  let placed = false;
  const tag: InflowAction = { type: 'tag', params: { op: 'add', tagIds: ids }, condition: null };
  for (const a of actions) {
    if (isTagAdd(a)) {
      if (!placed && ids.length > 0) {
        next.push(tag);
        placed = true;
      }
      continue;
    }
    next.push(a);
  }
  if (!placed && ids.length > 0) next.push(tag);
  return next;
}

/** 日本時間の日付と時刻(2026-10-20 と 09:30)を、サーバーに送る形に。どちらかが空なら null */
export function joinPeriod(dateId: string | null, timeId: string | null): string | null {
  return dateId && timeId ? `${dateId}T${timeId}` : null;
}

export function splitPeriod(v: string | null): { dateId: string | null; timeId: string | null } {
  if (!v) return { dateId: null, timeId: null };
  const [d, t] = v.split('T');
  return { dateId: d || null, timeId: t ? t.slice(0, 5) : null };
}

/** 表示用: 「10月20日 09:30」 */
export function formatPeriod(v: string | null): string {
  const { dateId, timeId } = splitPeriod(v);
  if (!dateId) return '';
  const [, m, d] = dateId.split('-').map(Number);
  return `${m}月${d}日${timeId ? ` ${timeId}` : ''}`;
}
