import { describe, expect, it } from 'vitest';
import { checkPeriod, distanceMeters, generateRefCode, parseInflowRouteInput, periodMs, refCodeFromSearch } from './inflow-route-input.js';

const ok = (body: Record<string, unknown>, isCreate = true) => {
  const r = parseInflowRouteInput(body, { isCreate });
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (body: Record<string, unknown>) => {
  const r = parseInflowRouteInput(body, { isCreate: true });
  return r.ok ? null : r.error;
};

describe('流入経路の入力の検査', () => {
  it('流入経路名は必須・255文字まで', () => {
    expect(err({})).toBe('流入経路名を入力してください');
    expect(err({ name: '   ' })).toBe('流入経路名を入力してください');
    expect(err({ name: 'あ'.repeat(256) })).toContain('255文字');
    expect(ok({ name: 'あ'.repeat(255) }).name).toHaveLength(255);
  });
  it('QRコード表示用テキストは10文字まで', () => {
    expect(ok({ name: 'a', qrText: 'あいうえおかきくけこ' }).qrText).toBe('あいうえおかきくけこ');
    expect(err({ name: 'a', qrText: 'あいうえおかきくけこさ' })).toContain('10文字');
    expect(ok({ name: 'a', qrText: '  ' }).qrText).toBeNull();
  });
  it('有効期間: 日付と時刻の両方・開始だけ/終了だけは可・同じ日時と、終了が開始より前は不可', () => {
    expect(ok({ name: 'a', validFrom: '2026-10-20T09:00' }).validFrom).toBe('2026-10-20T09:00');
    expect(ok({ name: 'a', validTo: '2026-10-30T18:00' }).validTo).toBe('2026-10-30T18:00');
    expect(err({ name: 'a', validFrom: '2026-10-20' })).toContain('日付と時刻の両方');
    expect(err({ name: 'a', validFrom: '09:00' })).toContain('日付と時刻の両方');
    expect(err({ name: 'a', validFrom: '2026-02-30T09:00' })).toContain('日付と時刻の両方');
    expect(err({ name: 'a', validFrom: '2026-10-20T09:00', validTo: '2026-10-20T09:00' })).toContain('同じ日時');
    expect(err({ name: 'a', validFrom: '2026-10-20T09:00', validTo: '2026-10-19T09:00' })).toContain('開始より後');
    expect(ok({ name: 'a', validFrom: '2026-10-20T09:00', validTo: '2026-10-21T09:00' }).validTo).toBe('2026-10-21T09:00');
  });
  it('アクション: 友だち追加時設定と同じ形で検査する。未設定なら「無視する」は入らない(自動で「無視しない」)', () => {
    const none = ok({ name: 'a', ignoreFriendAddSettings: true });
    expect(none.ignoreFriendAddSettings).toBe(false);
    expect(none.actions).toBe('[]');
    const withScenario = ok({ name: 'a', scenarioId: 's1', ignoreFriendAddSettings: true });
    expect(withScenario.ignoreFriendAddSettings).toBe(true);
    const withTag = ok({ name: 'a', actions: [{ type: 'tag', params: { op: 'add', tagIds: ['t1'] }, condition: null }], ignoreFriendAddSettings: true });
    expect(withTag.ignoreFriendAddSettings).toBe(true);
    expect(JSON.parse(withTag.actions)).toHaveLength(1);
    expect(err({ name: 'a', actions: [{ type: 'unknown', params: {} }] })).toBeTruthy();
    expect(err({ name: 'a', actions: 'x' })).toBeTruthy();
  });
  it('アクションの実行(いつでも/初回のみ)と、広告連携のタイミングの既定', () => {
    expect(ok({ name: 'a' }).actionMode).toBe('first');
    expect(ok({ name: 'a', actionMode: 'always' }).actionMode).toBe('always');
    expect(err({ name: 'a', actionMode: 'weekly' })).toContain('いつでも');
    expect(ok({ name: 'a' }).adImportMode).toBe('always');
    expect(ok({ name: 'a', adImportMode: 'first' }).adImportMode).toBe('first');
  });
  it('広告パラメータ: 名前と友だち情報の両方・重複なし・空の行は捨てる', () => {
    const v = ok({ name: 'a', adParamMap: [{ param: 'utm_source', fieldKey: 'src' }, { param: '', fieldKey: '' }] });
    expect(JSON.parse(v.adParamMap!)).toEqual([{ param: 'utm_source', fieldKey: 'src' }]);
    expect(ok({ name: 'a', adParamMap: [] }).adParamMap).toBeNull();
    expect(err({ name: 'a', adParamMap: [{ param: 'x', fieldKey: '' }] })).toContain('両方');
    expect(err({ name: 'a', adParamMap: [{ param: 'a b', fieldKey: 'k' }] })).toContain('英数字');
    expect(err({ name: 'a', adParamMap: [{ param: 'x', fieldKey: 'k' }, { param: 'x', fieldKey: 'j' }] })).toContain('重複');
  });
  it('位置情報: 3つそろったときだけ・範囲の検査', () => {
    expect(ok({ name: 'a' }).geoLat).toBeNull();
    const g = ok({ name: 'a', geoLat: 35.68, geoLng: 139.76, geoRadius: 200 });
    expect([g.geoLat, g.geoLng, g.geoRadius]).toEqual([35.68, 139.76, 200]);
    expect(err({ name: 'a', geoLat: 35.68 })).toContain('すべて入力');
    expect(err({ name: 'a', geoLat: 95, geoLng: 139, geoRadius: 100 })).toContain('緯度');
    expect(err({ name: 'a', geoLat: 35, geoLng: 200, geoRadius: 100 })).toContain('経度');
    expect(err({ name: 'a', geoLat: 35, geoLng: 139, geoRadius: 4 })).toContain('5m〜1000m');
    expect(err({ name: 'a', geoLat: 35, geoLng: 139, geoRadius: 1001 })).toContain('5m〜1000m');
  });
  it('HTMLタグ・期間外メッセージの長さ', () => {
    expect(err({ name: 'a', htmlHead: 'x'.repeat(20001) })).toContain('文字まで');
    expect(err({ name: 'a', outOfPeriodMessage: 'x'.repeat(501) })).toContain('500文字');
  });
});

describe('有効期間・位置・ref コード', () => {
  const route = { valid_from: '2026-10-20T09:00', valid_to: '2026-10-21T09:00' };
  it('期間の前・中・後(終了の時刻ちょうどは、すぎた扱い)', () => {
    expect(checkPeriod(route, periodMs('2026-10-20T08:59'))).toEqual({ ok: false, reason: 'before' });
    expect(checkPeriod(route, periodMs('2026-10-20T09:00'))).toEqual({ ok: true });
    expect(checkPeriod(route, periodMs('2026-10-21T08:59'))).toEqual({ ok: true });
    expect(checkPeriod(route, periodMs('2026-10-21T09:00'))).toEqual({ ok: false, reason: 'after' });
    expect(checkPeriod({ valid_from: null, valid_to: null }, Date.now())).toEqual({ ok: true });
    expect(checkPeriod({ valid_from: '2026-10-20T09:00', valid_to: null }, periodMs('2027-01-01T00:00'))).toEqual({ ok: true });
  });
  it('2点間の距離(m)', () => {
    expect(distanceMeters(35.6812, 139.7671, 35.6812, 139.7671)).toBe(0);
    // 東京駅〜新宿駅は約6.1km
    const d = distanceMeters(35.6812, 139.7671, 35.6896, 139.7006);
    expect(d).toBeGreaterThan(5800);
    expect(d).toBeLessThan(6500);
    // 緯度が0.001度ちがうと約111m
    expect(Math.round(distanceMeters(35, 139, 35.001, 139))).toBeGreaterThanOrEqual(110);
  });
  it('ref コードは英数字6文字。紛らわしい文字(0 O 1 l I)を使わない', () => {
    for (let i = 0; i < 200; i++) expect(generateRefCode()).toMatch(/^[A-HJ-NP-Za-km-z2-9]{6}$/);
    expect(generateRefCode(() => new Uint8Array([0, 1, 2, 3, 4, 5]))).toBe('ABCDEF');
  });
  it('検索ボックスにURLが貼られたら、ref コードを取り出す', () => {
    expect(refCodeFromSearch('https://beyond-line.cms-manager.jp/r/AbC123?account=2008163446')).toBe('AbC123');
    expect(refCodeFromSearch('https://liff.line.me/2008-xx/landing?follow=%40abc&lp=YtWOq1&liff_id=2008-xx')).toBe('YtWOq1');
    expect(refCodeFromSearch('HPB経由')).toBeNull();
  });
});
