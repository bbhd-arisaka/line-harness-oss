-- Migration 074: 回答フォームのカラー/デザイン設定を追加(Lステップ「カラー/デザイン設定」タブ相当)
ALTER TABLE forms ADD COLUMN custom_design_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN background_color TEXT;
ALTER TABLE forms ADD COLUMN form_background_color TEXT;
ALTER TABLE forms ADD COLUMN header_image_url TEXT;
ALTER TABLE forms ADD COLUMN background_image_url TEXT;
ALTER TABLE forms ADD COLUMN hide_header_icon INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN custom_css_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN custom_css TEXT;
