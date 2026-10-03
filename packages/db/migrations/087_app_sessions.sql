-- 087: iOSアプリ用のログイン(端末ごとのセッション)と、ログイン失敗の記録
--
-- app_sessions: アプリ専用のトークン(中身は保存せず、ハッシュだけ)。端末ごとに1つ。
--   スタッフを無効にする・ログアウトする・紛失したときに取り消せる(revoked_at)。
--   apns_token はプッシュ通知(APNs)の送り先。
-- app_login_failures: パスワードの総当たりを止めるための、ログイン失敗の記録(一定時間で消す)。
-- 追加のみの移行(既存データは変更しない)。
CREATE TABLE IF NOT EXISTS app_sessions (
  id           TEXT PRIMARY KEY,
  staff_id     TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  device_name  TEXT,
  apns_token   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  last_used_at TEXT,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_staff ON app_sessions(staff_id);

CREATE TABLE IF NOT EXISTS app_login_failures (
  id         TEXT PRIMARY KEY,
  email_key  TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_app_login_failures_key ON app_login_failures(email_key, created_at);
