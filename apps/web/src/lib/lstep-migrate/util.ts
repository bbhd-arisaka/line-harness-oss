/** 共通の小さな道具(Node/DOM に依存しない) */

const pad = (n: string, w = 2) => n.padStart(w, '0')

/**
 * Lステップの日時文字列(例 "2025/9/30 14:40:17" / "2025-09-30 14:40" / "2025-09-30T14:40:17")を
 * "YYYY-MM-DDTHH:mm:ss"(JST のつもり)にそろえる。読めなければ null。
 */
export function normalizeJst(s: string | null | undefined): string | null {
  const m = String(s ?? '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:${m[6] ?? '00'}`
}

/** UTF-8 のバイト列にする(TextEncoder に頼らない) */
export function utf8Bytes(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

/** SHA-1(16進)。友だち情報欄のキーを、過去の取り込み(Node の crypto)と同じ値にするために必要。 */
export function sha1Hex(text: string): string {
  const bytes = utf8Bytes(text)
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  for (const v of [hi, lo]) bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0
  const w = new Array<number>(80)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      let f: number, k: number
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const t = (rotl(a, 5) + (f >>> 0) + e + k + w[i]) >>> 0
      e = d; d = c; c = rotl(b, 30); b = a; a = t
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('')
}
