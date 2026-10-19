// QR コードの画像(PNG)を、端末の中で作る。React Native に依存しない純粋な関数。
// 流入経路のURLが、外部のQR作成サービスに渡らないようにするため、通信せずに作る。
import qrcode from 'qrcode-generator';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

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

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Array.from(type, (ch) => ch.charCodeAt(0));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(8 + data.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 8 + data.length);
  return out;
}

/** 圧縮しない(stored)zlib の流れにする。QR は小さいので、これで十分 */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let p = 0;
  out[p++] = 0x78;
  out[p++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535;
    const len = Math.min(65535, raw.length - start);
    out[p++] = i === blocks - 1 ? 1 : 0;
    out[p++] = len & 255;
    out[p++] = len >> 8;
    out[p++] = ~len & 255;
    out[p++] = (~len >> 8) & 255;
    out.set(raw.subarray(start, start + len), p);
    p += len;
  }
  out.set(u32(adler32(raw)), p);
  return out;
}

/** 白黒(1ビット)の PNG にする。dark[y][x] が true のところが黒 */
export function monochromePng(dark: boolean[][], scale: number, margin: number): Uint8Array {
  const n = dark.length;
  const size = (n + margin * 2) * scale;
  const rowBytes = Math.ceil(size / 8);
  const raw = new Uint8Array((rowBytes + 1) * size);
  raw.fill(0xff); // 白(1ビット=1)
  for (let y = 0; y < size; y++) {
    const row = y * (rowBytes + 1);
    raw[row] = 0; // フィルターなし
    const my = Math.floor(y / scale) - margin;
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - margin;
      if (my >= 0 && my < n && mx >= 0 && mx < n && dark[my][mx]) raw[row + 1 + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array([...u32(size), ...u32(size), 1, 0, 0, 0, 0]); // 1ビット・グレー
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/** QR の黒白の並び(誤り訂正は M) */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => qr.isDark(y, x)));
}

/** QR コードの PNG を base64 で(例: URL → 画像)。表示は data URI、保存はそのまま書き出せる */
export function qrPngBase64(text: string, opts: { scale?: number; margin?: number } = {}): string {
  return bytesToBase64(monochromePng(qrMatrix(text), opts.scale ?? 8, opts.margin ?? 4));
}
