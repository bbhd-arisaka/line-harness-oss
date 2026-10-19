// 流入経路分析(Lステップと同じ仕様)の、画面側の型と補助。サーバー側は apps/worker/src/routes/inflow-routes.ts

import type { FriendAddActionItem } from './friend-add-actions'

export interface InflowFolder {
  id: string
  name: string
  count: number
}

export interface InflowRoute {
  id: string
  refCode: string
  name: string
  lineAccountId: string | null
  folderId: string | null
  qrText: string | null
  /** 日本時間の「YYYY-MM-DDTHH:mm」 */
  validFrom: string | null
  validTo: string | null
  outOfPeriodMessage: string | null
  /** 旧来の流入経路(アクションの設定画面を使わず、タグ・シナリオだけを持つもの) */
  legacy: boolean
  actions: FriendAddActionItem[]
  scenarioId: string | null
  ignoreFriendAddSettings: boolean
  actionMode: 'first' | 'always'
  adImportMode: 'first' | 'always'
  adParamMap: Array<{ param: string; fieldKey: string }>
  htmlHead: string | null
  htmlBody: string | null
  geoLat: number | null
  geoLng: number | null
  geoRadius: number | null
  landingStyle?: LandingStyle
  url: string
  createdAt: string
  /** 一覧のときだけ */
  people?: number
  times?: number
}

export interface InflowRouteInput {
  lineAccountId: string
  name: string
  folderId: string | null
  qrText: string | null
  validFrom: string | null
  validTo: string | null
  outOfPeriodMessage: string | null
  actions: FriendAddActionItem[]
  scenarioId: string | null
  ignoreFriendAddSettings: boolean
  actionMode: 'first' | 'always'
  adImportMode: 'first' | 'always'
  adParamMap: Array<{ param: string; fieldKey: string }>
  htmlHead: string | null
  htmlBody: string | null
  geoLat: number | null
  geoLng: number | null
  geoRadius: number | null
  landingStyle?: LandingStyle | null
}

export interface InflowStatsRow {
  id: string
  friendId: string | null
  friendName: string
  mark: '未対応' | '対応中' | '対応済み'
  at: string
  queryParams: Record<string, string>
}

export interface InflowStats {
  route: InflowRoute
  total: number
  people: number
  page: number
  pageSize: number
  rows: InflowStatsRow[]
}

/** 日時の表示(例: 2026-10-18T10:00:00.000+09:00 → 2026-10-18 10:00) */
export function formatInflowDateTime(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace('T', ' ').slice(0, 16)
}

/** 有効期間の表示。開始・終了のどちらかだけでもよい。設定がなければ空 */
export function formatInflowPeriod(from: string | null, to: string | null): string {
  if (!from && !to) return ''
  return `${formatInflowDateTime(from)} 〜 ${formatInflowDateTime(to)}`.trim()
}

/** 広告に挿入するタグ(広告のリンク先ページに貼ると、流入経路のURLへ広告パラメータを引き継ぐ) */
export function adInsertTag(workerOrigin: string, refCode: string): string {
  return `<script src="${workerOrigin}/r/${refCode}/ad.js" async></script>`
}

// ── 友だち追加ページ(/r/<ref>)の文言・配色・背景画像・透過・角丸。サーバー側は apps/worker/src/services/inflow-landing-style.ts ──

export interface LandingColors {
  pageBg?: string | null
  cardBg?: string | null
  text?: string | null
  button?: string | null
  buttonText?: string | null
  /** 背景画像にかぶせる色 */
  overlay?: string | null
}

export interface LandingStyle {
  title?: string | null
  subtitle?: string | null
  buttonText?: string | null
  hintText?: string | null
  showHint?: boolean
  helpText?: string | null
  helpLinkText?: string | null
  showHelp?: boolean
  pcTitle?: string | null
  showIcon?: boolean
  iconUrl?: string | null
  colors?: LandingColors
  bgImageUrl?: string | null
  bgOverlayOpacity?: number | null
  cardOpacity?: number | null
  buttonOpacity?: number | null
  cardBlur?: number | null
  cardRadius?: number | null
  buttonRadius?: number | null
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
} as const

export const LANDING_COLOR_FIELDS: Array<{ key: keyof LandingColors; label: string }> = [
  { key: 'pageBg', label: '背景' },
  { key: 'cardBg', label: 'カード' },
  { key: 'text', label: '文字' },
  { key: 'button', label: 'ボタン' },
  { key: 'buttonText', label: 'ボタンの文字' },
]

/** 数値の調整(スライダー)の項目と範囲 */
export const LANDING_SLIDERS: Array<{ key: 'bgOverlayOpacity' | 'cardOpacity' | 'cardBlur' | 'cardRadius' | 'buttonOpacity' | 'buttonRadius'; label: string; min: number; max: number; unit: string }> = [
  { key: 'bgOverlayOpacity', label: '背景画像にかぶせる色の濃さ', min: 0, max: 80, unit: '%' },
  { key: 'cardOpacity', label: 'カードの不透明度', min: 20, max: 100, unit: '%' },
  { key: 'cardBlur', label: 'カードの後ろのぼかし', min: 0, max: 24, unit: 'px' },
  { key: 'cardRadius', label: 'カードの角の丸み', min: 0, max: 40, unit: 'px' },
  { key: 'buttonOpacity', label: 'ボタンの不透明度', min: 30, max: 100, unit: '%' },
  { key: 'buttonRadius', label: 'ボタンの角の丸み', min: 0, max: 40, unit: 'px' },
]

/** デザインのひな形。色・透過・角丸だけを入れ替える(文言・画像はそのまま) */
export const LANDING_PRESETS: Array<{ id: string; label: string; style: Pick<LandingStyle, 'colors' | 'cardOpacity' | 'cardBlur' | 'cardRadius' | 'buttonRadius' | 'bgOverlayOpacity' | 'buttonOpacity'> }> = [
  { id: 'standard', label: '標準', style: {} },
  { id: 'white', label: 'ホワイト', style: { colors: { pageBg: '#ffffff', cardBg: '#ffffff', text: '#222222', button: '#06c755' }, cardRadius: 16, buttonRadius: 12 } },
  { id: 'dark', label: 'ダーク', style: { colors: { pageBg: '#0f172a', cardBg: '#1e293b', text: '#f1f5f9', button: '#06c755', buttonText: '#ffffff' } } },
  { id: 'blush', label: 'ブラッシュ', style: { colors: { pageBg: '#fdf1f3', cardBg: '#ffffff', text: '#4a3b3e', button: '#d9667d', buttonText: '#ffffff' }, cardRadius: 28, buttonRadius: 40 } },
  { id: 'glass', label: 'ガラス風(写真向き)', style: { colors: { pageBg: '#6fcf97', cardBg: '#ffffff', text: '#1f2a24', button: '#06c755', buttonText: '#ffffff', overlay: '#000000' }, cardOpacity: 68, cardBlur: 14, bgOverlayOpacity: 25, cardRadius: 28 } },
]

/** ひな形を当てる。文言・表示の切り替え・画像は残し、色・透過・ぼかし・角丸は、ひな形のもの(無い項目は既定)にする */
export function applyLandingPreset(style: LandingStyle, presetId: string): LandingStyle {
  const preset = LANDING_PRESETS.find((p) => p.id === presetId)
  if (!preset) return style
  const { colors: _c, cardOpacity: _a, cardBlur: _b, cardRadius: _r, buttonRadius: _br, bgOverlayOpacity: _o, buttonOpacity: _bo, ...keep } = style
  void [_c, _a, _b, _r, _br, _o, _bo]
  return { ...keep, ...preset.style }
}
