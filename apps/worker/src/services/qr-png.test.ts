import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { friendAddUrl, makeQrPng, qrModules, toBase64 } from './qr-png.js';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readChunks(png: Uint8Array) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: { type: string; data: Uint8Array }[] = [];
  let o = 8;
  while (o < png.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    chunks.push({ type, data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return chunks;
}

describe('friendAddUrl', () => {
  it('「@」付きでも無しでも、同じ友だち追加URLになる', () => {
    expect(friendAddUrl('@123abcde')).toBe('https://line.me/R/ti/p/%40123abcde');
    expect(friendAddUrl('123abcde')).toBe('https://line.me/R/ti/p/%40123abcde');
    expect(friendAddUrl(' @ab-c ')).toBe('https://line.me/R/ti/p/%40ab-c');
  });
});

describe('makeQrPng', () => {
  it('PNG として正しい: 署名・IHDR・IDAT・IEND があり、画像サイズは (マス数+余白)×1マスのピクセル数', async () => {
    const text = 'https://line.me/R/ti/p/%40123abcde';
    const png = await makeQrPng(text, { scale: 4, margin: 4 });
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIG);
    const chunks = readChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, 13);
    const n = qrModules(text).length;
    const size = (n + 8) * 4;
    expect(ihdr.getUint32(0)).toBe(size);
    expect(ihdr.getUint32(4)).toBe(size);
    expect(chunks[0].data[8]).toBe(1);
  });
  it('展開した画素が、QR のマス目と一致する(余白は白、黒のマスは黒)', async () => {
    const text = 'https://line.me/R/ti/p/%40abc';
    const scale = 3;
    const margin = 4;
    const png = await makeQrPng(text, { scale, margin });
    const idat = readChunks(png).find((c) => c.type === 'IDAT')!.data;
    const raw = inflateSync(Buffer.from(idat));
    const modules = qrModules(text);
    const size = (modules.length + margin * 2) * scale;
    const rowBytes = Math.ceil(size / 8);
    expect(raw.length).toBe((rowBytes + 1) * size);
    const pixelBlack = (x: number, y: number) => ((raw[y * (rowBytes + 1) + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0;
    expect(pixelBlack(0, 0)).toBe(false); // 余白
    for (let r = 0; r < modules.length; r++) {
      for (let c = 0; c < modules.length; c++) {
        expect(pixelBlack((c + margin) * scale + 1, (r + margin) * scale + 1)).toBe(modules[r][c]);
      }
    }
  });
  it('CRC が正しい(壊れた PNG にならない)', async () => {
    const png = await makeQrPng('https://example.com', { scale: 2 });
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let o = 8;
    while (o < png.length) {
      const len = dv.getUint32(o);
      const body = png.subarray(o + 4, o + 8 + len);
      let c = 0xffffffff;
      for (const b of body) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      expect((c ^ 0xffffffff) >>> 0).toBe(dv.getUint32(o + 8 + len));
      o += 12 + len;
    }
  });
  it('toBase64 は PNG をそのまま戻せる', async () => {
    const png = await makeQrPng('https://example.com', { scale: 2 });
    const back = Uint8Array.from(atob(toBase64(png)), (ch) => ch.charCodeAt(0));
    expect(back).toEqual(png);
  });
});
