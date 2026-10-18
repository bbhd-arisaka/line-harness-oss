-- 108: 流入経路分析(Lステップの「流入経路分析」と同じ仕様)
--  - フォルダ(entry_route_folders)
--  - 流入経路ごとの設定: 公式アカウント・フォルダ・並び順・QRコード表示用テキスト・有効期間と期間外メッセージ・
--    アクション(友だち追加時設定のアクションと同じ形)・友だち追加時設定を無視するか・アクションの実行(いつでも/初回のみ)・
--    広告連携(広告パラメータを友だち情報欄へ取り込む)・HTMLタグ(head/body)・位置情報(有効範囲)
--  - 集計用: ref_tracking にクエリパラメータ・索引
-- すべて追加だけ。既存の流入経路(actions が NULL)は、今までどおりの動き(tag_id / scenario_id)のまま。

CREATE TABLE IF NOT EXISTS entry_route_folders (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT,
  name            TEXT NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_entry_route_folders_account ON entry_route_folders (line_account_id, display_order);

ALTER TABLE entry_routes ADD COLUMN line_account_id TEXT;
ALTER TABLE entry_routes ADD COLUMN folder_id TEXT;
ALTER TABLE entry_routes ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entry_routes ADD COLUMN qr_text TEXT;
ALTER TABLE entry_routes ADD COLUMN valid_from TEXT;
ALTER TABLE entry_routes ADD COLUMN valid_to TEXT;
ALTER TABLE entry_routes ADD COLUMN out_of_period_message TEXT;
-- アクション(JSON配列。友だち追加時設定のアクションと同じ形)。NULL = 旧来の流入経路(tag_id / scenario_id だけ)
ALTER TABLE entry_routes ADD COLUMN actions TEXT;
-- 1 = 友だち追加時設定のアクションを無視する(この経路から友だち追加された人には、友だち追加時設定を動かさない)
ALTER TABLE entry_routes ADD COLUMN ignore_friend_add_settings INTEGER NOT NULL DEFAULT 0;
-- アクションの実行: 'first' = 初回の友だち追加時のみ / 'always' = いつでも(開くたびに)。作成後は変えられない
ALTER TABLE entry_routes ADD COLUMN action_mode TEXT NOT NULL DEFAULT 'first';
-- 広告パラメータの取り込み: 'always' = 常に / 'first' = 初回の流入時のみ。作成後は変えられない
ALTER TABLE entry_routes ADD COLUMN ad_import_mode TEXT NOT NULL DEFAULT 'always';
-- 広告パラメータ(カスタムパラメータ名)→ 友だち情報欄(field_key)の対応(JSON配列 [{param, fieldKey}])
ALTER TABLE entry_routes ADD COLUMN ad_param_map TEXT;
ALTER TABLE entry_routes ADD COLUMN html_head TEXT;
ALTER TABLE entry_routes ADD COLUMN html_body TEXT;
-- 位置情報: この地点の半径(m)の中からだけ、アクセスできる
ALTER TABLE entry_routes ADD COLUMN geo_lat REAL;
ALTER TABLE entry_routes ADD COLUMN geo_lng REAL;
ALTER TABLE entry_routes ADD COLUMN geo_radius INTEGER;

CREATE INDEX IF NOT EXISTS idx_entry_routes_account ON entry_routes (line_account_id, folder_id, display_order);

-- 集計の「クエリパラメータ」(アクセスしたときのURLの ?…)
ALTER TABLE ref_tracking ADD COLUMN query_params TEXT;
CREATE INDEX IF NOT EXISTS idx_ref_tracking_route ON ref_tracking (entry_route_id, created_at);
