-- Migration 075: 回答フォームのGoogleスプレッドシート連携(Lステップの「Googleスプレッドシート連携 β版」相当)
ALTER TABLE forms ADD COLUMN google_sheets_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN google_sheet_url TEXT;
ALTER TABLE forms ADD COLUMN google_sheet_name TEXT;
