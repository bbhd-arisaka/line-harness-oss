// 友だち追加時設定の「アクション設定」(Lステップと同じ並び)の型と、表示用の補助。
// サーバー側(packages/db/src/friend-add-settings.ts)と同じ形。

import type { FriendFilter } from './friend-filter'

export type FriendAddKindItem = 'new' | 'returning'

export type FriendAddTimingItem =
  | { mode: 'now' }
  | { mode: 'delay'; amount: number; unit: 'minutes' | 'hours' | 'days' }
  | { mode: 'at'; days: number; time: string }

export type FriendAddActionType = 'rich_menu' | 'text' | 'template' | 'tag' | 'friend_field' | 'reminder' | 'conversion'

export interface FriendAddActionItem {
  type: FriendAddActionType
  params: Record<string, unknown>
  condition: FriendFilter | null
  timing?: FriendAddTimingItem
}

export interface FriendAddSettingItem {
  lineAccountId: string
  kind: FriendAddKindItem
  scenarioId: string | null
  actions: FriendAddActionItem[]
  updatedAt: string | null
}

export const ACTION_TYPE_LABEL: Record<FriendAddActionType, string> = {
  rich_menu: 'メニュー操作',
  text: 'テキスト送信',
  template: 'テンプレート送信',
  tag: 'タグ操作',
  friend_field: '友だち情報操作',
  reminder: 'リマインダ操作',
  conversion: 'コンバージョン操作',
}

/** 追加ボタンの並び(Lステップと同じ)。サーバーが対応していないものは available: false(準備中) */
export const ACTION_BUTTONS: Array<{ type: FriendAddActionType | 'event_booking' | 'common_info'; label: string; available: boolean }> = [
  { type: 'text', label: 'テキスト送信', available: true },
  { type: 'template', label: 'テンプレート送信', available: true },
  { type: 'tag', label: 'タグ操作', available: true },
  { type: 'friend_field', label: '友だち情報操作', available: true },
  { type: 'rich_menu', label: 'メニュー操作', available: true },
  { type: 'reminder', label: 'リマインダ操作', available: true },
  { type: 'event_booking', label: 'イベント予約操作', available: false },
  { type: 'common_info', label: '共通情報操作', available: false },
  { type: 'conversion', label: 'コンバージョン操作', available: true },
]

export interface ActionLookups {
  tags: Array<{ id: string; name: string }>
  templates: Array<{ id: string; name: string }>
  menus: Array<{ id: string; name: string }>
  fields: Array<{ fieldKey: string; label: string }>
  reminders: Array<{ id: string; name: string }>
  conversions: Array<{ id: string; name: string }>
}

export function newAction(type: FriendAddActionType): FriendAddActionItem {
  switch (type) {
    case 'rich_menu': return { type, params: { menu: 'default' }, condition: null }
    case 'text': return { type, params: { content: '' }, condition: null, timing: { mode: 'now' } }
    case 'template': return { type, params: { templateId: '' }, condition: null, timing: { mode: 'now' } }
    case 'tag': return { type, params: { op: 'add', tagIds: [] }, condition: null }
    case 'friend_field': return { type, params: { fieldKey: '', op: 'set', value: '' }, condition: null }
    case 'reminder': return { type, params: { op: 'start', reminderId: '' }, condition: null }
    case 'conversion': return { type, params: { conversionPointId: '' }, condition: null }
  }
}

const clip = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** 一覧のカードの見出しの太字部分(例: 「デフォルトメニューにする」) */
export function describeAction(a: FriendAddActionItem, ctx: ActionLookups): string {
  const p = a.params
  const name = <T extends { id: string; name: string }>(list: T[], id: unknown) => list.find((x) => x.id === id)?.name ?? '未選択'
  switch (a.type) {
    case 'rich_menu': return p.menu === 'default' ? 'デフォルトメニューにする' : `メニュー[${name(ctx.menus, p.menu)}]に変更`
    case 'text': return `テキスト[${clip(String(p.content ?? '').replace(/\s+/g, ' ') || '(未入力)')}]を送信`
    case 'template': return `テンプレート[${name(ctx.templates, p.templateId)}]を送信`
    case 'tag': {
      const ids = (p.tagIds as string[] | undefined) ?? []
      return `タグ[${ids.map((id) => name(ctx.tags, id)).join('、') || '未選択'}]を${p.op === 'remove' ? 'はずす' : '追加'}`
    }
    case 'friend_field': {
      const label = ctx.fields.find((f) => f.fieldKey === p.fieldKey)?.label ?? '未選択'
      const verb = p.op === 'add' ? '加算' : p.op === 'sub' ? '減算' : '代入'
      return `友だち情報[${label}]に[${String(p.value ?? '')}]を${verb}`
    }
    case 'reminder': return `リマインダ[${name(ctx.reminders, p.reminderId)}]を${p.op === 'cancel' ? 'キャンセル' : '開始'}`
    case 'conversion': return `コンバージョン[${name(ctx.conversions, p.conversionPointId)}]を通過`
  }
}

export function describeTiming(t: FriendAddTimingItem | undefined): string {
  if (!t || t.mode === 'now') return 'すぐに送信する'
  if (t.mode === 'delay') return `${t.amount}${t.unit === 'minutes' ? '分' : t.unit === 'hours' ? '時間' : '日'}後に送信する`
  return `${t.days === 0 ? '当日' : `${t.days}日後`}の${t.time}に送信する`
}
