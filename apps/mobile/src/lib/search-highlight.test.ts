import { describe, expect, it } from 'vitest';
import { snippetAround, splitByQuery } from './search-highlight';

describe('splitByQuery', () => {
  it('検索語の位置を、すべて強調として分ける(大文字小文字は区別しない)', () => {
    expect(splitByQuery('よろしくお願いします。よろしく', 'よろしく')).toEqual([
      { text: 'よろしく', hit: true },
      { text: 'お願いします。', hit: false },
      { text: 'よろしく', hit: true },
    ]);
    expect(splitByQuery('Hello hello', 'HELLO').filter((p) => p.hit)).toHaveLength(2);
  });
  it('検索語が空・見つからないときは、そのまま1つ', () => {
    expect(splitByQuery('こんにちは', '')).toEqual([{ text: 'こんにちは', hit: false }]);
    expect(splitByQuery('こんにちは', 'さようなら')).toEqual([{ text: 'こんにちは', hit: false }]);
  });
});

describe('snippetAround', () => {
  it('検索語が文章の後ろにあるときは、少し手前から切り出して「…」を付ける', () => {
    const text = `${'あ'.repeat(60)}よろしく${'い'.repeat(60)}`;
    const s = snippetAround(text, 'よろしく');
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('よろしく');
  });
  it('短い文章はそのまま。改行は空白にする', () => {
    expect(snippetAround('お世話に\nなっております', 'お世話')).toBe('お世話に なっております');
  });
});
