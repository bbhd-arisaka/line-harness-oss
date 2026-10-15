-- 一斉配信の記録を、個別トークの並び順・一覧の表示に使わないようにした(2026-10-15)。
-- それまでは、一斉配信の記録しか無い人も一覧に出ていたが、今後は「トークの行」か「一斉配信以外のメッセージ」が無いと一覧に出ない。
-- 一度だけの補完: メッセージの記録はあるが、トークの行がまだ無い人に、対応済みのトークの行を作る(並び順は友だち追加の時刻)。
-- 何度流しても同じ結果になる(すでに行がある人は作らない)。
INSERT OR IGNORE INTO chats (id, friend_id, status, last_message_at, created_at, updated_at, line_account_id)
SELECT lower(hex(randomblob(16))), f.id, 'resolved',
       COALESCE(f.current_follow_started_at, f.created_at),
       COALESCE(f.current_follow_started_at, f.created_at),
       COALESCE(f.current_follow_started_at, f.created_at),
       f.line_account_id
  FROM friends f
 WHERE NOT EXISTS (SELECT 1 FROM chats c WHERE c.friend_id = f.id)
   AND EXISTS (SELECT 1 FROM messages_log m WHERE m.friend_id = f.id);
