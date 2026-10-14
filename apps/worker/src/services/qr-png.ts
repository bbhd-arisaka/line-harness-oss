import qrcode from 'qrcode-generator';

/**
 * 文字列(URL)から、QR コードの PNG 画像を作る(外部のサービスは使わない)。
 * 白黒 1 ビットの PNG。画像の保存・印刷・SNS での共有に向けて、大きめ(1マス 10px・余白 4マス)にする。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const body = new Response(data).body;
  if (!body) throw new Error('compression failed');
  return new Uint8Array(await new Response(body.pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

export interface QrPngOptions {
  /** 1マスのピクセル数 */
  scale?: number;
  /** 周りの余白(マス数)。QR の規格は 4 */
  margin?: number;
}

/** QR のマス目(true = 黒)を作る */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

export async function makeQrPng(text: string, options: QrPngOptions = {}): Promise<Uint8Array> {
  const scale = options.scale ?? 10;
  const margin = options.margin ?? 4;
  const modules = qrModules(text);
  const size = (modules.length + margin * 2) * scale;
  const rowBytes = Math.ceil(size / 8);
  const raw = new Uint8Array((rowBytes + 1) * size); // 各行の先頭1バイトはフィルター(0)
  raw.fill(0xff); // 1 = 白
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    const r = Math.floor(y / scale) - margin;
    if (r < 0 || r >= modules.length) continue;
    for (let x = 0; x < size; x++) {
      const c = Math.floor(x / scale) - margin;
      if (c < 0 || c >= modules.length || !modules[r][c]) continue;
      raw[rowStart + 1 + (x >> 3)] &= ~(0x80 >> (x & 7)); // 0 = 黒
    }
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(size), 0);
  ihdr.set(u32(size), 4);
  ihdr[8] = 1; // ビット深度 1
  ihdr[9] = 0; // グレースケール
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', await zlibDeflate(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** LINE 公式アカウントの友だち追加 URL(basicId は「@」付きでも無しでもよい) */
export function friendAddUrl(basicId: string): string {
  const id = basicId.trim().replace(/^@/, '');
  return `https://line.me/R/ti/p/%40${encodeURIComponent(id)}`;
}
