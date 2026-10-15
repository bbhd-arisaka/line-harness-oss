# beyond line(L Harness フォーク)— Claude Code 向け

**最初に読む**: `事業管理/beyondシリーズ共通/README.md`(`../beyondシリーズ共通/README.md`)。全スレッド共通の知識(デプロイ・アプリ化・失敗と教訓・作業ルール・現状)の入口。進捗は `../BEYOND_PROGRESS_LOG.md`(末尾30行だけ読めばよい)。

## このリポジトリの要点
- Cloudflare(Worker+D1+R2+Durable Object)+ Next.js 静的管理画面(Pages)+ Expo iOSアプリ(`apps/mobile`)。pnpm ワークスペース(`apps/mobile` は含まれず、npm)。
- **`main` へ push で自動デプロイ**(D1 migration → Worker → 管理画面)。push 前に `pnpm --filter worker build`・worker/web の vitest、アプリを触ったら `apps/mobile` の `tsc` と `vitest` を通す。push 後は `gh run list -R bbhd-arisaka/line-harness-oss` で全部 success を確認。コミットは**自分のファイルだけ** `git add <ファイル>`(`migration-tools/` は未コミットのまま)。
- 並行運用中(`lstep_forward_url` あり)のアカウントは、**LINEへ一切送らない**。
- D1 の読み取り行数に注意。**トーク一覧(`/api/chats`)を定期取得しない**(`/api/chats/pulse` と WebSocket を使う)。
- iOS: EAS 無料枠は**ビルド月15回**。JS だけの変更は「Mobile OTA Update」。最低 iOS 16.4 固定。
- **ローカルの注意**: ① `apps/worker/wrangler.toml` はローカル専用(skip-worktree・本番ID入り)。② 秘密を含むファイル(`.line-harness-setup.json` `.env*` `.dev.vars`)は**リポジトリ内に置かない**(OneDrive に上がる)。置き場は `C:\Users\ありぼう\.beyond-line-local\`。③ pnpm の本体は `.npmrc`(git管理外)の `virtual-store-dir` で OneDrive の外。④ **`robocopy /MIR` を `node_modules` に使わない**(リンク先の実ファイルが消える。2026-10-15 の事故)。詳細は `02_デプロイ手順.md` 6節と `04_失敗と教訓.md` A-2。
