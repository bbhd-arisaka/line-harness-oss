// 仮アイコン生成(緑地に白の「b」)。後でデザイン済みの画像に差し替える。
// 使い方: node scripts/generate-icons.mjs  (外部ライブラリ不要)
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const GREEN = [6, 199, 85];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 「b」= 縦棒 + 右下のリング。座標は 0..1 の正規化。scale で全体の大きさを調整。
function inB(u, v, scale) {
  const s = (c) => 0.5 + (c - 0.5) / scale;
  const x = s(u), y = s(v);
  const stem = x >= 0.34 && x <= 0.45 && y >= 0.2 && y <= 0.8;
  const cx = 0.555, cy = 0.595, ro = 0.215, ri = 0.105;
  const d = Math.hypot(x - cx, y - cy);
  const ring = d <= ro && d >= ri;
  return stem || ring;
}

// 4x4 スーパーサンプリングで縁を滑らかにする
function coverage(x, y, size, scale) {
  let n = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    if (inB((x + (i + 0.5) / 4) / size, (y + (j + 0.5) / 4) / size, scale)) n++;
  }
  return n / 16;
}
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(v * (1 - t) + c2[i] * t));

mkdirSync('assets', { recursive: true });
const SIZE = 1024;
// アプリアイコン: 緑一色の背景 + 白い b(角丸は iOS が自動で付ける)
writeFileSync('assets/icon.png', png(SIZE, (x, y) => [...mix(GREEN, WHITE, coverage(x, y, SIZE, 1)), 255]));
// スプラッシュ: 透明背景 + 白い b(背景色は app.json の splash 設定で緑)
writeFileSync('assets/splash-icon.png', png(SIZE, (x, y) => [...WHITE, Math.round(coverage(x, y, SIZE, 0.8) * 255)]));
// Web ファビコン
writeFileSync('assets/favicon.png', png(48, (x, y) => [...mix(GREEN, WHITE, coverage(x, y, 48, 1)), 255]));
console.log('assets/icon.png, splash-icon.png, favicon.png を生成しました');
