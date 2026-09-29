-- Migration 078: 回答フォームのフォルダ分け(Lステップの「回答フォーム」一覧画面相当)
CREATE TABLE IF NOT EXISTS form_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE forms ADD COLUMN folder_id TEXT REFERENCES form_folders (id);
