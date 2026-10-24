import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginSelection, endActiveSelection, endSelectionOf, setSelectionTag } from './text-selection';

beforeEach(() => {
  endActiveSelection(undefined, Number.MAX_SAFE_INTEGER);
});

describe('範囲選択をやめる(ほかをタップしたとき)', () => {
  it('ほかの場所をタップしたら、選択を終わらせる', () => {
    const end = vi.fn();
    beginSelection(end, 10, 1_000);
    expect(endActiveSelection(99, 2_000)).toBe(true);
    expect(end).toHaveBeenCalledOnce();
    expect(endActiveSelection(99, 3_000)).toBe(false);
  });

  it('選んでいる入力欄そのもの(ハンドルの操作)では、終わらせない', () => {
    const end = vi.fn();
    beginSelection(end, 10, 1_000);
    expect(endActiveSelection(10, 5_000)).toBe(false);
    expect(end).not.toHaveBeenCalled();
  });

  it('選び始めて0.4秒以内(長押しの指の離れ際)は、終わらせない', () => {
    const end = vi.fn();
    beginSelection(end, 10, 1_000);
    expect(endActiveSelection(99, 1_200)).toBe(false);
    expect(endActiveSelection(99, 1_500)).toBe(true);
  });

  it('別のメッセージを選び始めたら、前の選択は終わる', () => {
    const first = vi.fn();
    const second = vi.fn();
    beginSelection(first, 1, 1_000);
    beginSelection(second, 2, 2_000);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('自分で終わったあとは、置き場が空になる。入力欄の番号は、あとから決められる', () => {
    const end = vi.fn();
    beginSelection(end, null, 1_000);
    setSelectionTag(end, 7);
    expect(endActiveSelection(7, 5_000)).toBe(false);
    endSelectionOf(end);
    expect(endActiveSelection(99, 9_000)).toBe(false);
    expect(end).not.toHaveBeenCalled();
  });
});
