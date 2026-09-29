-- Migration 079: 友だちの「システム表示名」を専用カラムに(Lステップの表示名編集モーダル準拠)。
-- display_name は LINE登録名(LINEから同期される値)のまま保持し、管理画面上の表示名だけを
-- 別カラムで上書きできるようにする。表示優先順位: system_display_name > real_name > display_name
ALTER TABLE friends ADD COLUMN system_display_name TEXT;
