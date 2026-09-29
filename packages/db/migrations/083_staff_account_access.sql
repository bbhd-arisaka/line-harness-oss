-- 083: スタッフごとに見られる公式アカウントを制限する
--
-- staff_account_access に行があるスタッフは、その行のアカウントの友だち・トークだけを扱える。
-- 行が1つも無いスタッフ(既存のスタッフ全員・オーナー)は従来どおり全アカウントを扱える。
-- 追加のみの移行(既存データは変更しない)。
CREATE TABLE IF NOT EXISTS staff_account_access (
  staff_id        TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (staff_id, line_account_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_account_access_account ON staff_account_access(line_account_id);
