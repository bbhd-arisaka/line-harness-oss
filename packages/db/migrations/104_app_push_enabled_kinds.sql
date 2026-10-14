-- 104: アプリの通知のうち、「初期はオフ」の種類(友だち再追加)を、端末ごとにオンにできるようにする
-- enabled_push_kinds: 初期オフの種類のうち、この端末でオンにした種類の JSON 配列(null または空=すべてオフのまま)。アプリの設定画面だけで完結する
ALTER TABLE app_sessions ADD COLUMN enabled_push_kinds TEXT;
