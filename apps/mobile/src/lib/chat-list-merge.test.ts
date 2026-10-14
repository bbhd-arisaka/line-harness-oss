import { describe, expect, it } from 'vitest';
import { mergeFreshPage } from './chat-list-merge';

const row = (id: string, at: string | null) => ({ id, lastMessageAt: at });

describe('mergeFreshPage(一覧の裏の更新)', () => {
  it('取り直した1ページ分が、新着で並びが変わっても反映される。古い分は残る', () => {
    const prev = [row('a', '2026-10-14T10:00'), row('b', '2026-10-14T09:00'), row('c', '2026-10-14T08:00'), row('d', '2026-10-14T07:00')];
    const fresh = [row('c', '2026-10-14T11:00'), row('a', '2026-10-14T10:00')];
    expect(mergeFreshPage(prev, fresh, 2).map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('「続きを読み込む」で出した古い行は、取り直しても消えない', () => {
    const prev = [row('a', '2026-10-14T10:00'), row('b', '2026-10-14T09:00'), row('c', '2026-10-14T08:00'), row('d', '2026-10-14T07:00')];
    const fresh = [row('a', '2026-10-14T10:30'), row('b', '2026-10-14T09:00')];
    expect(mergeFreshPage(prev, fresh, 2).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('1ページに満たないときは、取り直した結果がそのまま全件(消えた行は消える)', () => {
    const prev = [row('a', '2026-10-14T10:00'), row('b', '2026-10-14T09:00')];
    expect(mergeFreshPage(prev, [row('a', '2026-10-14T10:00')], 5).map((r) => r.id)).toEqual(['a']);
  });
  it('新着の行が先頭に増えても、重複しない', () => {
    const prev = [row('a', '2026-10-14T10:00'), row('b', '2026-10-14T09:00')];
    const fresh = [row('n', '2026-10-14T12:00'), row('a', '2026-10-14T10:00')];
    expect(mergeFreshPage(prev, fresh, 2).map((r) => r.id)).toEqual(['n', 'a', 'b']);
  });
});
