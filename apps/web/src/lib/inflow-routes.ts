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
