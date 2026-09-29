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
