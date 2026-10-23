/**
 * トークの入力途中の文章を、ブラウザに残す(トークごと)。
 * 閉じても・別のページへ移っても・ブラウザを閉じても、開き直したら続きから打てる。この端末のブラウザの中だけに保存する。
 */
const PREFIX = 'chat.draft.'

export function loadDraft(chatId: string): string {
  try {
    return localStorage.getItem(PREFIX + chatId) ?? ''
  } catch {
    return ''
  }
}

/** 文章が空になったら、そのトークの下書きは消す */
export function saveDraft(chatId: string, text: string): void {
  try {
    if (text.trim() === '') localStorage.removeItem(PREFIX + chatId)
    else localStorage.setItem(PREFIX + chatId, text)
  } catch {
    // 保存できなくても、入力は続けられる
  }
}

/** 取り消した文章を入力欄に戻す。入力欄にすでに続きがあるときは、その前に足す */
export function restoreText(restored: string, current: string): string {
  return current.trim() ? `${restored}\n${current}` : restored
}

/** 「送信の取り消し」(送信を10秒待たせて、そのあいだ取り消せる)のオン・オフ。この端末のブラウザの設定 */
const UNDO_KEY = 'chat.undoSend'

export function loadUndoSend(): boolean {
  try {
    return localStorage.getItem(UNDO_KEY) === '1'
  } catch {
    return false
  }
}

export function saveUndoSend(on: boolean): void {
  try {
    localStorage.setItem(UNDO_KEY, on ? '1' : '0')
  } catch {
    // 保存できなくても、開いている間は効く
  }
}
