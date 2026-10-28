-- Android アプリ(FCM)へのプッシュ通知の送り先。iOS は apns_token、Android は fcm_token。1つの端末(セッション)は、どちらか片方だけを持つ。
ALTER TABLE app_sessions ADD COLUMN fcm_token TEXT;
