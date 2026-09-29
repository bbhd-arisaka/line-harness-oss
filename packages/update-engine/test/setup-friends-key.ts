// テスト用の互換: 多くのフィクスチャは friends に line_user_id(LINE のユーザーID)だけを入れる。
// 本番では内部キー line_user_key(082 で line_user_id から改名した UNIQUE NOT NULL 列)を必ず
// 指定するが、テストでは未指定なら line_user_id から自動補完する。
// (スキーマ/マイグレーションを流し込む better-sqlite3 の exec を差し替える。本番コードには影響しない)
import Database from 'better-sqlite3';

const proto = Database.prototype as unknown as { exec: (sql: string) => unknown };
const originalExec = proto.exec;

const NOT_NULL_KEY = /(line_user_key|line_user_id)([ \t]+TEXT UNIQUE) NOT NULL/;

proto.exec = function patchedExec(this: unknown, sql: string) {
  let patched = sql;
  // schema.sql(改名前)と bootstrap.sql(改名後)の両方で、UNIQUE 列の NOT NULL を外す
  if (/CREATE TABLE[^;]*friends/i.test(sql) && NOT_NULL_KEY.test(sql)) {
    patched = sql.replace(NOT_NULL_KEY, '$1$2');
  }
  const result = originalExec.call(this, patched);
  const createsKey =
    /RENAME COLUMN line_user_id TO line_user_key/.test(sql) ||
    (/CREATE TABLE[^;]*friends/i.test(sql) && /line_user_key/.test(sql));
  if (createsKey) {
    originalExec.call(
      this,
      `CREATE TRIGGER IF NOT EXISTS trg_test_friends_key AFTER INSERT ON friends
         WHEN NEW.line_user_key IS NULL
         BEGIN UPDATE friends SET line_user_key = NEW.line_user_id WHERE id = NEW.id; END`,
    );
  }
  return result;
};
