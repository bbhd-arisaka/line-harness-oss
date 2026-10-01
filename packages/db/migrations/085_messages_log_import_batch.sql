-- 085: データ引き継ぎで取り込んだトーク履歴に、取り込みバッチの印を付ける(「元に戻す」で、取り込んだ分だけを消すため)
-- 追加のみの移行(既存データは変更しない)。
ALTER TABLE messages_log ADD COLUMN import_batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_log_import_batch ON messages_log(import_batch_id);
