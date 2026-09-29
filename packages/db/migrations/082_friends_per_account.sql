-- 082: 同じ人でも、公式アカウントごとに別の友だち行にする(Lステップと同じ仕様)
--
-- 従来: friends.line_user_id が UNIQUE のため、同一プロバイダー配下の複数アカウントで
--       同じ LINE ユーザーIDの人は 1 行しか持てなかった。
-- 変更: UNIQUE 制約つきの列を内部キー line_user_key に改名し(制約・索引は自動で追従)、
--       LINE ユーザーIDそのものは新しい列 line_user_id に持つ。
--       これにより、コード中の friend.line_user_id(LINE への送信先)はそのまま実IDを指す。
--       既存行は key = 実ID(従来と同じ値)。一意性は (line_user_id, line_account_id) で保証。
--
-- テーブル作り直し(DROP/RENAME TABLE)はしない。友だちに紐づく約40テーブルの
-- CASCADE でデータが消えるのを避けるため。RENAME COLUMN はスキーマ定義の書き換えのみ。
ALTER TABLE friends RENAME COLUMN line_user_id TO line_user_key;
ALTER TABLE friends ADD COLUMN line_user_id TEXT;
UPDATE friends SET line_user_id = line_user_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_friends_uid_account ON friends (line_user_id, line_account_id);
CREATE INDEX IF NOT EXISTS idx_friends_line_user_real ON friends (line_user_id);
