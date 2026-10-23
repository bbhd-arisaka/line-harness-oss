import { describe, expect, it } from 'vitest';
import { parseDrafts, restoreText, withDraft } from './chat-draft';

describe('下書き', () => {
  it('壊れた保存データ・空の文章は、空として読む', () => {
    expect(parseDrafts(null)).toEqual({});
    expect(parseDrafts('{bad')).toEqual({});
    expect(parseDrafts('[1,2]')).toEqual({});
    expect(parseDrafts('{"a":"こんにちは","b":"  ","c":1}')).toEqual({ a: 'こんにちは' });
  });
  it('文章が空になったら、そのトークの下書きを消す(ほかは残す)', () => {
    expect(withDraft({ a: 'x', b: 'y' }, 'a', '')).toEqual({ b: 'y' });
    expect(withDraft({ a: 'x' }, 'b', '続き')).toEqual({ a: 'x', b: '続き' });
  });
  it('取り消した文章は入力欄の前に戻す', () => {
    expect(restoreText('取り消した', '')).toBe('取り消した');
    expect(restoreText('取り消した', '新しく打った')).toBe('取り消した\n新しく打った');
  });
});
