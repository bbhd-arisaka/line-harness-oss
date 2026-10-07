-- 友だち追加時設定の「送信タイミング」(送信を遅らせる/時刻を指定する)用。実行する時刻(run_at)まで預かる。
-- action は実行するアクション(JSON)。実行時に条件を見直す。
CREATE TABLE IF NOT EXISTS friend_add_deferred_actions (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  run_at          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_friend_add_deferred_due ON friend_add_deferred_actions (status, run_at);
