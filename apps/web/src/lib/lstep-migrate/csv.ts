/** CSV(Shift-JIS から文字列にしたもの)を行×列に分ける。引用符・引用符内の改行・"" に対応。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else q = false
      } else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

/**
 * 友だち一覧CSV(0行目=タイトル / 1行目=見出し / 2行目以降=データ)から、ID → { 見出し: 値 } を作る。
 * ID(列0)が空の行は捨てる。
 */
export function csvById(csvRows: string[][]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  const header = csvRows[1]
  if (!header) return out
  for (const r of csvRows.slice(2)) {
    if (!r[0]) continue
    const o: Record<string, string> = {}
    header.forEach((h, i) => { o[h] = r[i] ?? '' })
    out[o['ID']] = o
  }
  return out
}
