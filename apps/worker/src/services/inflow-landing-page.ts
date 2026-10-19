import { escapeHtml } from './inflow-route-landing.js';
import type { ResolvedLanding } from './inflow-landing-style.js';

/**
 * 友だち追加ページ(/r/<ref>)の HTML。実際のページと、管理画面のプレビューは、これ1つで作る(見た目が必ず同じになる)。
 *  - mobile: 「LINEで開く」のボタン(iPhone は、開かないとき用の注意書き)
 *  - pc: QR コード
 */

export interface LandingRenderOptions {
  kind: 'mobile' | 'pc';
  /** mobile: ボタンの行き先 */
  buttonHref?: string;
  /** mobile: 「うまく開けない方は こちら」の行き先 */
  helpUrl?: string;
  /** pc: QR 画像のURL */
  qrSrc?: string;
  /** mobile: iPhone か(注意書きを出す) */
  ios?: boolean;
}

const BUBBLE_PATH =
  'M24 12C17.37 12 12 16.58 12 22.2c0 3.54 2.35 6.65 5.86 8.47-.2.74-.76 2.75-.87 3.17-.14.55.2.54.42.39.18-.12 2.84-1.88 4-2.65.84.13 1.7.22 2.59.22 6.63 0 12-4.58 12-10.2S30.63 12 24 12z';

function iconHtml(L: ResolvedLanding): string {
  if (!L.showIcon) return '';
  if (L.iconUrl) return `<div class="icon"><img src="${L.iconUrl}" alt=""></div>`;
  return `<div class="icon"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect width="48" height="48" fill="${L.colors.button}"/><path d="${BUBBLE_PATH}" fill="${L.colors.buttonText}"/></svg></div>`;
}

function css(L: ResolvedLanding, kind: 'mobile' | 'pc'): string {
  const c = L.colors;
  const bg = L.bgImageUrl ? `.bg{position:fixed;inset:0;background:url("${L.bgImageUrl}") center/cover no-repeat;z-index:0}` : '';
  const veil = c.veil ? `.veil{position:fixed;inset:0;background:${c.veil};z-index:0}` : '';
  const blur = L.blur > 0 ? `backdrop-filter:blur(${L.blur}px);-webkit-backdrop-filter:blur(${L.blur}px);` : '';
  return `*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Helvetica Neue',Arial,sans-serif;color:${c.text};background:${c.pageBg};-webkit-font-smoothing:antialiased;min-height:100vh}
${bg}
${veil}
.wrap{position:relative;z-index:1;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.card{width:100%;max-width:${kind === 'pc' ? 440 : 380}px;background:${c.cardBg};border-radius:${L.cardRadius}px;padding:${kind === 'pc' ? '44px 40px 36px' : '40px 28px 28px'};text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.04),0 14px 44px rgba(0,0,0,.09);border:1px solid ${c.cardLine};${blur}animation:rise .5s cubic-bezier(.22,.61,.36,1) both}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.icon{width:64px;height:64px;margin:0 auto 22px;border-radius:${Math.round(Math.min(L.cardRadius, 20) * 0.9)}px;overflow:hidden;box-shadow:0 8px 22px ${c.shadow}}
.icon svg,.icon img{display:block;width:100%;height:100%;object-fit:cover}
.title{font-size:20px;font-weight:700;line-height:1.5;letter-spacing:.01em}
.sub{margin-top:10px;font-size:14px;line-height:1.75;color:${c.muted}}
.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:30px;padding:0 20px;border-radius:${L.buttonRadius}px;font-size:17px;font-weight:700;letter-spacing:.02em;color:${c.buttonText};background:${c.buttonBg};box-shadow:0 10px 24px ${c.shadow};text-decoration:none;transition:transform .15s,opacity .15s}
.btn:active{transform:scale(.98);opacity:.92}
.hint{margin-top:16px;font-size:12px;line-height:1.75;color:${c.muted}}
.hint strong{color:${c.button};font-weight:700}
.help{margin-top:22px;font-size:12px;line-height:1.6;color:${c.muted}}
.help a{color:${c.muted};text-decoration:underline;text-underline-offset:3px}
.qr{display:inline-block;margin-top:28px;padding:16px;background:#fff;border-radius:${Math.max(8, Math.min(L.cardRadius, 24))}px;box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.08)}
.qr img{display:block;width:220px;height:220px}
@media (prefers-reduced-motion:reduce){.card{animation:none}.btn{transition:none}}`;
}

export function renderLandingPage(L: ResolvedLanding, o: LandingRenderOptions): string {
  const head = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(o.kind === 'pc' ? L.pcTitle : L.title)}</title>
<style>
${css(L, o.kind)}
</style>
</head>
<body>
${L.bgImageUrl ? '<div class="bg"></div>' : ''}${L.colors.veil ? '<div class="veil"></div>' : ''}
<div class="wrap">
<main class="card">
${iconHtml(L)}`;
  const sub = L.subtitle ? `<p class="sub">${escapeHtml(L.subtitle)}</p>` : '';
  if (o.kind === 'pc') {
    return `${head}
<h1 class="title">${escapeHtml(L.pcTitle)}</h1>
${sub}
<div class="qr"><img src="${escapeHtml(o.qrSrc ?? '')}" alt="QR Code"></div>
<p class="hint">LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます</p>
</main>
</div>
</body>
</html>`;
  }
  const hint =
    o.ios && L.showHint
      ? `<p class="hint">${L.hintText === null ? `※開かない場合はボタンを<strong>長押し</strong>して「${escapeHtml(L.buttonText)}」を選択` : escapeHtml(L.hintText)}</p>`
      : '';
  const help = L.showHelp ? `<p class="help">${escapeHtml(L.helpText)} <a href="${escapeHtml(o.helpUrl ?? '#')}">${escapeHtml(L.helpLinkText)}</a></p>` : '';
  return `${head}
<h1 class="title">${escapeHtml(L.title)}</h1>
${sub}
<a href="${escapeHtml(o.buttonHref ?? '#')}" class="btn">${escapeHtml(L.buttonText)}</a>
${hint}
${help}
</main>
</div>
</body>
</html>`;
}
