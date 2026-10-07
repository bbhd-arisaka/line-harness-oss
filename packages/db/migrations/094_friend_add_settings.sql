-- 友だち追加時設定(Lステップの「友だち追加時設定」)。公式アカウントごと・2区分:
--   new       = 新規友だち(システム導入後に新しくフォローした人)
--   returning = システム導入前からの友だち・ブロックを解除した友だち(すでに名簿にいる人が、またフォローしたとき)
-- scenario_id: 追加時に登録するシナリオ(なしなら NULL)
-- actions: その他のアクション(JSON配列。[{type, params}]。type は add_tag / remove_tag / send_message / switch_rich_menu_group / remove_rich_menu)
CREATE TABLE IF NOT EXISTS friend_add_settings (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('new', 'returning')),
  scenario_id     TEXT,
  actions         TEXT NOT NULL DEFAULT '[]',
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, kind)
);
