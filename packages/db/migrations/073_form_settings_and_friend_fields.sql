-- Migration 073: フォームの詳細設定・友だち情報欄の管理システムを追加
--
-- Lステップの回答フォーム/友だち情報欄を模倣するための拡張。
-- 既存の forms.fields (JSON) 自体は変更しない — セクション見出しや
-- 都道府県・ファイル添付は新しい type 値として同じ配列の中で表現する
-- (スキーマ変更を増やさないため)。

ALTER TABLE forms ADD COLUMN expires_at TEXT;
ALTER TABLE forms ADD COLUMN capacity_limit INTEGER;
-- 'unlimited' | 'once' — Lステップの「1人が回答できる回数」に対応
ALTER TABLE forms ADD COLUMN answer_limit_per_friend TEXT NOT NULL DEFAULT 'unlimited';
-- 2回目以降の回答時に前回の回答を復元するか
ALTER TABLE forms ADD COLUMN restore_previous_answer INTEGER NOT NULL DEFAULT 0;
-- 未設定なら回答後の文章(on_submit_message_*)を使う。設定時はそちらへリダイレクト
ALTER TABLE forms ADD COLUMN thanks_url TEXT;
-- フォームのアクセントカラー(16進、例 #d97786)。未設定ならデフォルト配色
ALTER TABLE forms ADD COLUMN primary_color TEXT;
-- 回答後アクション「シナリオを停止」。回答した友だちの進行中シナリオを全て終了させる
ALTER TABLE forms ADD COLUMN on_submit_stop_scenarios INTEGER NOT NULL DEFAULT 0;

-- 友だち情報欄(Lステップの「友だち情報欄管理」に相当)。
-- friends.metadata のキーを事前に定義・分類できるようにする。
CREATE TABLE IF NOT EXISTS friend_field_folders (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS friend_field_definitions (
  id            TEXT PRIMARY KEY,
  folder_id     TEXT REFERENCES friend_field_folders(id) ON DELETE SET NULL,
  -- friends.metadata の実際のJSONキー。作成後の変更は移行が要るため慎重に。
  field_key     TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  field_type    TEXT NOT NULL DEFAULT 'text', -- text/textarea/number/date/select/radio/checkbox
  options       TEXT, -- JSON配列。select/radio/checkboxのときのみ使う
  default_value TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_friend_field_definitions_folder ON friend_field_definitions (folder_id);
