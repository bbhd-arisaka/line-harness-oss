-- トークのピン留め: ピン留めした時刻(NULL = ピン留めなし)。スタッフ全員で共通。
ALTER TABLE chats ADD COLUMN pinned_at TEXT;
