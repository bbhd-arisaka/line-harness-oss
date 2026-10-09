import { describe, expect, it } from 'vitest';
import { CONTENT_MAX_WIDTH, contentMaxWidth } from './layout';

describe('contentMaxWidth', () => {
  it('iPhone は画面いっぱい、iPad は読みやすい幅に制限する', () => {
    expect(contentMaxWidth(390)).toBeNull();
    expect(contentMaxWidth(430)).toBeNull();
    expect(contentMaxWidth(699)).toBeNull();
    expect(contentMaxWidth(744)).toBe(CONTENT_MAX_WIDTH); // iPad mini 縦
    expect(contentMaxWidth(1024)).toBe(CONTENT_MAX_WIDTH);
  });
});
