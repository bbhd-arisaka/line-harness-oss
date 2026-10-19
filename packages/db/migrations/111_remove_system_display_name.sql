-- 「システム表示名」の廃止。いまの値は、あとで戻せるようにバックアップに残してから、空にする
-- (名前は、本名 > LINE名 で表示される)。バックアップは、画面・APIからは使われない
CREATE TABLE IF NOT EXISTS friend_system_display_name_backup (
  friend_id   TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  backed_up_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
INSERT OR IGNORE INTO friend_system_display_name_backup (friend_id, value)
  SELECT id, system_display_name FROM friends WHERE system_display_name IS NOT NULL AND TRIM(system_display_name) != '';
UPDATE friends SET system_display_name = NULL WHERE system_display_name IS NOT NULL;
