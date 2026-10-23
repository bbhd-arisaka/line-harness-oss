/** 検索語の位置で文章を分ける(大文字小文字は区別しない)。強調する部分に hit=true を付ける。検索語が空なら分けない */
export function splitByQuery(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const q = query.trim();
  if (!q || !text) return [{ text, hit: false }];
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const out: Array<{ text: string; hit: boolean }> = [];
  let from = 0;
  for (;;) {
    const at = lowerText.indexOf(lowerQ, from);
    if (at < 0) break;
    if (at > from) out.push({ text: text.slice(from, at), hit: false });
    out.push({ text: text.slice(at, at + lowerQ.length), hit: true });
    from = at + lowerQ.length;
  }
  if (from < text.length) out.push({ text: text.slice(from), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}

/** 一覧に出す、該当メッセージの一部。検索語の少し前から(長い文章でも、検索語が見える位置から) */
export function snippetAround(text: string, query: string, before = 20, max = 80): string {
  const flat = text.replace(/\s+/g, ' ');
  const at = flat.toLowerCase().indexOf(query.trim().toLowerCase());
  const start = at > before ? at - before : 0;
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + max)}${start + max < flat.length ? '…' : ''}`;
}
