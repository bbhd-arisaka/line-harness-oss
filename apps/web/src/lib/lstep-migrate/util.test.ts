import { describe, expect, it } from 'vitest'
import { normalizeJst, sha1Hex } from './util'

describe('sha1Hex', () => {
  it('標準のテストベクタと一致する', () => {
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(sha1Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1')
  })
  it('日本語・絵文字(UTF-8)も Node の crypto と同じ値(過去の取り込みのキーと一致させるため)', () => {
    expect(sha1Hex('お名前')).toBe('0ae37cd30ad36be82867b762c6e756d9bfd10b0d')
    expect(sha1Hex('基本情報/お名前')).toBe('3c1aaa8c788b7f0c1a30cdc15c359b2750af1634')
    expect(sha1Hex('⭐️フォルダ/🌸あ')).toBe('fb73d3c6ec47a7a2904dc9f34c51c022e524da2f')
  })
})

describe('normalizeJst', () => {
  it('ゼロ埋め・区切り・秒なしをそろえる', () => {
    expect(normalizeJst('2025/9/30 14:40:17')).toBe('2025-09-30T14:40:17')
    expect(normalizeJst('2025-10-28 13:07')).toBe('2025-10-28T13:07:00')
    expect(normalizeJst('2025-10-28T13:07:04')).toBe('2025-10-28T13:07:04')
  })
  it('読めなければ null', () => {
    expect(normalizeJst('')).toBeNull()
    expect(normalizeJst(undefined)).toBeNull()
    expect(normalizeJst('昨日')).toBeNull()
  })
})
