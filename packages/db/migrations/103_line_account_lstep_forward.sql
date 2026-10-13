-- 103: Lステップとの並行運用。LINEから届いたWebhookを、そのままLステップにも転送する(アカウントごと)
-- lstep_forward_url: Lステップの受信URL(https://rcv.linestep.net/v3/call/◯◯◯)。設定されているアカウントは「並行運用中」で、
--                    beyond line からの自動送信(自動応答・あいさつ等)は行わない
ALTER TABLE line_accounts ADD COLUMN lstep_forward_url TEXT;
