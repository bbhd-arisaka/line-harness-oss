-- 101: App Store 審査用のデモデータ(公式アカウント「beyond-line運営」に、ダミーの友だち・トーク・タグを入れる)
-- 実在のお客様のデータではない。友だちの LINE ユーザーID は Udemo… で始まり、返信しても LINE へは送らない(デモ扱い)。
-- アカウントが無い環境(新規セットアップなど)では、何も入らない。何度流しても、同じ内容のまま(INSERT OR IGNORE)。

INSERT OR IGNORE INTO tags (id, name, color) VALUES ('demo-tag-new', 'デモ:新規', '#06c755');
INSERT OR IGNORE INTO tags (id, name, color) VALUES ('demo-tag-regular', 'デモ:常連', '#3B82F6');
INSERT OR IGNORE INTO friends (id, line_user_key, line_user_id, line_account_id, display_name, real_name, memo, is_following, created_at, updated_at)
  SELECT 'demo-f1', 'Udemo000000000000000000000000001', 'Udemo000000000000000000000000001', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '田中 美咲', '田中 美咲', '初回来店予定', 1, '2026-09-20T10:00:00.000', '2026-09-20T10:00:00.000'
  WHERE EXISTS (SELECT 1 FROM line_accounts WHERE id = 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8');
INSERT OR IGNORE INTO chats (id, friend_id, status, last_message_at, line_account_id, created_at, updated_at)
  SELECT 'demo-c-1', 'demo-f1', 'unread', '2026-10-08T18:42:00.000', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-09-20T10:00:00.000', '2026-10-08T18:42:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f1');
INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
  SELECT 'demo-m-1-0', 'demo-f1', 'incoming', 'text', '来週の予約を変更したいのですが、可能でしょうか?', NULL, 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-10-08T18:42:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f1');
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id)
  SELECT 'demo-f1', 'demo-tag-new' WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f1');
INSERT OR IGNORE INTO friends (id, line_user_key, line_user_id, line_account_id, display_name, real_name, memo, is_following, created_at, updated_at)
  SELECT 'demo-f2', 'Udemo000000000000000000000000002', 'Udemo000000000000000000000000002', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '佐藤 あかり', '佐藤 あかり', NULL, 1, '2026-09-20T10:00:00.000', '2026-09-20T10:00:00.000'
  WHERE EXISTS (SELECT 1 FROM line_accounts WHERE id = 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8');
INSERT OR IGNORE INTO chats (id, friend_id, status, last_message_at, line_account_id, created_at, updated_at)
  SELECT 'demo-c-2', 'demo-f2', 'in_progress', '2026-10-08T15:20:00.000', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-09-20T10:00:00.000', '2026-10-08T15:20:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f2');
INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
  SELECT 'demo-m-2-0', 'demo-f2', 'incoming', 'text', '明日10時の予約はまだ空いていますか?', NULL, 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-10-08T15:05:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f2');
INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
  SELECT 'demo-m-2-1', 'demo-f2', 'outgoing', 'text', 'ご連絡ありがとうございます。10時は空いております。ご予約をお取りしますね。', 'manual', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-10-08T15:20:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f2');
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id)
  SELECT 'demo-f2', 'demo-tag-regular' WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f2');
INSERT OR IGNORE INTO friends (id, line_user_key, line_user_id, line_account_id, display_name, real_name, memo, is_following, created_at, updated_at)
  SELECT 'demo-f3', 'Udemo000000000000000000000000003', 'Udemo000000000000000000000000003', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '鈴木 ゆうこ', '鈴木 ゆうこ', '次回は3週間後', 1, '2026-09-20T10:00:00.000', '2026-09-20T10:00:00.000'
  WHERE EXISTS (SELECT 1 FROM line_accounts WHERE id = 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8');
INSERT OR IGNORE INTO chats (id, friend_id, status, last_message_at, line_account_id, created_at, updated_at)
  SELECT 'demo-c-3', 'demo-f3', 'resolved', '2026-10-07T12:10:00.000', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-09-20T10:00:00.000', '2026-10-07T12:10:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f3');
INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
  SELECT 'demo-m-3-0', 'demo-f3', 'incoming', 'text', '先日はありがとうございました!仕上がりに満足しています。', NULL, 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-10-07T11:50:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f3');
INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
  SELECT 'demo-m-3-1', 'demo-f3', 'outgoing', 'text', 'ありがとうございます!またのご来店をお待ちしております。', 'manual', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-10-07T12:10:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f3');
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id)
  SELECT 'demo-f3', 'demo-tag-regular' WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f3');
INSERT OR IGNORE INTO friends (id, line_user_key, line_user_id, line_account_id, display_name, real_name, memo, is_following, created_at, updated_at)
  SELECT 'demo-f4', 'Udemo000000000000000000000000004', 'Udemo000000000000000000000000004', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '高橋 まなみ', '高橋 まなみ', NULL, 1, '2026-09-20T10:00:00.000', '2026-09-20T10:00:00.000'
  WHERE EXISTS (SELECT 1 FROM line_accounts WHERE id = 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8');
INSERT OR IGNORE INTO chats (id, friend_id, status, last_message_at, line_account_id, created_at, updated_at)
  SELECT 'demo-c-4', 'demo-f4', 'unread', '2026-10-09T09:30:00.000', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-09-20T10:00:00.000', '2026-10-09T09:30:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f4');
INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
  SELECT 'demo-m-4-0', 'demo-f4', 'incoming', 'text', '営業時間を教えてください。', NULL, 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-10-09T09:30:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f4');
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id)
  SELECT 'demo-f4', 'demo-tag-new' WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f4');
INSERT OR IGNORE INTO friends (id, line_user_key, line_user_id, line_account_id, display_name, real_name, memo, is_following, created_at, updated_at)
  SELECT 'demo-f5', 'Udemo000000000000000000000000005', 'Udemo000000000000000000000000005', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '伊藤 けんた', '伊藤 けんた', NULL, 1, '2026-09-20T10:00:00.000', '2026-09-20T10:00:00.000'
  WHERE EXISTS (SELECT 1 FROM line_accounts WHERE id = 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8');
INSERT OR IGNORE INTO chats (id, friend_id, status, last_message_at, line_account_id, created_at, updated_at)
  SELECT 'demo-c-5', 'demo-f5', 'in_progress', '2026-10-06T19:00:00.000', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-09-20T10:00:00.000', '2026-10-06T19:00:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f5');
INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
  SELECT 'demo-m-5-0', 'demo-f5', 'incoming', 'text', 'クーポンは併用できますか?', NULL, 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-10-06T18:40:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f5');
INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
  SELECT 'demo-m-5-1', 'demo-f5', 'outgoing', 'text', 'クーポンの併用は1回のご来店につき1枚までとなっております。', 'manual', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-10-06T19:00:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f5');
INSERT OR IGNORE INTO friends (id, line_user_key, line_user_id, line_account_id, display_name, real_name, memo, is_following, created_at, updated_at)
  SELECT 'demo-f6', 'Udemo000000000000000000000000006', 'Udemo000000000000000000000000006', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '山本 りか', '山本 りか', NULL, 1, '2026-09-20T10:00:00.000', '2026-09-20T10:00:00.000'
  WHERE EXISTS (SELECT 1 FROM line_accounts WHERE id = 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8');
INSERT OR IGNORE INTO chats (id, friend_id, status, last_message_at, line_account_id, created_at, updated_at)
  SELECT 'demo-c-6', 'demo-f6', 'resolved', '2026-10-05T10:30:00.000', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-09-20T10:00:00.000', '2026-10-05T10:30:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f6');
INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
  SELECT 'demo-m-6-0', 'demo-f6', 'incoming', 'text', '駐車場はありますか?', NULL, 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-10-05T10:10:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f6');
INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
  SELECT 'demo-m-6-1', 'demo-f6', 'outgoing', 'text', '近隣のコインパーキングをご利用いただけます。', 'manual', 'e84ccfd8-3f30-4b09-aef4-fb70b7ccd7a8', '2026-10-05T10:30:00.000'
  WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f6');
INSERT OR IGNORE INTO friend_tags (friend_id, tag_id)
  SELECT 'demo-f6', 'demo-tag-regular' WHERE EXISTS (SELECT 1 FROM friends WHERE id = 'demo-f6');
