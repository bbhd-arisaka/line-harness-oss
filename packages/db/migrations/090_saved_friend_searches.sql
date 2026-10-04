-- 090: 友だちリストの「保存した検索」(Lステップの「この条件を保存」相当)
-- アカウントごとに保存する。filter は、詳細検索の条件(JSON)。追加のみの移行。
CREATE TABLE IF NOT EXISTS saved_friend_searches (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  filter          TEXT NOT NULL,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_saved_friend_searches_account ON saved_friend_searches(line_account_id, created_at);
