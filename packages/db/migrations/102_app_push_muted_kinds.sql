-- 102: アプリの通知を、「何を知らせるか」(新着メッセージ・フォームの回答 など)ごとにオフにできるようにする(端末ごとの設定)
-- muted_push_kinds: 通知を止める種類の JSON 配列(null または空=すべて受け取る)。アプリの設定画面だけで完結する
ALTER TABLE app_sessions ADD COLUMN muted_push_kinds TEXT;
