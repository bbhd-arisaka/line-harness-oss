-- Migration 080: 友だち情報欄をLステップの管理画面に合わせて拡張
-- ★(お気に入り)と、選択肢型の各選択肢に付ける色(options と同じ並びの JSON 配列)。
ALTER TABLE friend_field_definitions ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE friend_field_definitions ADD COLUMN option_colors TEXT;
