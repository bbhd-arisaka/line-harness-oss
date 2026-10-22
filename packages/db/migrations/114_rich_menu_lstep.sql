-- リッチメニューをLステップ準拠に: ボタン番号(並び順)・フォルダ・ボタンを押された記録(計測)
ALTER TABLE rich_menu_areas ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rich_menu_groups ADD COLUMN folder_id TEXT;

CREATE TABLE IF NOT EXISTS rich_menu_folders (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_rich_menu_folders_account ON rich_menu_folders (account_id, display_order);

-- ボタンが友だちに押された回数(メニュー一覧の「計測」)。ボタン(エリア)のIDは、保存し直しても変わらない
CREATE TABLE IF NOT EXISTS rich_menu_taps (
  area_id   TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  count     INTEGER NOT NULL DEFAULT 1,
  first_at  TEXT NOT NULL,
  last_at   TEXT NOT NULL,
  PRIMARY KEY (area_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_rich_menu_taps_area ON rich_menu_taps (area_id);
