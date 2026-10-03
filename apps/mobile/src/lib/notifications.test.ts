import { describe, expect, it } from 'vitest';
import { normalizeApnsToken, parseNotificationTarget, planNavigation, planPermission } from './notifications';

const HEX = 'a'.repeat(64);

describe('normalizeApnsToken', () => {
  it('16進文字列だけ通す', () => {
    expect(normalizeApnsToken(HEX)).toBe(HEX);
    expect(normalizeApnsToken(`  ${HEX}\n`)).toBe(HEX);
  });
  it('それ以外は null(FCM トークン・短すぎ・文字列以外)', () => {
    expect(normalizeApnsToken('fcm:abc_def-ghi')).toBeNull();
    expect(normalizeApnsToken('abcd')).toBeNull();
    expect(normalizeApnsToken(`${HEX}zz`)).toBeNull();
    expect(normalizeApnsToken(null)).toBeNull();
    expect(normalizeApnsToken(12345)).toBeNull();
    expect(normalizeApnsToken({ token: HEX })).toBeNull();
  });
});

describe('planPermission', () => {
  it('許可済みなら登録', () => {
    expect(planPermission({ status: 'granted', explained: false })).toBe('register');
    expect(planPermission({ status: 'granted', explained: true })).toBe('register');
  });
  it('未確認で説明がまだなら、説明してから許可を求める', () => {
    expect(planPermission({ status: 'undetermined', explained: false })).toBe('explain');
  });
  it('説明済みで未許可・拒否済みなら何もしない(初回のみ)', () => {
    expect(planPermission({ status: 'undetermined', explained: true })).toBe('skip');
    expect(planPermission({ status: 'denied', explained: false })).toBe('skip');
  });
});

describe('parseNotificationTarget', () => {
  it('chatId と accountId を取り出す', () => {
    expect(parseNotificationTarget({ chatId: 'f1', accountId: 'a1' })).toEqual({ chatId: 'f1', accountId: 'a1' });
    expect(parseNotificationTarget({ chatId: ' f1 ' })).toEqual({ chatId: 'f1', accountId: null });
  });
  it('サーバーが付ける friendId があれば、そちらで開く(chatId が null でも開ける)', () => {
    expect(parseNotificationTarget({ chatId: 'c1', friendId: 'f1', accountId: 'a1' })).toEqual({ chatId: 'f1', accountId: 'a1' });
    expect(parseNotificationTarget({ chatId: null, friendId: 'f1', accountId: 'a1' })).toEqual({ chatId: 'f1', accountId: 'a1' });
  });
  it('chatId が無い・おかしいなら null', () => {
    expect(parseNotificationTarget(undefined)).toBeNull();
    expect(parseNotificationTarget(null)).toBeNull();
    expect(parseNotificationTarget('x')).toBeNull();
    expect(parseNotificationTarget({})).toBeNull();
    expect(parseNotificationTarget({ chatId: '' })).toBeNull();
    expect(parseNotificationTarget({ chatId: 123 })).toBeNull();
    expect(parseNotificationTarget({ chatId: 'f1', accountId: 5 })).toEqual({ chatId: 'f1', accountId: null });
  });
});

describe('planNavigation', () => {
  it('同じアカウント・アカウント指定なしなら、そのまま開く', () => {
    expect(planNavigation({ chatId: 'f1', accountId: 'a1' }, 'a1', ['a1', 'a2'])).toEqual({ kind: 'open', chatId: 'f1', switchAccountId: null });
    expect(planNavigation({ chatId: 'f1', accountId: null }, 'a1', ['a1'])).toEqual({ kind: 'open', chatId: 'f1', switchAccountId: null });
  });
  it('別のアカウントなら切り替えてから開く', () => {
    expect(planNavigation({ chatId: 'f1', accountId: 'a2' }, 'a1', ['a1', 'a2'])).toEqual({ kind: 'open', chatId: 'f1', switchAccountId: 'a2' });
  });
  it('見られないアカウントは開かない', () => {
    expect(planNavigation({ chatId: 'f1', accountId: 'zz' }, 'a1', ['a1', 'a2'])).toEqual({ kind: 'ignore', reason: 'account-not-allowed' });
  });
  it('開き先なしは何もしない', () => {
    expect(planNavigation(null, 'a1', ['a1'])).toEqual({ kind: 'ignore', reason: 'no-target' });
  });
});
