import { describe, expect, it } from 'vitest';
import { CONTENT_MAX_WIDTH, LIST_PANE_WIDTH, SPLIT_MIN, contentMaxWidth, isSplitLayout } from './layout';

describe('contentMaxWidth', () => {
  it('iPhone は画面いっぱい、iPad は読みやすい幅に制限する', () => {
    expect(contentMaxWidth(390)).toBeNull();
    expect(contentMaxWidth(430)).toBeNull();
    expect(contentMaxWidth(699)).toBeNull();
    expect(contentMaxWidth(744)).toBe(CONTENT_MAX_WIDTH); // iPad mini 縦
    expect(contentMaxWidth(1024)).toBe(CONTENT_MAX_WIDTH);
  });
});

describe('isSplitLayout', () => {
  it('iPad の横(900 以上)だけトークを2列にする', () => {
    expect(isSplitLayout(390)).toBe(false); // iPhone
    expect(isSplitLayout(744)).toBe(false); // iPad mini 縦
    expect(isSplitLayout(834)).toBe(false); // iPad 11インチ 縦
    expect(isSplitLayout(899)).toBe(false);
    expect(isSplitLayout(1032)).toBe(true); // iPad 13インチ 縦
    expect(isSplitLayout(1194)).toBe(true); // iPad 11インチ 横
    expect(isSplitLayout(1366)).toBe(true); // iPad 13インチ 横
  });
  it('2列にする幅では、他の画面の中身の幅制限も効く', () => {
    expect(SPLIT_MIN).toBeGreaterThanOrEqual(CONTENT_MAX_WIDTH + 40);
    expect(LIST_PANE_WIDTH).toBeLessThan(SPLIT_MIN / 2);
  });
});
