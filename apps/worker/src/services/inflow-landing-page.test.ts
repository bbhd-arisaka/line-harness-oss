import { describe, expect, it } from 'vitest';
import { renderLandingPage } from './inflow-landing-page.js';
import { resolveLanding } from './inflow-landing-style.js';

describe('友だち追加ページの HTML(実際のページとプレビューで共通)', () => {
  it('スマホ: 見出し・ボタン・iPhone だけの注意書き・うまく開けない方は', () => {
    const L = resolveLanding(null);
    const ios = renderLandingPage(L, { kind: 'mobile', buttonHref: 'https://liff.line.me/x', helpUrl: '/r/a/help', ios: true });
    expect(ios).toContain('友達追加して始める');
    expect(ios).toContain('href="https://liff.line.me/x"');
    expect(ios).toContain('<strong>長押し</strong>');
    expect(ios).toContain('うまく開けない方は');
    expect(ios).toContain('noindex');
    const other = renderLandingPage(L, { kind: 'mobile', buttonHref: 'https://x', helpUrl: '/h', ios: false });
    expect(other).not.toContain('長押し');
  });
  it('PC: QR のページ。見出しは別に設定できる', () => {
    const html = renderLandingPage(resolveLanding({ pcTitle: 'QRを読み取って' }), { kind: 'pc', qrSrc: '/api/qr?size=240x240&data=abc' });
    expect(html).toContain('QRを読み取って');
    expect(html).toContain('/api/qr?size=240x240&amp;data=abc');
    expect(html).not.toContain('<a href');
  });
  it('背景画像・かぶせる色・透過・ぼかし・角丸・アイコンが、CSS に出る', () => {
    const html = renderLandingPage(
      resolveLanding({ bgImageUrl: 'https://example.com/bg.jpg', bgOverlayOpacity: 30, cardOpacity: 70, cardBlur: 12, cardRadius: 32, buttonRadius: 4, buttonOpacity: 80, iconUrl: 'https://example.com/i.png', subtitle: '初回限定' }),
      { kind: 'mobile', buttonHref: '#', helpUrl: '#' },
    );
    expect(html).toContain('url("https://example.com/bg.jpg")');
    expect(html).toContain('class="veil"');
    expect(html).toContain('rgba(255,255,255,0.7)');
    expect(html).toContain('backdrop-filter:blur(12px)');
    expect(html).toContain('border-radius:32px');
    expect(html).toContain('border-radius:4px');
    expect(html).toContain('<img src="https://example.com/i.png"');
    expect(html).toContain('初回限定');
  });
  it('アイコン・注意書き・うまく開けない方は、出さない設定にできる。文字は HTML として解釈されない', () => {
    const html = renderLandingPage(resolveLanding({ showIcon: false, showHint: false, showHelp: false, title: '<b>x</b>' }), { kind: 'mobile', buttonHref: '#', helpUrl: '#', ios: true });
    expect(html).not.toContain('class="icon"');
    expect(html).not.toContain('class="hint"');
    expect(html).not.toContain('class="help"');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('class="bg"');
  });
});
