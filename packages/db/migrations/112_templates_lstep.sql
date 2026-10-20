-- 112: テンプレート(Lステップの「テンプレート」と同じ作り)
--  - フォルダ(template_folders)・下書き(template_drafts)・送信名とアイコン(template_senders)・パックの中身(template_pack_items)
--  - templates に: 公式アカウント・フォルダ・並び順・種類(標準/フレックス/パック)・入力データ(画面に入れた内容)・送信者
--  すべて追加だけ。既存のテンプレート(editor_type が NULL)は、今までどおりの動き。
--  message_type の CHECK('text','image','flex','carousel')は変えない(作り直すと、シナリオ・自動応答との紐づきが消えるため)。
--  新しい種類(スタンプ・位置情報など)は、message_type='flex' に {"lineMessages":[…]} の目印を付けて入れる(packages/shared/src/templates.ts)。

CREATE TABLE IF NOT EXISTS template_folders (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT,
  name            TEXT NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_template_folders_account ON template_folders (line_account_id, display_order);

ALTER TABLE templates ADD COLUMN line_account_id TEXT;
ALTER TABLE templates ADD COLUMN folder_id TEXT;
ALTER TABLE templates ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
-- 'standard' = 標準メッセージ / 'flex' = フレックスメッセージ / 'pack' = メッセージパック
ALTER TABLE templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard';
-- text / sticker / image / question / carousel / location / referral / audio / video / flex。NULL = 旧来のテンプレート
ALTER TABLE templates ADD COLUMN editor_type TEXT;
ALTER TABLE templates ADD COLUMN editor_data TEXT;
ALTER TABLE templates ADD COLUMN sender_id TEXT;
ALTER TABLE templates ADD COLUMN allow_sender_override INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_templates_account_folder ON templates (line_account_id, folder_id, display_order);

CREATE TABLE IF NOT EXISTS template_senders (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT,
  name            TEXT NOT NULL,
  icon_url        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_template_senders_account ON template_senders (line_account_id);

-- 下書き(Lステップの「下書きを開く」)。template_id がある = 既存テンプレートの編集中の下書き
CREATE TABLE IF NOT EXISTS template_drafts (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT,
  template_id     TEXT,
  kind            TEXT NOT NULL DEFAULT 'standard',
  editor_type     TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  folder_id       TEXT,
  editor_data     TEXT NOT NULL,
  sender_id       TEXT,
  allow_sender_override INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_template_drafts_account ON template_drafts (line_account_id, updated_at);

-- パックの中身。template_id があれば「テンプレートから追加」(参照。元のテンプレートを直すと反映される)、なければパックの中だけのメッセージ
CREATE TABLE IF NOT EXISTS template_pack_items (
  id           TEXT PRIMARY KEY,
  pack_id      TEXT NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  template_id  TEXT REFERENCES templates (id) ON DELETE SET NULL,
  editor_type  TEXT,
  editor_data  TEXT,
  message_type TEXT,
  message_content TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_template_pack_items_pack ON template_pack_items (pack_id, position);
CREATE INDEX IF NOT EXISTS idx_template_pack_items_template ON template_pack_items (template_id);
