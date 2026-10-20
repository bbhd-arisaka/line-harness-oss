-- テンプレート(質問・カルーセル・フレックス)の選択肢が、友だちに押された回数。
-- タップ回数の制限(1回のみ)と、回答率の集計に使う。
CREATE TABLE IF NOT EXISTS template_taps (
  template_id TEXT NOT NULL,
  friend_id   TEXT NOT NULL,
  panel       INTEGER NOT NULL DEFAULT 0,
  choice      INTEGER NOT NULL DEFAULT 0,
  count       INTEGER NOT NULL DEFAULT 1,
  first_at    TEXT NOT NULL,
  last_at     TEXT NOT NULL,
  PRIMARY KEY (template_id, friend_id, panel, choice)
);
CREATE INDEX IF NOT EXISTS idx_template_taps_template ON template_taps (template_id, panel, choice);
