/**
 * フォームのタグコード: `{{form_url:フォームID}}`
 * 送信時に、送信アカウントの LIFF で組み立てたフォームのリンクに置き換わる(サーバー側 expandFormLinks)。
 * 管理画面の入力欄では、タグコードを青い枠の「フォーム名」として表示する。
 */
export const FORM_TAG_PATTERN = '\\{\\{form_url:([^}\\s]+)\\}\\}'

export function formTagCode(formId: string): string {
  return `{{form_url:${formId}}}`
}

/** テキストの中に含まれるフォームのタグコードを、(前の文字列, フォームID or null) の並びに分ける。 */
export function splitFormTags(text: string): Array<{ text: string } | { formId: string }> {
  const re = new RegExp(FORM_TAG_PATTERN, 'g')
  const parts: Array<{ text: string } | { formId: string }> = []
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) })
    parts.push({ formId: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/* ────────────────── 差し込み語（名前・友だち情報・予約など） ────────────────── */

/**
 * 差し込み語: `{{name}}` `{{friend_id}}` `{{uid}}` `{{liff_id}}` `{{form}}`
 *            `{{metadata.友だち情報欄のキー}}` `{{reserve.xxx}}`
 * 送信時にサーバー側が、お客様ごとの値に置き換える。
 * 管理画面の入力欄では、波かっこの文字ではなく、色付きの枠の日本語名で見せる
 * （1文字消すと効かなくなる記号を、人が直接さわらなくてよいようにする）。
 */
export const VARIABLE_PATTERN =
  '\{\{(name|friend_id|uid|liff_id|form|metadata\.[^}\s]+|reserve\.[^}\s]+)\}\}'

export type TagPart = { text: string } | { formId: string } | { variable: string }

/** どちらの形のタグにも一致する（入力欄で打った・貼ったタグを枠に直すのに使う） */
export const ANY_TAG_PATTERN = `${FORM_TAG_PATTERN}|${VARIABLE_PATTERN}`

export function variableCode(key: string): string {
  return `{{${key}}}`
}

/** テキストを、(ふつうの文字 / フォームのタグ / 差し込み語) の並びに分ける。 */
export function splitTags(text: string): TagPart[] {
  const re = new RegExp(ANY_TAG_PATTERN, 'g')
  const parts: TagPart[] = []
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) })
    if (m[1] !== undefined) parts.push({ formId: m[1] })
    else parts.push({ variable: m[2] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

const VARIABLE_LABELS: Record<string, string> = {
  name: '名前',
  friend_id: '友だちID',
  uid: 'ユーザーID',
  liff_id: 'LIFF ID',
  form: 'フォーム名',
  'reserve.name': '予約者名',
  'reserve.price': '料金',
  'reserve.datetime': '予約日時',
  'reserve.course': 'コース名',
  'reserve.slot': '予約枠',
  'reserve.url': '予約確認URL',
  'reserve.before.datetime': '変更前の予約日時',
  'reserve.before.course': '変更前のコース名',
  'reserve.before.slot': '変更前の予約枠',
  'reserve.before.price': '変更前の料金',
}

/**
 * 枠に出す日本語名。
 * 友だち情報欄は名前をサーバーから読むので、読めるまで（または欄が消えたとき）はキーを出す。
 */
export function variableLabel(key: string, fieldLabels?: ReadonlyMap<string, string>): string {
  if (key.startsWith('metadata.')) {
    const fieldKey = key.slice('metadata.'.length)
    return `友だち情報：${fieldLabels?.get(fieldKey) ?? fieldKey}`
  }
  return VARIABLE_LABELS[key] ?? key
}

/** 色の系統。同じ種類の語は同じ色にして、見分けやすくする */
export function variableTone(key: string): 'name' | 'id' | 'info' | 'reserve' | 'other' {
  if (key === 'name') return 'name'
  if (key === 'friend_id' || key === 'uid' || key === 'liff_id') return 'id'
  if (key.startsWith('metadata.')) return 'info'
  if (key.startsWith('reserve.')) return 'reserve'
  return 'other'
}

const TONE_CLASS: Record<ReturnType<typeof variableTone>, string> = {
  name: 'border-sky-300 bg-sky-50 text-sky-800',
  id: 'border-slate-300 bg-slate-50 text-slate-700',
  info: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  reserve: 'border-amber-300 bg-amber-50 text-amber-800',
  other: 'border-violet-300 bg-violet-50 text-violet-800',
}

/** 差し込み語の枠の見た目（入力欄・読み取り表示・ヘルプ文で同じにする） */
export const VARIABLE_CHIP_BASE =
  'mx-0.5 inline-block select-none rounded border px-1.5 text-[13px] leading-5 align-baseline'

export function variableChipClass(key: string): string {
  return `${VARIABLE_CHIP_BASE} ${TONE_CLASS[variableTone(key)]}`
}
