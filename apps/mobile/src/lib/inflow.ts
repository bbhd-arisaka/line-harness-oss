// 流入経路(友だち追加のQR・URLを、流入経路ごとに分ける)の、型と、画面に依存しない補助。
// サーバー側は apps/worker/src/routes/inflow-routes.ts(Web の流入経路分析と同じもの)。

export interface InflowAction {
  type: string;
  params: Record<string, unknown>;
  condition: unknown | null;
  timing?: unknown;
}

/** 友だち追加ページ(/r/<ref>)の文言・配色。空・未設定の項目は、既定のまま */
export interface LandingStyle {
  title?: string | null;
  buttonText?: string | null;
  hintText?: string | null;
  showHint?: boolean;
  helpText?: string | null;
  helpLinkText?: string | null;
  showHelp?: boolean;
  colors?: { pageBg?: string | null; cardBg?: string | null; text?: string | null; button?: string | null; buttonText?: string | null };
}

/** 設定が無いときの、ページの文言と色(サーバーの既定と同じ) */
export const LANDING_DEFAULTS = {
  title: '友達追加して始める',
  buttonText: 'LINEで開く',
  hintText: '※開かない場合はボタンを長押しして「LINEで開く」を選択',
  helpText: 'うまく開けない方は',
  helpLinkText: 'こちら',
  colors: { pageBg: '#f5f7f5', cardBg: '#ffffff', text: '#444444', button: '#06c755', buttonText: '#ffffff' },
} as const;

export const LANDING_COLOR_FIELDS: Array<{ key: 'pageBg' | 'cardBg' | 'text' | 'button' | 'buttonText'; label: string }> = [
  { key: 'pageBg', label: '背景' },
  { key: 'cardBg', label: 'カード' },
  { key: 'text', label: '文字' },
  { key: 'button', label: 'ボタン' },
  { key: 'buttonText', label: 'ボタンの文字' },
];

export function isHexColor(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
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
