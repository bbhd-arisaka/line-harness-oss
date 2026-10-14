-- 105: アプリの通知の設定を、公式アカウントごとに持てるようにする(端末 × 公式アカウント)
-- push_by_account: { "<公式アカウントID>": { "m": [止めている種類], "e": [オンにした初期オフの種類] } } の JSON。
-- その公式アカウントの設定が無ければ、これまでの端末全体の設定(muted_push_kinds / enabled_push_kinds)を使う。
-- 設定は、そのアカウントに切り替えた状態で、アプリの設定画面で行う(他のアカウントの設定は、そのアカウントに切り替えて行う)。
ALTER TABLE app_sessions ADD COLUMN push_by_account TEXT;
