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
    expect(d.colors).toMatchObject({ pageBg: '#f5f7f5', button: '#06c755', muted: '#999999' });
    expect(d.hintText).toBeNull();
    const c = resolveLanding({ title: 'T', colors: { button: '#ff0000', text: '#000000' }, showHint: false, showHelp: false });
    expect(c.title).toBe('T');
    expect(c.colors.shadow).toBe('rgba(255,0,0,0.2)');
    expect(c.colors.muted).toBe('rgba(0,0,0,0.62)');
    expect([c.showHint, c.showHelp]).toEqual([false, false]);
  });
  it('壊れた保存値は、既定のまま', () => {
    expect(parseLandingStyle('not json')).toEqual({});
    expect(parseLandingStyle('[1]')).toEqual({});
    expect(parseLandingStyle(null)).toEqual({});
  });
});
