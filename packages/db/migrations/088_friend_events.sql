-- 088: 友だちごとの「出来事のログ」(トークの履歴の中に、中央の小さな行として表示する)
--
-- フォーム回答・ブロック/解除・友だち追加・タグの付け外し・友だち情報やプロフィールの変更を残す。
-- text は表示用の日本語(サーバーが完成形で作る)。個人情報の値そのものは入れない。
-- event_type には CHECK 制約を付けない(種類を足しやすくするため)。
-- 追加のみの移行(既存データは変更しない)。
CREATE TABLE IF NOT EXISTS friend_events (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id TEXT,
  event_type      TEXT NOT NULL,
  text            TEXT NOT NULL,
  actor           TEXT,
  detail          TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_friend_events_friend ON friend_events(friend_id, created_at);
