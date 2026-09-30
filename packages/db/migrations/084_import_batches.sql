-- 084: データ引き継ぎ(Lステップ → beyond line)の実行履歴と、元に戻すための記録
-- 追加のみの移行(既存データは変更しない)。
CREATE TABLE IF NOT EXISTS import_batches (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,                 -- 'lstep'
  line_account_id TEXT,                          -- 取り込み先の公式アカウント
  status          TEXT NOT NULL DEFAULT 'running', -- running / applied / undone
  summary         TEXT,                          -- 件数など(JSON)
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  finished_at     TEXT,
  undone_at       TEXT
);

-- 1操作=1行。元に戻すときに、この記録を逆向きにたどる。
--   op = created_folder / created_field / created_tag : ref1 = 作った行のID
--        added_friend_tag                             : ref1 = friend_id, ref2 = tag_id
--        friend_before                                : ref1 = friend_id, before = 変更前の値(JSON)
CREATE TABLE IF NOT EXISTS import_batch_ops (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  op       TEXT NOT NULL,
  ref1     TEXT,
  ref2     TEXT,
  before   TEXT
);

CREATE INDEX IF NOT EXISTS idx_import_batch_ops_batch ON import_batch_ops(batch_id);
