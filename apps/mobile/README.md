# beyond line(iOS アプリ)

beyond line のスタッフ用 iOS アプリ(React Native + Expo SDK 57 + Expo Router、TypeScript)。
WebView ではなく、本物のネイティブ画面で作っています(App Store 審査 Guideline 4.2 対策)。

- 名前: beyond line / Bundle ID: `jp.cms-manager.beyondline` / iPhone のみ
- API: `https://beyond-line.cms-manager.jp`(環境変数 `EXPO_PUBLIC_API_URL` で上書き可)
- **このディレクトリは pnpm ワークスペースの外**(`pnpm-workspace.yaml` で除外)。**npm で独立管理**し、`@line-crm/shared` など他パッケージには依存しません(型は `src/lib/types.ts` に最小限で定義)。

## 画面(段階 A2)

| 画面 | ファイル | 使う API |
|---|---|---|
| ログイン | `app/login.tsx` | `POST /api/app/login` |
| 公式アカウントの切り替え | `app/(app)/select-account.tsx` | `GET /api/line-accounts` |
| トーク一覧(タブ) | `app/(app)/(tabs)/index.tsx` | `GET /api/chats` |
| トーク画面 | `app/(app)/chat/[id].tsx` | `GET /api/chats/:id`、`POST /api/chats/:id/send`、`PUT /api/chats/:id`(対応状態の変更)。10 秒ごとにポーリング。画像はタップで拡大 |
| 友だち一覧(タブ) | `app/(app)/(tabs)/friends.tsx` | `GET /api/friends` |
| 友だち詳細 | `app/(app)/friend/[id].tsx` | `GET /api/friends/:id`、`/api/friends/:id/rich-menu`、`/api/friend-fields/definitions`、`PUT /api/friends/:id/profile`(本名・システム表示名・個別メモの編集) |
| 設定(タブ) | `app/(app)/(tabs)/settings.tsx` | `POST /api/app/logout` |

認証は `Authorization: Bearer <アプリ用トークン>`(90 日・端末ごと・取り消し可能)。トークンは `expo-secure-store`(Keychain)に保存し、401 になったらログイン画面へ戻ります。
プッシュ通知: ログイン後に説明ダイアログ→通知の許可→APNs デバイストークン(`Notifications.getDevicePushTokenAsync()`。Expo のプッシュトークンではない)を `PUT /api/app/device` で登録(`src/state/push.tsx`)。ログアウト時は `null` で解除。通知のタップで `chat/[id]` を開く(通知のカスタムキー `chatId`・`accountId`)。**iOS のみ**(web では何もしない)。実際に届くのは Apple Developer 登録・APNs 認証キー・Worker 側の送信の後。

## 構成

```
app/                 Expo Router の画面(ファイル = ルート)
  _layout.tsx          ログイン状態で login / (app) を切り替え(Stack.Protected)
  login.tsx
  (app)/_layout.tsx    公式アカウントの取得。0 件・エラー・選択待ちをここで振り分け
  (app)/(tabs)/        トーク・友だち・設定のタブ
src/lib/             React Native に依存しない純粋な TypeScript(vitest でテスト)
  api.ts               API クライアント(fetch は差し替え可能)・ApiError
  auth.ts              ログイン状態ストア(保存先は注入)
  accounts.ts          公式アカウント選択のロジック
  errors.ts            エラー文言の日本語化(API の英語の error・通信失敗を利用者向けにする)
  notifications.ts     プッシュ通知の判断(トークの検証・許可の流れ・通知から開き先を決める)
  profile.ts           友だちの名前・メモ編集の検証と送る内容の組み立て
  format.ts            名前の優先順位・日時(日本時間)・吹き出し整形・友だち情報・リッチメニュー表示
  types.ts             API 応答の型(apps/worker/src/routes を読んで合わせたもの)
src/state/           React との接続(services = 実際のクライアント・保存先、session、hooks)
src/components/      共通 UI(ボタン・読み込み中/エラー/空の表示 など)
src/theme/theme.ts   色(緑 #06c755 基調・ダークモード対応)
assets/              仮のアイコン・スプラッシュ(`node scripts/generate-icons.mjs` で再生成。後で差し替え)
```

名前の表示は「本名 > システム表示名 > LINE名」(Web の `resolveFriendName` と同じ)。日時は端末のタイムゾーンに関係なく日本時間で表示します。

## 開発の始め方

```bash
cd apps/mobile
npm install
npm start            # Expo の開発サーバー。iPhone の Expo Go で QR を読めば実機確認できる(Apple 登録不要)
npm run web          # ブラウザで画面を確認(react-native-web。保存先は localStorage)
```

本番以外の API に向ける場合: `EXPO_PUBLIC_API_URL=http://localhost:8787 npm start`。

## テスト・検査

```bash
npm test             # vitest(src/lib の純粋ロジック。fetch はモック)
npm run typecheck    # tsc --noEmit
npm run lint         # expo lint(ESLint の Expo 既定)
npm run export:web   # expo export --platform web(ビルドできることの確認)
npx expo-doctor      # 依存の整合性
```

## 今後の作業

1. **EAS の初期化**: `npx eas-cli init` で EAS プロジェクトを作成し、`app.json` の `extra.eas.projectId`(現在は空)に ID が入る。`eas.json` の profile は `development` / `preview` / `production`(`production` は `autoIncrement`)。
2. **Apple Developer Program の登録完了後**(最大のブロッカー)
   - App ID・証明書・プロビジョニングは EAS が自動管理。
   - **プッシュ通知**: APNs 認証キー(.p8)を発行 → `expo-notifications` でデバイストークンを取得 → ログイン後に `api.setApnsToken()` で登録(ログアウト時は `null`)→ Worker から APNs へ直接送信。トーク画面のポーリングは通知に置き換える(または併用)。
   - **TestFlight 内部テスト**(スタッフのみ・審査不要): `eas build --profile production --platform ios` → `eas submit`。
3. **App Store 審査**(公開する場合)
   - プライバシーポリシー・サポート URL・スクリーンショット・審査用のテストアカウント(実際のお客様データが見えない閲覧専用のもの)。
   - Guideline 4.2(ネイティブ機能の十分さ)・5.1(プライバシー)・**アカウント削除の導線**の確認。
   - アイコン・スプラッシュを正式なデザインに差し替え(`assets/`)。
4. 機能の拡充(未実装): 画像の送信、トークの続き読み込み(現在は新しい 1000 件まで。超えるときは画面上部に注記を表示)、友だち情報欄(metadata)の編集。

## 注意

- 友だち一覧の検索欄は「名前で検索」。本名・システム表示名でも検索できるかは API(Worker)側の対応次第です(アプリは検索語を `search` で送るだけ)。
- 許可されていない公式アカウントは API が 403 を返し、メッセージをそのまま表示します。
- アカウントが 0 件のユーザー(権限の設定前)には「見られるアカウントがありません。管理者に権限の設定を依頼してください」を表示します。
