import { describe, expect, it } from 'vitest';
import { legal } from './legal.js';

describe('公開ページ(プライバシーポリシー・サポート)', () => {
  it('/privacy はログインなしで日本語のポリシーを返す', async () => {
    const res = await legal.request('/privacy', {}, {} as never);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('プライバシーポリシー');
    expect(html).toContain('アカウントの削除を申請');
  });

  it('問い合わせ先メールは既定のアドレスが載り、変数で上書きでき、HTMLとして解釈されない', async () => {
    const without = await (await legal.request('/support', {}, {} as never)).text();
    expect(without).toContain('mailto:info@bb-holdings.co.jp');
    const withMail = await (await legal.request('/support', {}, { SUPPORT_EMAIL: 'a@example.com"><script>x</script>' } as never)).text();
    expect(withMail).not.toContain('<script>x</script>');
    expect(withMail).toContain('mailto:');
  });

  it('/app は最新版へ案内する固定リンクを返す', async () => {
    const html = await (await legal.request('/app', {}, {} as never)).text();
    expect(html).toContain('exp://u.expo.dev/959aad6e-128e-4235-980c-13d68e14e78f?channel-name=preview');
  });
});
