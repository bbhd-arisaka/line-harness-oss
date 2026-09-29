import { describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getLineAccountById: vi.fn(), resolveDefaultLineAccount: vi.fn() }));
vi.mock('@line-crm/db', () => mocks);

import { expandFormLinks } from './form-link.js';

const db = {} as D1Database;

describe('expandFormLinks(フォームのタグコード → 送信アカウントのLIFFリンク)', () => {
  test('送信アカウントごとに、そのアカウントのLIFFでリンクを作る', async () => {
    mocks.getLineAccountById.mockImplementation(async (_db, id: string) => ({ A: { liff_id: 'LIFF-A' }, B: { liff_id: 'LIFF-B' } }[id] ?? null));
    expect(await expandFormLinks(db, 'ご記入ください {{form_url:f1}}', 'A')).toBe('ご記入ください https://liff.line.me/LIFF-A?page=form&id=f1');
    expect(await expandFormLinks(db, '{{form_url:f1}}', 'B')).toBe('https://liff.line.me/LIFF-B?page=form&id=f1');
  });

  test('複数のタグコードも、すべて置き換える', async () => {
    mocks.getLineAccountById.mockResolvedValue({ liff_id: 'L' });
    expect(await expandFormLinks(db, '{{form_url:a}} と {{form_url:b}}', 'A')).toBe(
      'https://liff.line.me/L?page=form&id=a と https://liff.line.me/L?page=form&id=b',
    );
  });

  test('LIFFが未設定なら置き換えない(リンクが消えたメッセージを送らない)', async () => {
    mocks.getLineAccountById.mockResolvedValue({ liff_id: null });
    expect(await expandFormLinks(db, '{{form_url:f1}}', 'A')).toBe('{{form_url:f1}}');
  });

  test('アカウント不明のときは既定アカウントを使う', async () => {
    mocks.resolveDefaultLineAccount.mockResolvedValue({ liff_id: 'DEF' });
    expect(await expandFormLinks(db, '{{form_url:f1}}', null)).toBe('https://liff.line.me/DEF?page=form&id=f1');
  });

  test('タグコードが無い本文は、DBを引かずにそのまま返す', async () => {
    mocks.getLineAccountById.mockClear();
    expect(await expandFormLinks(db, 'こんにちは', 'A')).toBe('こんにちは');
    expect(mocks.getLineAccountById).not.toHaveBeenCalled();
  });
});
