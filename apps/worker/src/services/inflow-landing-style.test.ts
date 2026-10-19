import { describe, expect, it } from 'vitest';
import { LANDING_DEFAULTS, parseLandingStyle, parseLandingStyleInput, resolveLanding } from './inflow-landing-style.js';

const ok = (v: unknown) => {
  const r = parseLandingStyleInput(v);
  if (!r.ok) throw new Error(r.error);
  return r.json;
};
const err = (v: unknown) => {
  const r = parseLandingStyleInput(v);
  return r.ok ? null : r.error;
};

describe('友だち追加ページの文言・配色', () => {
  it('何も設定しなければ null(既定のまま)。空の文字・空の色も、既定扱い', () => {
    expect(ok(undefined)).toBeNull();
    expect(ok({})).toBeNull();
    expect(ok({ title: '  ', colors: { button: '' } })).toBeNull();
    expect(ok({ showHint: true, showHelp: true })).toBeNull();
  });
  it('設定した項目だけ保存する。色は小文字にそろえる', () => {
    expect(JSON.parse(ok({ title: ' ご予約はこちら ', colors: { button: '#FF6600' } })!)).toEqual({ title: 'ご予約はこちら', colors: { button: '#ff6600' } });
    expect(JSON.parse(ok({ showHint: false })!)).toEqual({ showHint: false });
  });
  it('長さ・色の形の検査', () => {
    expect(err({ title: 'あ'.repeat(61) })).toContain('60文字');
    expect(err({ buttonText: 'あ'.repeat(31) })).toContain('30文字');
    expect(err({ hintText: 'あ'.repeat(121) })).toContain('120文字');
    expect(err({ colors: { button: 'red' } })).toContain('#06c755');
    expect(err({ colors: { pageBg: '#fff' } })).toContain('背景色');
    expect(err({ title: 5 })).toContain('文字');
    expect(err([])).toBeTruthy();
  });
  it('既定と合わせる: 設定が無ければ既定の文言・色。ボタンの色から影の色を作る。注意書きは非表示にもできる', () => {
    const d = resolveLanding(null);
    expect(d.title).toBe(LANDING_DEFAULTS.title);
    expect(d.buttonText).toBe('LINEで開く');
    expect(d.colors).toMatchObject({ pageBg: '#eef5f0', cardBg: '#ffffff', button: '#06c755', buttonBg: '#06c755', veil: null });
    expect([d.cardRadius, d.buttonRadius, d.blur, d.showIcon, d.bgImageUrl, d.subtitle]).toEqual([24, 14, 0, true, null, null]);
    expect(d.hintText).toBeNull();
    const c = resolveLanding({ title: 'T', colors: { button: '#ff0000', text: '#000000' }, showHint: false, showHelp: false });
    expect(c.title).toBe('T');
    expect(c.colors.shadow).toBe('rgba(255,0,0,0.28)');
    expect(c.colors.muted).toBe('rgba(0,0,0,0.62)');
    expect([c.showHint, c.showHelp]).toEqual([false, false]);
  });
  it('背景画像・透過・ぼかし・角丸: 範囲の検査と、既定と同じ値は保存しない', () => {
    const v = JSON.parse(ok({ bgImageUrl: 'https://example.com/bg.jpg', bgOverlayOpacity: 30, cardOpacity: 70, buttonOpacity: 90, cardBlur: 12, cardRadius: 32, buttonRadius: 14, colors: { overlay: '#112233' } })!);
    expect(v).toEqual({ bgImageUrl: 'https://example.com/bg.jpg', bgOverlayOpacity: 30, cardOpacity: 70, buttonOpacity: 90, cardBlur: 12, cardRadius: 32, colors: { overlay: '#112233' } });
    expect(ok({ cardOpacity: 100, buttonRadius: 14, cardRadius: 24 })).toBeNull();
    expect(err({ cardOpacity: 10 })).toContain('20〜100');
    expect(err({ cardBlur: 30 })).toContain('0〜24');
    expect(err({ cardRadius: 1.5 })).toContain('整数');
    expect(err({ bgOverlayOpacity: 90 })).toContain('0〜80');
    expect(err({ bgImageUrl: 'http://example.com/a.jpg' })).toContain('https');
    expect(err({ bgImageUrl: 'https://example.com/a".jpg' })).toContain('https');
    expect(err({ iconUrl: 'javascript:alert(1)' })).toContain('https');
    expect(JSON.parse(ok({ subtitle: ' 初回限定 ', pcTitle: 'QRを読み取って', showIcon: false })!)).toEqual({ subtitle: '初回限定', pcTitle: 'QRを読み取って', showIcon: false });
  });
  it('透過・背景画像を合わせる: カード・ボタンは rgba、画像があって濃さが0より大きいときだけ、かぶせる色が付く', () => {
    const r = resolveLanding({ bgImageUrl: 'https://example.com/bg.jpg', bgOverlayOpacity: 40, cardOpacity: 60, buttonOpacity: 80, cardBlur: 10, colors: { overlay: '#000000', cardBg: '#ffffff', button: '#ff0000' } });
    expect(r.colors.cardBg).toBe('rgba(255,255,255,0.6)');
    expect(r.colors.buttonBg).toBe('rgba(255,0,0,0.8)');
    expect(r.colors.veil).toBe('rgba(0,0,0,0.4)');
    expect(r.bgImageUrl).toBe('https://example.com/bg.jpg');
    expect(r.blur).toBe(10);
    expect(resolveLanding({ bgOverlayOpacity: 40 }).colors.veil).toBeNull(); // 画像が無ければ、かぶせない
    expect(resolveLanding({ cardOpacity: 5, cardBlur: 99 })).toMatchObject({ blur: 24 }); // 範囲の外は、範囲に収める
  });
  it('壊れた保存値は、既定のまま', () => {
    expect(parseLandingStyle('not json')).toEqual({});
    expect(parseLandingStyle('[1]')).toEqual({});
    expect(parseLandingStyle(null)).toEqual({});
  });
});
