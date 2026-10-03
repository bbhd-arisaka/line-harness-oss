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

  it('問い合わせ先メールは設定があるときだけ載り、HTMLとして解釈されない', async () => {
    const without = await (await legal.request('/support', {}, {} as never)).text();
    expect(without).not.toContain('mailto:');
    const withMail = await (await legal.request('/support', {}, { SUPPORT_EMAIL: 'a@example.com"><script>x</script>' } as never)).text();
    expect(withMail).not.toContain('<script>x</script>');
    expect(withMail).toContain('mailto:');
  });
});
