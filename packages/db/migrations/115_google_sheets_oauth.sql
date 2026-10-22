-- フォーム回答の常時スプレッドシート連携(Googleアカウントを管理画面から紐づけ)
CREATE TABLE IF NOT EXISTS google_sheets_connections (
  id TEXT PRIMARY KEY,
  google_email TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TEXT,
  refresh_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_error TEXT,
  connected_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_sheets_connections_email ON google_sheets_connections (google_email);

CREATE TABLE IF NOT EXISTS form_google_sheet_links (
  form_id TEXT PRIMARY KEY REFERENCES forms (id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES google_sheets_connections (id) ON DELETE CASCADE,
  spreadsheet_id TEXT NOT NULL,
  spreadsheet_title TEXT,
  sheet_title TEXT NOT NULL,
  last_exported_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_form_google_sheet_links_conn ON form_google_sheet_links (connection_id);
