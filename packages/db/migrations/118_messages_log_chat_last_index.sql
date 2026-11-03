-- トーク一覧の「最後のメッセージの日時」を、履歴を数え直さずに1人あたり1行で引くための部分インデックス。
-- 対象は一覧に出す行だけ(テスト送信・一斉配信のログは除く)。条件は chats.ts の一覧クエリと同じ書き方にそろえてある。
CREATE INDEX IF NOT EXISTS idx_messages_log_chat_last ON messages_log (friend_id, created_at) WHERE (delivery_type IS NULL OR delivery_type != 'test') AND (broadcast_id IS NULL AND COALESCE(source, '') != 'broadcast');
