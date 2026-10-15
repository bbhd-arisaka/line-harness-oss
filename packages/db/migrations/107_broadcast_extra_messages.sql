-- 一斉配信で、1回に最大5通のメッセージを送れるようにする(LINE の1リクエストの上限)。
-- 1通目は今までどおり message_type / message_content に入れ、2通目以降(最大4通)だけを extra_messages に JSON で入れる。
-- 形: [{"type":"text|image|flex","content":"…","altText":"…(省略可)"}]。順番がそのまま配信順。
-- NULL = 1通だけ(これまでの配信は全部これ)。
ALTER TABLE broadcasts ADD COLUMN extra_messages TEXT;
