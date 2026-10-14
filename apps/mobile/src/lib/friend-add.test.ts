import { describe, expect, it } from 'vitest';
import { qrDataUri, qrFileName } from './friend-add';

describe('friend-add', () => {
  it('QR は、PNG の画像として表示できる形にする', () => {
    expect(qrDataUri('AAAA')).toBe('data:image/png;base64,AAAA');
  });
  it('保存するファイル名: ファイル名に使えない文字・空白・@ を除く。名前が空なら line', () => {
    expect(qrFileName('エクラブロウ イオンモール土岐店', '@123abcde')).toBe('友だち追加QR_エクラブロウイオンモール土岐店_123abcde.png');
    expect(qrFileName('a/b:c', '')).toBe('友だち追加QR_abc.png');
    expect(qrFileName('  ', '@x')).toBe('友だち追加QR_line_x.png');
  });
});
