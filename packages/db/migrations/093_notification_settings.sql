-- 093: 通知設定(Lステップの「通知」と同じ使い方)。追加のみの移行。
--   公式アカウントごとに、「どんなとき(timings)」「どの時間帯(schedule)」「だれの何(filter)」を「だれに(destinations)」知らせるかを持つ。
--   通知先は、beyond admin に登録・検証済みの宛先(LINE・メール)だけ。宛先のIDは beyond admin のもので、実際のLINEのIDやメールは持たない。
CREATE TABLE IF NOT EXISTS notification_settings (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'on' CHECK (status IN ('on', 'off')),
  -- {"mode":"always"} または {"mode":"weekly","days":[0..6],"from":"09:00","to":"21:00"}(日本時間・0=日曜)
  schedule        TEXT NOT NULL DEFAULT '{"mode":"always"}',
  -- 通知するタイミングの配列。例 ["friend_add","message","form_answered"] / フォームを絞るときは {"key":"form_answered","formIds":["…"]}
  timings         TEXT NOT NULL DEFAULT '[]',
  -- 絞り込み: このタグを持つ友だちのときだけ通知(空なら全員)。友だち追加時の通知には使わない
  filter_tag_ids  TEXT NOT NULL DEFAULT '[]',
  -- [{"kind":"line"|"mail","id":"<beyond admin の宛先ID>","name":"表示名"}]
  destinations    TEXT NOT NULL DEFAULT '[]',
  -- 自動で作った標準の設定か(アカウント追加時)
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_notification_settings_account ON notification_settings(line_account_id, status);

-- 送った記録(失敗の確認用。90日たったものは消してよい)
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id               TEXT PRIMARY KEY,
  setting_id       TEXT NOT NULL REFERENCES notification_settings(id) ON DELETE CASCADE,
  timing           TEXT NOT NULL,
  friend_id        TEXT,
  destination_kind TEXT NOT NULL,
  destination_id   TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_setting ON notification_deliveries(setting_id, created_at);
