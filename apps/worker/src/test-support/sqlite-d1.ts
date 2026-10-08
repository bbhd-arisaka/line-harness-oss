// Local/test adapter only. Production routes use the Cloudflare D1 binding.
import Database from 'better-sqlite3';
type SQLInputValue = string | number | bigint | Buffer | null;
export function sqliteD1(path = ':memory:'): { db: D1Database; sqlite: Database.Database } {
  const sqlite = new Database(path);
  // テスト用の互換: 多くのフィクスチャは friends に line_user_id だけを入れる。本番の内部キー
  // line_user_key(NOT NULL)を、テストでは未指定なら line_user_id から自動補完する。
  const rawExec = sqlite.exec.bind(sqlite);
  sqlite.exec = ((sql: string) => {
    const patched = sql.replace(/line_user_key[ 	]+TEXT UNIQUE NOT NULL/, 'line_user_key TEXT UNIQUE');
    const result = rawExec(patched);
    if (patched !== sql) {
      rawExec(`CREATE TRIGGER IF NOT EXISTS trg_test_friends_key AFTER INSERT ON friends
        WHEN NEW.line_user_key IS NULL
        BEGIN UPDATE friends SET line_user_key = NEW.line_user_id WHERE id = NEW.id; END`);
    }
    return result;
  }) as typeof sqlite.exec;
  function prepare(sql: string, values: SQLInputValue[] = []): D1PreparedStatement {
    return {
      bind(...args: unknown[]) { return prepare(sql, args as SQLInputValue[]); },
      async first<T>(column?: string) {
        const row = sqlite.prepare(sql).get(...values) as Record<string, SQLInputValue> | undefined;
        return (column ? row?.[column] ?? null : row ?? null) as T | null;
      },
      async all<T>() {
        const results = sqlite.prepare(sql).all(...values) as T[];
        return { success: true, results, meta: { changes: 0, duration: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: results.length, rows_written: 0 } };
      },
      async run<T>() {
        const info = sqlite.prepare(sql).run(...values);
        return { success: true, results: [] as T[], meta: { changes: Number(info.changes), duration: 0, last_row_id: Number(info.lastInsertRowid), changed_db: !!info.changes, size_after: 0, rows_read: 0, rows_written: Number(info.changes) } };
      },
      async raw<T>() { return sqlite.prepare(sql).all(...values).map(row => Object.values(row as Record<string, SQLInputValue>)) as T[]; },
    } as D1PreparedStatement;
  }
  const db = {
    prepare,
    // 複数の文を順に実行する(本物の D1 の batch の代わり)
    async batch(stmts: D1PreparedStatement[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
