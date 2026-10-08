-- 友だち追加だけで、まだメッセージのやり取りが無い人も、個別トークの一覧に出るようにする(今後は、友だち追加の時点で作る)。
-- 一度だけの補完: 直近14日にフォローした、トークの行がまだ無い人に、対応済みのトークの行を作る。
INSERT OR IGNORE INTO chats (id, friend_id, status, last_message_at, created_at, updated_at)
SELECT lower(hex(randomblob(16))), f.id, 'resolved',
       COALESCE(f.current_follow_started_at, f.created_at),
       COALESCE(f.current_follow_started_at, f.created_at),
       COALESCE(f.current_follow_started_at, f.created_at)
  FROM friends f
 WHERE f.is_following = 1
   AND COALESCE(f.current_follow_started_at, f.created_at) >= strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours', '-14 days')
   AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.friend_id = f.id);
