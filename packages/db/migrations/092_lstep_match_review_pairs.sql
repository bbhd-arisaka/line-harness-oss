-- 092: 照合確認に「誰と誰を結びつけたか」を持たせる(追加のみ)
--   partner_*  : 結びつけた(または結びつけると決めた)相手。beyond側の行なら Lステップの人、lstep側の行なら beyond lineの友だち
--   decision   : NULL=未判断 / 'same'=同じ人と確認 / 'different'=別の人(要修正) / 'link'=手で紐付け(Lステップ側データの移行待ち)
ALTER TABLE lstep_match_review ADD COLUMN partner_id TEXT;
ALTER TABLE lstep_match_review ADD COLUMN partner_name TEXT;
ALTER TABLE lstep_match_review ADD COLUMN partner_picture_url TEXT;
ALTER TABLE lstep_match_review ADD COLUMN decision TEXT;
-- 名前の見分け用: LINE名と、本名(Lステップでは表示名)。partner_* は結びつけた相手の分
ALTER TABLE lstep_match_review ADD COLUMN line_name TEXT;
ALTER TABLE lstep_match_review ADD COLUMN real_name TEXT;
ALTER TABLE lstep_match_review ADD COLUMN partner_line_name TEXT;
ALTER TABLE lstep_match_review ADD COLUMN partner_real_name TEXT;
