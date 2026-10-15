import { describe, expect, it } from 'vitest';
import { FORCE_RELOAD_EVERY, formatUnreadBadge, shouldReloadUnread } from './unread-badge';

describe('formatUnreadBadge(下バーの数字)', () => {
  it('0件・未取得は出さない', () => {
    expect(formatUnreadBadge(0)).toBeUndefined();
    expect(formatUnreadBadge(null)).toBeUndefined();
    expect(formatUnreadBadge(undefined)).toBeUndefined();
    expect(formatUnreadBadge(-1)).toBeUndefined();
  });
  it('1〜99はそのまま、100以上は99+', () => {
    expect(formatUnreadBadge(1)).toBe('1');
    expect(formatUnreadBadge(99)).toBe('99');
    expect(formatUnreadBadge(100)).toBe('99+');
    expect(formatUnreadBadge(2500)).toBe('99+');
  });
});

describe('shouldReloadUnread(取り直すか)', () => {
  it('最初と、新着の時刻が変わったときは取る', () => {
    expect(shouldReloadUnread(null, '2026-10-15T10:00', 1)).toBe(true);
    expect(shouldReloadUnread('2026-10-15T10:00', '2026-10-15T10:01', 1)).toBe(true);
  });
  it('変化が無ければ取らないが、一定回数ごとには数え直す', () => {
    expect(shouldReloadUnread('a', 'a', 1)).toBe(false);
    expect(shouldReloadUnread('a', 'a', FORCE_RELOAD_EVERY - 1)).toBe(false);
    expect(shouldReloadUnread('a', 'a', FORCE_RELOAD_EVERY)).toBe(true);
    expect(shouldReloadUnread('a', 'a', FORCE_RELOAD_EVERY * 2)).toBe(true);
  });
});
