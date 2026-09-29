-- Migration 076: 友だちの「本名」「個別メモ」を専用カラムに(Lステップ新形式の回答フォームで
-- 「友だち情報」とは別の登録先として扱われているため、metadata JSONとは分離する)
ALTER TABLE friends ADD COLUMN real_name TEXT;
ALTER TABLE friends ADD COLUMN memo TEXT;
