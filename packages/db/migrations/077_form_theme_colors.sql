-- Migration 077: 回答フォームのデザイン設定をLステップ新形式の5色テーマ+フォントに拡張
-- primary_color(既存)はLステップの「アクセント」色として扱う。
ALTER TABLE forms ADD COLUMN theme_main_color TEXT;
ALTER TABLE forms ADD COLUMN theme_sub_color TEXT;
ALTER TABLE forms ADD COLUMN theme_error_color TEXT;
ALTER TABLE forms ADD COLUMN theme_text_color TEXT;
ALTER TABLE forms ADD COLUMN theme_font TEXT;
