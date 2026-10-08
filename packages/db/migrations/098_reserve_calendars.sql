-- カレンダー予約(Lステップの「カレンダー予約」と同じ仕様)。1つの公式アカウントに、複数のカレンダーを作れる。
-- 時刻は、すべて日本時間の「年月日T時:分」(例 2026-10-09T10:30)の文字で持つ(並べ替え・比較が、そのまま文字でできる)。
-- 既存のサロン予約(menus / staff / bookings)とは別のしくみ。

CREATE TABLE IF NOT EXISTS reserve_calendars (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  -- 友だち予約: stopped=停止中(予約URLを開くと「現在、予約受付を停止しています。」)
  status           TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('active', 'stopped')),
  reception        TEXT NOT NULL DEFAULT '{}',  -- 予約受付(受付時間・受付期間・同時予約可能数・承認)
  slot_settings    TEXT NOT NULL DEFAULT '{}',  -- 予約枠まわりの設定(タイトル・必須/任意・自動振り分け・シフト連動など)
  course_settings  TEXT NOT NULL DEFAULT '{}',  -- コースまわりの設定
  screen           TEXT NOT NULL DEFAULT '{}',  -- 予約画面(表示形式・管理者情報・同意事項・サンクスページ・予約情報取得項目)
  actions          TEXT NOT NULL DEFAULT '{}',  -- 予約アクション(予約完了時など。友だち追加時設定と同じアクションの並び)
  reminders        TEXT NOT NULL DEFAULT '{}',  -- リマインダ
  follow           TEXT NOT NULL DEFAULT '{}',  -- フォロー
  external         TEXT NOT NULL DEFAULT '{}',  -- 外部サービス連携(Googleカレンダー)
  display_order    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_reserve_calendars_account ON reserve_calendars (line_account_id, display_order);

-- 予約枠(担当者・会議室など。友だちが予約するときに選ぶもの)
CREATE TABLE IF NOT EXISTS reserve_slots (
  id               TEXT PRIMARY KEY,
  calendar_id      TEXT NOT NULL REFERENCES reserve_calendars(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  visible          INTEGER NOT NULL DEFAULT 1,
  price            INTEGER NOT NULL DEFAULT 0,
  capacity         INTEGER,                      -- 同時予約可能数。NULL=カレンダーの既定を使う
  auto_assign      INTEGER NOT NULL DEFAULT 0,   -- 予約枠を選ばない予約の、自動振り分けの対象にするか
  priority         INTEGER NOT NULL DEFAULT 1,   -- 自動振り分けの優先度(小さいほど優先)
  description      TEXT,
  description_html INTEGER NOT NULL DEFAULT 0,
  condition        TEXT,                         -- 友だち予約可能条件(友だち絞り込みのJSON)。NULL=全員
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_reserve_slots_calendar ON reserve_slots (calendar_id, sort_order);

-- コース(メニュー・所要時間)
CREATE TABLE IF NOT EXISTS reserve_courses (
  id               TEXT PRIMARY KEY,
  calendar_id      TEXT NOT NULL REFERENCES reserve_calendars(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  color            TEXT NOT NULL DEFAULT '#3b82f6',
  duration_minutes INTEGER NOT NULL DEFAULT 30,  -- 所要時間(システムで確保する時間)
  display_minutes  INTEGER,                      -- 表示時間(友だちに見せる時間)。NULL=所要時間と同じ
  price            INTEGER NOT NULL DEFAULT 0,
  visible          INTEGER NOT NULL DEFAULT 1,
  description      TEXT,
  description_html INTEGER NOT NULL DEFAULT 0,
  condition        TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_reserve_courses_calendar ON reserve_courses (calendar_id, sort_order);

-- 予約枠とコースの紐づけ(ある組み合わせだけ、予約できる)
CREATE TABLE IF NOT EXISTS reserve_slot_courses (
  slot_id   TEXT NOT NULL REFERENCES reserve_slots(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES reserve_courses(id) ON DELETE CASCADE,
  PRIMARY KEY (slot_id, course_id)
);

-- シフト(予約枠ごとの、受け付ける時間)。繰り返しは、作るときに1日ずつの行に展開する(series_id で同じ繰り返しをまとめる)
CREATE TABLE IF NOT EXISTS reserve_shifts (
  id          TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES reserve_calendars(id) ON DELETE CASCADE,
  slot_id     TEXT NOT NULL REFERENCES reserve_slots(id) ON DELETE CASCADE,
  series_id   TEXT,
  work_date   TEXT NOT NULL,   -- 年月日(日本時間)
  start_time  TEXT NOT NULL,   -- HH:MM
  end_time    TEXT NOT NULL,   -- HH:MM
  memo        TEXT,
  repeat_rule TEXT,            -- 繰り返しのもとの設定(JSON)。単発は NULL
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_reserve_shifts_lookup ON reserve_shifts (calendar_id, work_date);
CREATE INDEX IF NOT EXISTS idx_reserve_shifts_series ON reserve_shifts (series_id);

-- 予約(ブロック枠も、同じ表に入れる)
CREATE TABLE IF NOT EXISTS reserve_bookings (
  id                TEXT PRIMARY KEY,
  calendar_id       TEXT NOT NULL REFERENCES reserve_calendars(id) ON DELETE CASCADE,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id         TEXT REFERENCES friends(id) ON DELETE SET NULL,
  slot_id           TEXT REFERENCES reserve_slots(id) ON DELETE SET NULL,   -- NULL=予約枠なし(指名なし)
  course_id         TEXT REFERENCES reserve_courses(id) ON DELETE SET NULL,
  is_block          INTEGER NOT NULL DEFAULT 0,       -- 1=ブロック枠(その時間に予約が入らないようにする)
  starts_at         TEXT NOT NULL,                    -- 2026-10-09T10:30
  ends_at           TEXT NOT NULL,                    -- 確保する時間の終わり(所要時間)
  display_ends_at   TEXT,                             -- 友だちに見せる終わり(表示時間)
  -- confirmed=予約済み / pending=承認待ち(リクエスト) / cancelled=キャンセル済み / rejected=否認
  status            TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending', 'cancelled', 'rejected')),
  pending_kind      TEXT CHECK (pending_kind IN ('new', 'change', 'cancel')),   -- 承認待ちの中身
  pending_payload   TEXT,                             -- 変更リクエストの、変更後の内容(JSON)
  followup_status   TEXT,                             -- 完了後のステータス(対応済みなど)
  visited           INTEGER NOT NULL DEFAULT 0,       -- 来店/来場済み
  visited_at        TEXT,
  follow_state      TEXT NOT NULL DEFAULT 'none' CHECK (follow_state IN ('none', 'running', 'done')),
  created_by        TEXT NOT NULL DEFAULT 'friend' CHECK (created_by IN ('friend', 'admin')),
  answers           TEXT NOT NULL DEFAULT '{}',       -- 予約情報取得項目の回答(項目ID→値)
  guest_name        TEXT,                             -- 回答の「名前」(一覧に出す名前)
  price             INTEGER NOT NULL DEFAULT 0,
  slot_price_applied INTEGER NOT NULL DEFAULT 1,      -- 予約枠の料金を加算しているか
  memo              TEXT,
  requested_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  google_event_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_reserve_bookings_calendar_time ON reserve_bookings (calendar_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_reserve_bookings_friend ON reserve_bookings (friend_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_reserve_bookings_pending ON reserve_bookings (calendar_id, status);

-- 操作履歴(新規予約・変更・キャンセルなど)
CREATE TABLE IF NOT EXISTS reserve_booking_logs (
  id         TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES reserve_bookings(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  actor      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_reserve_booking_logs_booking ON reserve_booking_logs (booking_id, created_at);

-- リマインダ・フォローの配信予定(時刻が来たらアクションを実行する)
CREATE TABLE IF NOT EXISTS reserve_deliveries (
  id         TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES reserve_bookings(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('reminder', 'follow')),
  item_id    TEXT NOT NULL,
  run_at     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'cancelled')),
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_reserve_deliveries_due ON reserve_deliveries (status, run_at);
CREATE INDEX IF NOT EXISTS idx_reserve_deliveries_booking ON reserve_deliveries (booking_id);

-- 指定した予約枠・コースの予約URL(予約サイト確認で発行する)
CREATE TABLE IF NOT EXISTS reserve_site_links (
  id          TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES reserve_calendars(id) ON DELETE CASCADE,
  slot_id     TEXT,
  course_id   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_reserve_site_links_calendar ON reserve_site_links (calendar_id);
