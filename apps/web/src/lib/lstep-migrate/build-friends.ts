/**
 * 友だち情報欄・タグの定義と、友だちごとの 本名・システム表示名・追加日時・タグ・値 の取り込みデータを作る
 * (build-dataset.cjs の移植)。
 */
import { csvById } from './csv'
import { groupByOwner, type MatchResult } from './match'
import type { DatasetEnvelope, DatasetField, DatasetFieldType, DatasetFolder, DatasetFriend, DatasetTag, LstepPackage } from './types'
import { normalizeJst, sha1Hex } from './util'

const TYPE: Record<string, DatasetFieldType> = { 標準: 'text', 長文: 'textarea', 選択肢: 'select', 年月日: 'date', 数値: 'number', 日時: 'datetime' }
/** 既存の beyond line の項目(フォームの代入先で使用中)に合わせるもの */
const ALIAS: Record<string, string> = { 電話番号: 'phone', 住所: 'address' }
export const fieldKeyOf = (folder: string, name: string): string =>
  (Object.prototype.hasOwnProperty.call(ALIAS, name) ? ALIAS[name] : '') || 'ls_' + sha1Hex(folder + '/' + name).slice(0, 8)

export const stripHtml = (s: unknown): string =>
  String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim()

type Var = NonNullable<LstepPackage['members'][string]>['vars'][number]
const valueOf = (v: Var): string => (v.encoded_choice_label ? stripHtml(v.encoded_choice_label) : v.value == null ? '' : String(v.value))

export interface FriendsReport {
  /** 同じ beyond の友だちに複数のLステップ記録が当たったもの */
  duplicates: Array<{ beyondId: string; chosen: string; others: string[]; names: string[] }>
  /** 決まらなかった(または衝突した)Lステップの友だち */
  unmatched: Array<{ lstepId: string; name: string; blocked: boolean; why: string; hasData: boolean }>
  warnings: string[]
}

export interface FriendsBuild {
  /** 取り込み用データ(友だち情報・タグ) */
  dataset: DatasetEnvelope
  report: FriendsReport
}

export function buildFriendsDataset(
  pkg: LstepPackage,
  matches: MatchResult[],
  accountId: string,
  accountName: string,
  opts: { builtAt?: string } = {},
): FriendsBuild {
  const warnings: string[] = []
  const members = pkg.members || {}
  const csv = csvById(pkg.csvRows)

  // ── 友だち情報欄 ──
  const folders: DatasetFolder[] = []
  const fields: DatasetField[] = []
  const fieldByName = new Map<string, DatasetField>()
  const gidToFolder = new Map<number, string>()
  ;(pkg.fieldDefs || []).forEach((f, fi) => {
    folders.push({ name: f.folder, order: fi })
    if (f.gid != null && f.gid !== '') gidToFolder.set(Number(f.gid), f.folder)
    f.rows.forEach((row, ri) => {
      // "drag_indicator お名前 標準 - 85人 star more_vert" / "... settings 選択肢 - 57人 ..."
      const m = row.replace(/^drag_indicator\s+/, '').match(/^(.*?)\s+(?:settings\s+)?(標準|長文|選択肢|年月日|数値|日時|[^\s]+)\s+(\S+)\s+(\d+)人/)
      if (!m) { warnings.push(`友だち情報欄の行を読めませんでした(${f.folder}): ${row.slice(0, 60)}`); return }
      const [, name, typeLabel, def] = m
      const d: DatasetField = {
        key: fieldKeyOf(f.folder, name), label: name, type: TYPE[typeLabel] || 'text', lstepType: typeLabel,
        folder: f.folder, order: ri, options: [], defaultValue: def === '-' ? null : def,
      }
      fields.push(d)
      fieldByName.set(f.folder + '/' + name, d)
    })
  })
  const seenKeys = new Set<string>()
  for (const f of fields) {
    if (seenKeys.has(f.key)) warnings.push(`友だち情報欄のキーが重複しています: ${f.key}(${f.label})`)
    seenKeys.add(f.key)
  }

  // 選択肢の候補は、実際に入っている値(ラベル)から集める(編集画面の選択肢一覧は未取得)
  const fieldOfVar = new Map<number, DatasetField | undefined>() // var id → 項目
  for (const m of Object.values(members)) for (const v of m.vars || []) {
    if (fieldOfVar.has(v.id)) continue
    const folder = gidToFolder.get(v.group)
    fieldOfVar.set(v.id, folder === undefined ? undefined : fieldByName.get(folder + '/' + v.name))
  }
  for (const m of Object.values(members)) for (const v of m.vars || []) {
    const f = fieldOfVar.get(v.id)
    if (f && f.type === 'select') {
      const val = valueOf(v)
      if (val && !f.options.includes(val)) f.options.push(val)
    }
  }

  // ── タグ ──
  const tags: DatasetTag[] = []
  for (const f of pkg.tagDefs || []) for (const r of f.rows) {
    // タグ名: 「…人」より前。アクション文(【追加時】…)がある場合は名前の後ろに付く
    const nameOnly = r.replace(/^drag_indicator\s+/, '').split(/\s+【追加時】|\s+\d+人/)[0].trim()
    if (nameOnly) tags.push({ name: nameOnly, folder: f.folder })
  }

  // ── 友だち ──
  const friends: DatasetFriend[] = []
  const duplicates: FriendsReport['duplicates'] = []
  for (const [beyondId, cands] of groupByOwner(matches)) {
    const chosen = cands[0]
    if (cands.length > 1) duplicates.push({ beyondId, chosen: chosen.id, others: cands.slice(1).map((c) => c.id), names: cands.map((c) => c.line) })
    const m = members[chosen.id]
    const c = csv[chosen.id] || {}
    const values: Record<string, string> = {}
    for (const v of m?.vars || []) {
      const f = fieldOfVar.get(v.id)
      if (!f) continue
      const val = valueOf(v)
      if (val !== '') values[f.key] = val
    }
    friends.push({
      beyondFriendId: beyondId, lstepId: chosen.id, how: chosen.how,
      realName: c['本名'] || null, systemDisplayName: c['システム表示名'] || null,
      addedAt: normalizeJst(c['友だち追加日時']),
      tags: [...new Set((m?.tags || []).map((t) => t.name))],
      values,
    })
  }
  const unmatched: FriendsReport['unmatched'] = matches
    .filter((mt) => !mt.pick || mt.conflict)
    .map((mt) => ({
      lstepId: mt.id, name: mt.line, blocked: mt.blocked === '1', why: mt.how || 'none',
      hasData: !!((members[mt.id]?.vars || []).length || (members[mt.id]?.tags || []).length),
    }))

  const dataset: DatasetEnvelope = {
    version: 1, source: 'lstep', accountId, accountName, builtAt: opts.builtAt ?? new Date().toISOString(),
    folders, fields, tags, friends,
  }
  return { dataset, report: { duplicates, unmatched, warnings } }
}
