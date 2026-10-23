/** トークごとの入力途中の文章(トークのID → 文章)。空の文章は持たない */
export type DraftMap = Record<string, string>;

/** 保存してある文字列(JSON)から読み戻す。壊れていても、空として扱う */
export function parseDrafts(raw: string | null | undefined): DraftMap {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: DraftMap = {};
    for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
      if (typeof t === 'string' && t.trim() !== '') out[k] = t;
    }
    return out;
  } catch {
    return {};
  }
}

/** 1つのトークの下書きを入れ替えた、新しい一覧。文章が空なら、そのトークの下書きは消す */
export function withDraft(map: DraftMap, chatId: string, text: string): DraftMap {
  const next = { ...map };
  if (text.trim() === '') delete next[chatId];
  else next[chatId] = text;
  return next;
}

/** 取り消した文章を入力欄に戻す。入力欄にすでに続きがあるときは、その前に足す */
export function restoreText(restored: string, current: string): string {
  return current.trim() ? `${restored}\n${current}` : restored;
}
