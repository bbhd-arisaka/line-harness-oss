import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * 公開ページ(ログイン不要): プライバシーポリシー・サポート。
 * App Store の審査で、プライバシーポリシーのURLとサポートURLが必須のため。
 * 文面は法務の確認を受けたものではない。公開前に、会社として確認すること。
 */
export const legal = new Hono<Env>();

const OPERATOR = 'beyond beauty holding株式会社';
const UPDATED = '2026年10月4日';
/** 問い合わせ先(2026-10-04 ユーザー承認済み)。変えたいときは Worker の変数 SUPPORT_EMAIL で上書きできる */
const DEFAULT_SUPPORT_EMAIL = 'info@bb-holdings.co.jp';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function contactBlock(email: string | undefined): string {
  const mail = email?.trim() || DEFAULT_SUPPORT_EMAIL;
  return `<p>メール: <a href="mailto:${escapeHtml(mail)}">${escapeHtml(mail)}</a></p>`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} | beyond line</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 16px/1.8 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif; background: #f7f8f7; color: #1a231c; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 20px 64px; }
  h1 { font-size: 24px; margin: 8px 0 4px; }
  h2 { font-size: 18px; margin: 32px 0 8px; padding-left: 10px; border-left: 4px solid #06c755; }
  p, li { color: #333; }
  ul { padding-left: 1.4em; }
  .meta { color: #666; font-size: 14px; }
  a { color: #0b7a3b; }
  @media (prefers-color-scheme: dark) {
    body { background: #121614; color: #e8ece9; }
    p, li { color: #cfd6d1; }
    .meta { color: #98a39b; }
    a { color: #5fd18c; }
  }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

legal.get('/privacy', (c) => {
  const body = `
<h1>プライバシーポリシー</h1>
<p class="meta">beyond line(管理画面・iPhoneアプリ)/ 制定: ${UPDATED}</p>

<p>${OPERATOR}(以下「当社」)は、LINE公式アカウントの運営を支援するサービス「beyond line」(Webの管理画面とiPhoneアプリ。以下「本サービス」)での個人情報の取り扱いについて、次のとおり定めます。</p>

<h2>1. 本サービスについて</h2>
<p>本サービスは、LINE公式アカウントを運営する店舗・事業者(以下「店舗」)のスタッフが、お客様(LINEの友だち)とのトークの確認・返信、友だち情報やタグの管理、フォームの回答の確認などを行うための管理ツールです。お客様の情報は店舗が管理するものであり、当社は店舗の依頼を受けて、その情報を本サービス上で預かり、処理します。</p>

<h2>2. 取り扱う情報</h2>
<p><strong>スタッフ(本サービスを使う方)の情報</strong></p>
<ul>
  <li>氏名、メールアドレス、役割(オーナー・管理者・スタッフ)、閲覧を許可されたLINEアカウント</li>
  <li>ログインの記録、ご利用の端末の名前、プッシュ通知の宛先(通知用のトークン)</li>
</ul>
<p><strong>お客様(LINEの友だち)の情報</strong></p>
<ul>
  <li>LINEの表示名、プロフィール画像、LINEのユーザーID</li>
  <li>お客様と店舗とのトークの内容(送信・受信したメッセージ、画像など)</li>
  <li>フォームやアンケートへの回答(本名、ふりがな、電話番号、住所、生年月日、予約・来店・施術に関する情報など、店舗がフォームで尋ねた内容)</li>
  <li>店舗が付けたタグ、友だち情報、メモ、対応状況、来店や配信に関する記録</li>
</ul>

<h2>3. 利用目的</h2>
<ul>
  <li>お客様からのお問い合わせ・予約への対応、メッセージの送受信、案内の配信</li>
  <li>店舗スタッフの本人確認、権限の管理、不正なログインの防止</li>
  <li>新着メッセージのプッシュ通知</li>
  <li>本サービスの運営・保守・品質の向上、障害時の調査</li>
</ul>
<p>上記の目的以外には使いません。広告への利用、利用状況の追跡(トラッキング)、情報の販売は行いません。</p>

<h2>4. 第三者への提供・委託</h2>
<p>法令に基づく場合を除き、本人の同意なく第三者へ提供しません。本サービスの提供のため、次の事業者に処理を委託、またはサービスを利用しています。</p>
<ul>
  <li>LINEヤフー株式会社(LINE公式アカウントのメッセージの送受信)</li>
  <li>Cloudflare, Inc.(サーバー・データベースの運用)</li>
  <li>Apple Inc.(iPhoneへのプッシュ通知)</li>
  <li>Expo(アプリの更新の配信。お客様の情報は送りません)</li>
</ul>
<p>これらの事業者の所在地は日本国外の場合があります。</p>

<h2>5. 安全管理</h2>
<ul>
  <li>通信はすべて暗号化(HTTPS)します。</li>
  <li>スタッフごとに、見られるLINEアカウントを制限できます。店舗ごとにお客様の情報は分けて管理され、他の店舗からは見えません。</li>
  <li>アプリのログイン情報は、iPhoneの安全な保管領域(キーチェーン)に保存します。端末を紛失したときは、管理者がその端末のログインを取り消せます。</li>
  <li>スタッフが停止された場合、そのスタッフのログインは即座に使えなくなります。</li>
</ul>

<h2>6. 保存期間</h2>
<p>お客様の情報は、店舗が本サービスを利用している間、店舗の指示のもとで保存します。店舗が契約を終了した場合や、店舗から削除の依頼があった場合は、合理的な期間内に削除します。</p>

<h2>7. 開示・訂正・利用停止・削除のご請求</h2>
<p><strong>お客様(LINEの友だち)の場合</strong>: お客様の情報は、お使いの店舗が管理しています。ご自身の情報の開示・訂正・削除などは、まずその店舗へご連絡ください。当社は、店舗からの依頼に基づき対応します。</p>
<p><strong>スタッフの場合</strong>: アプリの「設定」→「アカウントの削除を申請」から、削除を申請できます。申請するとすべての端末からログアウトされ、以後は本サービスに入れなくなります。ユーザー情報の削除は、会社の管理者が beyond admin で行います。その他のご請求は、下記のお問い合わせ先へご連絡ください。</p>

<h2>8. お問い合わせ</h2>
<p>${OPERATOR}</p>
${contactBlock(c.env.SUPPORT_EMAIL)}

<h2>9. 改定</h2>
<p>本ポリシーは、法令の変更や本サービスの変更に応じて改定することがあります。重要な変更があるときは、本ページでお知らせします。</p>
`;
  return c.html(page('プライバシーポリシー', body));
});

legal.get('/support', (c) => {
  const body = `
<h1>サポート</h1>
<p class="meta">beyond line(管理画面・iPhoneアプリ)</p>

<h2>ログインできないとき</h2>
<ul>
  <li>ログインには、beyond admin と同じメールアドレス・パスワードを使います。</li>
  <li>「このユーザーは停止されています」と出る場合は、会社の管理者へ連絡してください。</li>
  <li>「ログインに何度も失敗したため…」と出た場合は、15分ほど待ってからお試しください。</li>
  <li>パスワードを忘れた場合は、beyond admin で再設定してください。</li>
</ul>

<h2>お客様のトーク・友だちが見えないとき</h2>
<p>スタッフごとに、見られるLINEアカウントが決まっています。見られない場合は、会社のオーナーに、アカウントの閲覧権限を依頼してください。</p>

<h2>通知が来ないとき</h2>
<p>iPhoneの「設定」→「beyond line」→「通知」を許可してください。アプリ内の「設定」タブで、通知の状態を確認できます。</p>

<h2>アカウントの削除</h2>
<p>アプリの「設定」→「アカウントの削除を申請」から申請できます。申請するとすべての端末からログアウトされます。詳しくは<a href="/privacy">プライバシーポリシー</a>をご覧ください。</p>

<h2>お問い合わせ</h2>
<p>${OPERATOR}</p>
${contactBlock(c.env.SUPPORT_EMAIL)}
`;
  return c.html(page('サポート', body));
});

// スタッフ向け: アプリ(Expo Go)の最新版を開く入口。配信のたびにリンクを探さなくてよいように、固定リンクへ案内する。
legal.get('/app', (c) => {
  const link = 'exp://u.expo.dev/959aad6e-128e-4235-980c-13d68e14e78f?channel-name=preview&runtime-version=0.1.0';
  const body = `
<h1>アプリを開く(試験版)</h1>
<p>iPhoneに無料アプリ「Expo Go」を入れてから、下のボタンを押してください。いつでも最新版が開きます。</p>
<p><a href="${link}" style="display:inline-block;padding:14px 22px;background:#06c755;color:#fff;border-radius:12px;font-weight:700;text-decoration:none">最新のアプリを開く</a></p>
<p class="meta">開かないときは、Expo Go を開いたまま、このページをもう一度開いてください。</p>
<p><a href="/privacy">プライバシーポリシー</a> / <a href="/support">サポート</a></p>
`;
  return c.html(page('アプリを開く', body));
});
