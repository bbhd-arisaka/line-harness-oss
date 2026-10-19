-- 流入経路ごとの、友だち追加ページ(/r/<ref>)の文言と配色(JSON。NULL = 既定のまま)
ALTER TABLE entry_routes ADD COLUMN landing_style TEXT;
