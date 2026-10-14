// トーク一覧の「裏の更新」: 最新の1ページ分を取り直したとき、すでに「続きを読み込む」で表示している古い分は消さない。
// (一覧は新しい順。取り直した1ページ分より古い行だけを、元の一覧から引き継ぐ)
export function mergeFreshPage<T extends { id: string; lastMessageAt: string | null }>(prev: T[], fresh: T[], pageSize: number): T[] {
  // 1ページに満たない = 全件が返っている(古い分を引き継ぐ必要がない)
  if (fresh.length < pageSize) return fresh;
  const cutoff = fresh[fresh.length - 1]?.lastMessageAt;
  if (!cutoff) return fresh;
  const ids = new Set(fresh.map((f) => f.id));
  const older = prev.filter((p) => !ids.has(p.id) && !!p.lastMessageAt && p.lastMessageAt < cutoff);
  return [...fresh, ...older];
}
