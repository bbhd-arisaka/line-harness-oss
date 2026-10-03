-- 089: アプリからの「アカウント削除の申請」(App Store の要件)
--
-- スタッフが申請すると deletion_requested_at に時刻が入り、その場で全端末からログアウトされ、
-- 以後 beyond line には入れなくなる(申請を取り消すまで)。
-- 実際のユーザー削除は beyond admin 側で、オーナーが行う(beyond admin のユーザーが正)。
-- 追加のみの移行(既存データは変更しない)。
ALTER TABLE staff_members ADD COLUMN deletion_requested_at TEXT;
