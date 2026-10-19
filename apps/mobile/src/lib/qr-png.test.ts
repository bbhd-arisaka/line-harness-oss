import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { bytesToBase64, qrMatrix, qrPngBase64 } from './qr-png';

function decode(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  expect(Array.from(buf.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let p = 8;
  let width = 0;
  let idat = Buffer.alloc(0);
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') width = data.readUInt32BE(0);
    if (type === 'IDAT') idat = Buffer.concat([idat, data]);
    p += 12 + len;
  }
  return { width, raw: inflateSync(idat) };
}

describe('QRコードのPNG(端末の中で作る)', () => {
  it('base64: 標準の変換と同じ(余りの長さ 0・1・2)', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'https://example.com/r/AbC234?account=2008163446']) {
      expect(bytesToBase64(new TextEncoder().encode(s))).toBe(Buffer.from(s).toString('base64'));
    }
  });
  it('PNGとして読める(zlib で展開でき、画素が QR の並びと一致する)', () => {
    const url = 'https://beyond-line.cms-manager.jp/r/HFSLUx?account=2008163446';
    const scale = 6;
    const margin = 4;
    const { width, raw } = decode(qrPngBase64(url, { scale, margin }));
    const m = qrMatrix(url);
    expect(width).toBe((m.length + margin * 2) * scale);
    const rowBytes = Math.ceil(width / 8);
    expect(raw.length).toBe((rowBytes + 1) * width);
    const pixelBlack = (x: number, y: number) => ((raw[y * (rowBytes + 1) + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m.length; x++) {
        expect(pixelBlack((x + margin) * scale + 1, (y + margin) * scale + 1)).toBe(m[y][x]);
      }
    }
    expect(pixelBlack(0, 0)).toBe(false); // 余白は白
  });
  it('位置合わせの四角(左上の7×7)が、QRの決まりどおり', () => {
    const m = qrMatrix('x');
    for (let i = 0; i < 7; i++) {
      expect(m[0][i]).toBe(true);
      expect(m[6][i]).toBe(true);
      expect(m[i][0]).toBe(true);
      expect(m[i][6]).toBe(true);
    }
    expect(m[1][1]).toBe(false);
    expect(m[2][2]).toBe(true);
  });
  it('大きなサイズでも、65535バイトをこえる分を分けて書く', () => {
    const { raw, width } = decode(qrPngBase64('https://example.com/' + 'a'.repeat(200), { scale: 16, margin: 4 }));
    expect(raw.length).toBe((Math.ceil(width / 8) + 1) * width);
  });
});
