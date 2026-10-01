/**
 * フォーム回答の引き継ぎデータを作る(forms-map.cjs + forms-build.cjs の汎用版)。
 *
 *  1. Lステップのフォームごとに、beyond line のフォームを名前で探す(決まらなければ人が選ぶ)。
 *  2. 回答CSVの列を、beyond のフォームの質問に割り当てる(ラベル一致 → 同見出しの2回目 → 記述 → その他の回答 → 位置)。
 *  3. 割り当てられなかった列は、隠し項目(lstep_extra_N)で受ける。
 *  4. 回答を作る。友だちは突き合わせ結果から(決まらなければ持ち主なし)。
 *
 * 大門店専用の手書き割り当て(友だち情報欄への代入先の是正)は含まない。
 */
import { beyondOf, type MatchResult } from './match'
import type { BeyondForm, BeyondFormField, DatasetEnvelope, DatasetSubmission, FormAddField, FormConfig, LstepPackage } from './types'
import { normalizeJst } from './util'

const NONANS = ['heading', 'subheading', 'paragraph', 'image', 'divider']
const norm = (s: string | undefined | null) => (s || '').normalize('NFKC').replace(/\s+/g, '').replace(/[()（）「」『』]/g, '').toLowerCase()

export type ColumnKind = 'field' | 'other' | 'catchall' | 'positional' | 'unmapped'
export interface ColumnAssignment {
  /** CSV の列番号(0始まり。質問は4列目から) */
  col: number
  header: string
  kind: ColumnKind
  /** 割り当て先の質問(beyond のフォームの field.name)。catchall / unmapped は null */
  fieldName: string | null
}

export function parseFormFields(f: BeyondForm): BeyondFormField[] {
  if (Array.isArray(f.fields)) return f.fields
  try {
    const x = JSON.parse(f.fields || '[]')
    return Array.isArray(x) ? x : []
  } catch { return [] }
}

/**
 * 列 → 質問 の割り当て(forms-map.cjs と同じアルゴリズム)。
 * fields は回答しない部品(見出し・段落・画像・区切り)を除いた、質問だけの並び。
 */
export function mapColumns(head: string[], fields: BeyondFormField[]): { colMap: ColumnAssignment[]; unusedFields: string[] } {
  const colMap: ColumnAssignment[] = []
  const allHeaders = head.slice(4).map(norm)
  let p = 0
  let last: BeyondFormField | null = null
  for (let c = 4; c < head.length; c++) {
    const h = head[c]
    const nh = norm(h)
    // 1) ラベル一致(これから先の質問から探す)
    let idx = -1
    for (let k = p; k < fields.length; k++) if (norm(fields[k].label) === nh) { idx = k; break }
    // 1b) 同じ見出しの2回目: 直後の質問が「追加質問(ラベルがどの列見出しとも一致しない)」ならそれ
    if (idx < 0 && c > 4 && norm(head[c - 1]) === nh && p < fields.length) {
      const nextLabel = norm(fields[p].label)
      if (!new Set(head.slice(c + 1).map(norm)).has(nextLabel) && !head.slice(4, c).map(norm).includes(nextLabel)) idx = p
    }
    if (idx >= 0) { colMap.push({ col: c, header: h, kind: 'field', fieldName: fields[idx].name }); p = idx + 1; last = fields[idx]; continue }
    // 2) 「その他(記述)」「…(記述)」: 直前の質問の「その他」として足す
    if (/記述/.test(h) && last) { colMap.push({ col: c, header: h, kind: 'other', fieldName: last.name }); continue }
    // 3) 「その他の回答」: 最後の捕まえ列
    if (/その他の回答/.test(h)) { colMap.push({ col: c, header: h, kind: 'catchall', fieldName: null }); continue }
    // 4) 位置で対応(同意文など、ラベルが列見出しと違う質問): 次の質問が、どの列見出しとも一致しないものなら対応させる
    if (p < fields.length && !allHeaders.includes(norm(fields[p].label))) {
      colMap.push({ col: c, header: h, kind: 'positional', fieldName: fields[p].name }); last = fields[p]; p++; continue
    }
    colMap.push({ col: c, header: h, kind: 'unmapped', fieldName: null })
  }
  return { colMap, unusedFields: fields.slice(p).map((x) => x.name) }
}

// ── フォームの名前での対応づけ ───────────────────────────────────────

export interface FormCandidate { id: string; name: string }
export type FormMatchHow = 'exact' | 'normalized' | 'prefix' | 'partial' | 'manual' | 'ambiguous' | 'none'

/** 完全一致 → 正規化一致 → 前方一致 → 部分一致。各段階で1件に決まる場合だけ採用。 */
export function findBeyondForm(lstepName: string, beyondForms: BeyondForm[]): { form: BeyondForm | null; how: FormMatchHow; ambiguous: BeyondForm[] } {
  const ln = norm(lstepName)
  const tiers: Array<[FormMatchHow, (f: BeyondForm) => boolean]> = [
    ['exact', (f) => f.name === lstepName],
    ['normalized', (f) => !!ln && norm(f.name) === ln],
    ['prefix', (f) => ln.length >= 2 && norm(f.name).length >= 2 && (norm(f.name).startsWith(ln) || ln.startsWith(norm(f.name)))],
    ['partial', (f) => ln.length >= 2 && norm(f.name).length >= 2 && (norm(f.name).includes(ln) || ln.includes(norm(f.name)))],
  ]
  for (const [how, test] of tiers) {
    const hit = beyondForms.filter(test)
    if (hit.length === 1) return { form: hit[0], how, ambiguous: [] }
    if (hit.length > 1) return { form: null, how: 'ambiguous', ambiguous: hit }
  }
  return { form: null, how: 'none', ambiguous: [] }
}

const bigrams = (s: string) => { const out = new Set<string>(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); if (s.length === 1) out.add(s); return out }
function similarity(a: string, b: string): number {
  const A = bigrams(norm(a)), B = bigrams(norm(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

// ── 本体 ─────────────────────────────────────────────────────────────

export interface FormReport {
  lid: string
  name: string
  status: 'mapped' | 'unmatched' | 'empty'
  how: FormMatchHow
  beyondFormId: string | null
  beyondFormName: string | null
  answers: number
  answersWithoutFriend: number
  columns: ColumnAssignment[]
  unmappedColumns: string[]
  /** どの列とも対応しなかった質問 */
  neverFilledFields: string[]
  /** 未対応のとき、人が選べるように */
  candidates: FormCandidate[]
}

export interface FormsBuild {
  configs: FormConfig[]
  submissions: DatasetSubmission[]
  forms: FormReport[]
  /** 未対応のフォーム(beyond に対応する質問票を人が選ぶ) */
  unmatchedForms: FormReport[]
  warnings: string[]
  /** 取り込み用データ(フォーム) */
  dataset: DatasetEnvelope
}

export interface FormsOptions {
  /** 人が決めた対応づけ: Lステップのフォームid(lid) → beyond のフォームid */
  formPicks?: Record<string, string>
  accountId?: string
  accountName?: string
  builtAt?: string
}

export function buildFormsDataset(
  pkg: LstepPackage,
  matches: MatchResult[],
  beyondForms: BeyondForm[],
  opts: FormsOptions = {},
): FormsBuild {
  const warnings: string[] = []
  const owner = beyondOf(matches)
  const reports: FormReport[] = []
  const submissions: DatasetSubmission[] = []
  const configById = new Map<string, FormConfig>()
  const usedExtra = new Map<string, Set<string>>() // beyondFormId → 追加した隠し項目名

  for (const lf of pkg.forms || []) {
    const picked = opts.formPicks?.[lf.lid] ? beyondForms.find((b) => b.id === opts.formPicks![lf.lid]) : undefined
    let found: ReturnType<typeof findBeyondForm>
    if (picked) found = { form: picked, how: 'manual', ambiguous: [] }
    else found = findBeyondForm(lf.name, beyondForms)

    const rows = lf.csvRows || []
    const base: FormReport = {
      lid: lf.lid, name: lf.name, status: 'unmatched', how: found.how, beyondFormId: null, beyondFormName: null,
      answers: rows.slice(1).filter((r) => r[0]).length, answersWithoutFriend: 0, columns: [], unmappedColumns: [], neverFilledFields: [], candidates: [],
    }
    if (!found.form) {
      const pool = found.ambiguous.length ? found.ambiguous : beyondForms
      base.candidates = pool
        .map((b) => ({ b, s: found.ambiguous.length ? 1 + similarity(lf.name, b.name) : similarity(lf.name, b.name) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5)
        .map((x) => ({ id: x.b.id, name: x.b.name }))
      reports.push(base)
      continue
    }
    if (!rows.length || !rows[0]) {
      warnings.push(`フォーム「${lf.name}」(${lf.lid})の回答CSVが空です`)
      reports.push({ ...base, status: 'empty', beyondFormId: found.form.id, beyondFormName: found.form.name })
      continue
    }

    const bform = found.form
    const fields = parseFormFields(bform).filter((x) => !NONANS.includes(x.type))
    const byName = new Map(fields.map((f) => [f.name, f]))
    const head = rows[0]
    const { colMap } = mapColumns(head, fields)

    // unmapped の列 → 隠し項目(同じ beyond のフォームに2つの Lステップのフォームが対応するときは、名前がぶつからないようにする)
    const used = usedExtra.get(bform.id) ?? new Set<string>()
    usedExtra.set(bform.id, used)
    const extraName = new Map<number, string>()
    const addFields: FormAddField[] = []
    for (const m of colMap) {
      if (m.kind !== 'unmapped') continue
      let name = `lstep_extra_${m.col - 4}`
      if (used.has(name) || byName.has(name)) name = `lstep_extra_${lf.lid}_${m.col - 4}`
      used.add(name)
      extraName.set(m.col, name)
      addFields.push({ name, label: `${m.header.replace(/\s+/g, ' ')}(Lステップの追加項目)`, type: 'text', hidden: true })
    }
    const cfg = configById.get(bform.id)
    if (cfg) cfg.addFields = [...(cfg.addFields ?? []), ...addFields]
    else configById.set(bform.id, { formId: bform.id, formName: bform.name, saveToMetadata: false, fields: {}, addFields })

    let withoutFriend = 0
    for (const r of rows.slice(1).filter((x) => x[0])) {
      const data: Record<string, unknown> = {}
      const setOther = (name: string, label: string, val: string) => {
        const bf = byName.get(name)
        const cur = data[name]
        const txt = `${label}: ${val}`
        if (Array.isArray(cur)) cur.push(txt)
        else if (cur !== undefined) data[name] = `${cur} / ${txt}`
        else data[name] = bf && bf.type === 'checkbox' ? [txt] : txt
      }
      let other: string | null = null
      for (const m of colMap) {
        const raw = (r[m.col] ?? '').toString()
        if (raw === '') continue
        if (m.kind === 'field' || m.kind === 'positional') {
          const bf = byName.get(m.fieldName as string)
          if (!bf) continue
          data[bf.name] = bf.type === 'checkbox' ? raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : raw.replace(/\r\n/g, '\n')
        } else if (m.kind === 'other' && m.fieldName) {
          setOther(m.fieldName, m.header.replace(/[(（]記述[)）]/g, '') || 'その他', raw.replace(/\r?\n/g, ' '))
        } else if (m.kind === 'catchall') other = raw
        else if (m.kind === 'unmapped') data[extraName.get(m.col) as string] = raw
      }
      const rid = r[2]
      const beyondId = owner.get(rid) ?? null
      if (!beyondId) withoutFriend++
      const when = normalizeJst(r[1])
      if (!when) { warnings.push(`フォーム「${lf.name}」の回答 ${r[0]} は日時を読めないため除きました(${r[1]})`); continue }
      data._lstep = { key: `lstep:${lf.lid}:${r[0]}`, answerId: r[0], respondentId: rid, respondentName: r[3], ...(other ? { otherAnswers: other } : {}) }
      submissions.push({ formId: bform.id, beyondFriendId: beyondId, createdAt: `${when}.000+09:00`, data: data as DatasetSubmission['data'] })
    }
    reports.push({
      ...base, status: 'mapped', beyondFormId: bform.id, beyondFormName: bform.name, answersWithoutFriend: withoutFriend,
      columns: colMap,
      unmappedColumns: colMap.filter((m) => m.kind === 'unmapped').map((m) => m.header),
      neverFilledFields: fields.filter((f) => !colMap.some((m) => m.fieldName === f.name)).map((f) => f.name),
    })
  }

  const configs = [...configById.values()]
  const dataset: DatasetEnvelope = {
    version: 1, source: 'lstep', accountId: opts.accountId ?? '', accountName: opts.accountName ?? '',
    builtAt: opts.builtAt ?? new Date().toISOString(), folders: [], fields: [], tags: [], friends: [],
    forms: { configs, submissions },
  }
  return { configs, submissions, forms: reports, unmatchedForms: reports.filter((r) => r.status === 'unmatched'), warnings, dataset }
}
