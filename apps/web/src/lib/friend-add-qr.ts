/** 友だち追加の QR・URL の、画面に依存しない部分 */

/** 保存する画像のファイル名(アカウント名・ID から、ファイル名に使えない文字を除く) */
export function qrFileName(accountName: string, basicId: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s@]+/g, '').slice(0, 40)
  const name = safe(accountName) || 'line'
  const id = safe(basicId)
  return `友だち追加QR_${name}${id ? `_${id}` : ''}.png`
}

/** クリップボードにコピーする。使えない環境(古いブラウザ・権限なし)では、選択+コピーの方法に切り替える。成功したら true */
export async function copyText(text: string, doc: Document = document, nav: Navigator = navigator): Promise<boolean> {
  try {
    if (nav.clipboard?.writeText) {
      await nav.clipboard.writeText(text)
      return true
    }
  } catch {
    // 権限がないときは、下の方法を試す
  }
  try {
    const ta = doc.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    doc.body.appendChild(ta)
    ta.select()
    const ok = doc.execCommand('copy')
    doc.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
