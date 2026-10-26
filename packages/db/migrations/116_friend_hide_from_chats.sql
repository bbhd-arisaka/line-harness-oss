-- トーク一覧に出さない友だち(自分のテスト用アカウントなど)。1 = 一覧・未対応の数に出さない。友だちリストと個別トークからは開ける。
ALTER TABLE friends ADD COLUMN hide_from_chats INTEGER NOT NULL DEFAULT 0;
