-- 091: Lステップ引き継ぎで「照合できなかった人」の確認リスト(画面で確認するための記録)
--   side='beyond' : beyond line にいるが、Lステップの記録と確実に結びつけられなかった友だち
--   side='lstep'  : Lステップにいるが、beyond line の友だちと結びつけられなかった人
-- 追加のみの移行。
CREATE TABLE IF NOT EXISTS lstep_match_review (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  side            TEXT NOT NULL CHECK (side IN ('beyond', 'lstep')),
  friend_id       TEXT,            -- side='beyond' のとき: beyond line の友だちID
  lstep_id        TEXT,            -- side='lstep' のとき: Lステップの友だちID
  name            TEXT NOT NULL,
  picture_url     TEXT,
  added_at        TEXT,
  reason          TEXT NOT NULL,   -- no_lstep / ambiguous / name_only / no_beyond
  detail          TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  note            TEXT,
  resolved_by     TEXT,
  resolved_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_lstep_match_review_account ON lstep_match_review(line_account_id, side, status);
