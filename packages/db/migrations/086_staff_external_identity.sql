-- 086: beyond admin のユーザーでログインできるようにする(スタッフと beyond admin のユーザーを結びつける)
--
-- external_id: beyond admin のユーザーID(あれば、そのユーザーとして扱う。beyond admin 側で名前・役割・停止を管理する)
-- external_tenant_id: beyond admin の会社(テナント)ID
-- access_restricted: 1 のスタッフは、見られるアカウントを許可するまで、どのアカウントも見られない(新しく入った人が、全アカウントを見てしまわないように)
-- 追加のみの移行(既存データは変更しない)。
ALTER TABLE staff_members ADD COLUMN external_id TEXT;
ALTER TABLE staff_members ADD COLUMN external_tenant_id TEXT;
ALTER TABLE staff_members ADD COLUMN access_restricted INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_members_external_id ON staff_members(external_id);
