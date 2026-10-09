-- 100: アプリの通知を、公式アカウントごとにオフにできるようにする(端末ごとの設定)
-- muted_account_ids: 通知を止める公式アカウントIDの JSON 配列(null または空=すべて受け取る)
ALTER TABLE app_sessions ADD COLUMN muted_account_ids TEXT;
