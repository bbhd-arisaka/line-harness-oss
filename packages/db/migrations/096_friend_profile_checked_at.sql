-- プロフィール(画像・ステータスメッセージ)を、LINEから最後に取り直した日時。
-- LINEのプロフィール画像のURLは、時間がたつと見られなくなることがあるため、定期的に取り直す。
-- NULL = まだ一度も取り直していない(古い順に取り直す)。
ALTER TABLE friends ADD COLUMN profile_checked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_friends_profile_checked ON friends (profile_checked_at);
