// 友だちリストの「詳細検索」(Lステップの「絞り込み条件を設定」相当)の条件の型と、表示用の補助。
// サーバー側(apps/worker/src/services/friend-filter.ts)と同じ形。

export type TagMode = 'any' | 'all' | 'none_any' | 'none_all'
export type FieldOp = 'eq' | 'contains' | 'exists' | 'missing' | 'neq' | 'ncontains' | 'gte' | 'gt' | 'lte' | 'lt'
export type NameTarget = 'display' | 'real' | 'system'
export type ChatStatusValue = 'unread' | 'in_progress' | 'resolved'
export type ScenarioState = 'active' | 'ever' | 'none'
export type MemoOp = 'contains' | 'not_contains' | 'exists' | 'missing'

export type FriendCondition =
  | { type: 'name'; value: string; targets: NameTarget[] }
  | { type: 'memo'; op: MemoOp; value: string }
  | { type: 'statusMessage'; value: string }
  | { type: 'addedDate'; from: string | null; to: string | null }
  | { type: 'chatStatus'; statuses: ChatStatusValue[] }
  | { type: 'tag'; tagIds: string[]; mode: TagMode }
  | { type: 'field'; fieldKey: string; op: FieldOp; value: string }
  | { type: 'scenario'; scenarioId: string; state: ScenarioState }
  | { type: 'form'; formId: string; answered: boolean }
  | { type: 'lastReaction'; from: string | null; to: string | null }
  | { type: 'inflow'; value: string }

export interface FriendFilter {
  and: FriendCondition[]
  or: FriendCondition[][]
  showFollowing: boolean
  showBlocked: boolean
}

export const TAG_MODE_LABEL: Record<TagMode, string> = {
  any: '選択したタグのいずれか1つ以上を含む人',
  all: '選択したタグを全て含む人',
  none_any: '選択したタグを1つ以上含む人を除外',
  none_all: '選択したタグを全て含む人を除外',
}

export const FIELD_OP_LABEL: Record<FieldOp, string> = {
  eq: '完全一致',
  contains: '部分一致',
  exists: '登録あり',
  missing: '登録なし',
  neq: '完全一致除外',
  ncontains: '部分一致除外',
  gte: '以上(≧)',
  gt: 'より大きい(＞)',
  lte: '以下(≦)',
  lt: 'より小さい(＜)',
}

export const CHAT_STATUS_LABEL: Record<ChatStatusValue, string> = {
  unread: '未対応',
  in_progress: '対応中',
  resolved: '対応済み',
}

export const SCENARIO_STATE_LABEL: Record<ScenarioState, string> = {
  active: '配信中',
  ever: '登録したことがある',
  none: '登録していない',
}

export const MEMO_OP_LABEL: Record<MemoOp, string> = {
  contains: '含む',
  not_contains: '含まない',
  exists: '登録あり',
  missing: '登録なし',
}

export function emptyFilter(): FriendFilter {
  return { and: [], or: [], showFollowing: true, showBlocked: false }
}

/** 中身のない条件(値が空など)かどうか。空の行は、検索に含めない */
export function isConditionEmpty(c: FriendCondition): boolean {
  switch (c.type) {
    case 'name': return c.value.trim() === '' || c.targets.length === 0
    case 'memo': return (c.op === 'contains' || c.op === 'not_contains') && c.value.trim() === ''
    case 'statusMessage': return c.value.trim() === ''
    case 'addedDate':
    case 'lastReaction': return !c.from && !c.to
    case 'chatStatus': return c.statuses.length === 0
    case 'tag': return c.tagIds.length === 0
    case 'field': return !c.fieldKey || (c.op !== 'exists' && c.op !== 'missing' && c.value === '')
    case 'scenario': return !c.scenarioId
    case 'form': return !c.formId
    case 'inflow': return c.value.trim() === ''
  }
}

/** 空の条件を取り除く(orグループが空になったら、そのグループも外す) */
export function cleanFilter(f: FriendFilter): FriendFilter {
  return {
    ...f,
    and: f.and.filter((c) => !isConditionEmpty(c)),
    or: f.or.map((g) => g.filter((c) => !isConditionEmpty(c))).filter((g) => g.length > 0),
  }
}

export function isFilterEmpty(f: FriendFilter): boolean {
  const c = cleanFilter(f)
  return c.and.length === 0 && c.or.length === 0 && c.showFollowing && !c.showBlocked
}

export interface DescribeContext {
  tags: Array<{ id: string; name: string }>
  fields: Array<{ fieldKey: string; label: string }>
  scenarios: Array<{ id: string; name: string }>
  forms: Array<{ id: string; name: string }>
}

function range(from: string | null, to: string | null): string {
  if (from && to) return `${from}〜${to}`
  if (from) return `${from}以降`
  return `${to}まで`
}

/** 条件を、読める日本語にする(例: 名前にtameikeを含む) */
export function describeCondition(c: FriendCondition, ctx: DescribeContext): string {
  const tagName = (id: string) => ctx.tags.find((t) => t.id === id)?.name ?? '(削除されたタグ)'
  switch (c.type) {
    case 'name': return `名前に${c.value}を含む`
    case 'memo': return c.op === 'exists' ? '個別メモが登録あり' : c.op === 'missing' ? '個別メモが登録なし' : `個別メモに${c.value}を${c.op === 'contains' ? '含む' : '含まない'}`
    case 'statusMessage': return `ステータスメッセージに${c.value}を含む`
    case 'addedDate': return `友だち登録日が${range(c.from, c.to)}`
    case 'chatStatus': return `対応マークが${c.statuses.map((s) => CHAT_STATUS_LABEL[s]).join('・')}`
    case 'tag': return `タグ「${c.tagIds.map(tagName).join('」「')}」${TAG_MODE_LABEL[c.mode].replace('選択したタグ', '')}`
    case 'field': {
      const label = ctx.fields.find((f) => f.fieldKey === c.fieldKey)?.label ?? c.fieldKey
      return c.op === 'exists' || c.op === 'missing' ? `${label}が${FIELD_OP_LABEL[c.op]}` : `${label}が「${c.value}」の${FIELD_OP_LABEL[c.op]}`
    }
    case 'scenario': return `シナリオ「${ctx.scenarios.find((s) => s.id === c.scenarioId)?.name ?? '(削除されたシナリオ)'}」を${SCENARIO_STATE_LABEL[c.state]}`
    case 'form': return `フォーム「${ctx.forms.find((f) => f.id === c.formId)?.name ?? '(削除されたフォーム)'}」に${c.answered ? '回答した' : '回答していない'}`
    case 'lastReaction': return `最終反応日が${range(c.from, c.to)}`
    case 'inflow': return `流入経路に${c.value}を含む`
  }
}

export function describeFilter(f: FriendFilter, ctx: DescribeContext): string {
  const c = cleanFilter(f)
  const parts: string[] = []
  if (c.and.length) parts.push(c.and.map((x) => describeCondition(x, ctx)).join(' かつ '))
  for (const g of c.or) parts.push(`(${g.map((x) => describeCondition(x, ctx)).join(' または ')})`)
  const shown = [c.showFollowing ? '表示中' : '', c.showBlocked ? 'ブロックした人' : ''].filter(Boolean)
  if (!c.showFollowing || c.showBlocked) parts.push(`対象: ${shown.join('・') || 'なし'}`)
  return parts.join(' かつ ') || '条件なし'
}
