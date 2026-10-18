/**
 * 友だちの名前の検索(友だち一覧・トーク一覧で共通)。
 * LINE名・本名・システム表示名の、どれかに部分一致すれば当たる。
 *
 * - 空白(半角・全角)は、無視して比べる(本名「山田 花子」を、「山田花子」でも「山田」でも探せる)
 * - LIKE のワイルドカード(% と _)は、ふつうの文字として扱う
 * - 英字の大文字・小文字は区別しない(SQLite の LIKE の挙動)
 */
const SPACES = /[ 　 \t]/g;

export const FRIEND_NAME_COLUMNS = ['f.display_name', 'f.real_name', 'f.system_display_name'] as const;

export function nameSearchCondition(columns: readonly string[], search: string): { sql: string; binds: string[] } | null {
  const needle = search.replace(SPACES, '');
  if (!needle) return null;
  const escaped = needle.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const normalized = (col: string) => `REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '　', '')`;
  return {
    sql: `(${columns.map((col) => `${normalized(col)} LIKE ? ESCAPE '\\'`).join(' OR ')})`,
    binds: columns.map(() => `%${escaped}%`),
  };
}
