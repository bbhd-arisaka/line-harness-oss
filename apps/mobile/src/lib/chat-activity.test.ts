import { describe, expect, it, vi } from 'vitest';
import { emitChatActivity, isActivityForChat, subscribeChatActivity } from './chat-activity';

describe('chat-activity(通知が届いたことを画面に知らせる)', () => {
  it('購読中の画面に、どのトークの通知かを渡す。購読をやめたら届かない', () => {
    const a = vi.fn();
    const off = subscribeChatActivity(a);
    emitChatActivity('c1');
    expect(a).toHaveBeenCalledWith({ chatId: 'c1' });
    off();
    emitChatActivity('c2');
    expect(a).toHaveBeenCalledTimes(1);
  });
  it('1つの購読が失敗しても、ほかの購読には届く', () => {
    const bad = vi.fn(() => {
      throw new Error('x');
    });
    const good = vi.fn();
    const offBad = subscribeChatActivity(bad);
    const offGood = subscribeChatActivity(good);
    emitChatActivity(null);
    expect(good).toHaveBeenCalledWith({ chatId: null });
    offBad();
    offGood();
  });
  it('トークが分からない通知は、すべてのトークに関係あるとみなす', () => {
    expect(isActivityForChat({ chatId: null }, 'c1')).toBe(true);
    expect(isActivityForChat({ chatId: 'c1' }, 'c1')).toBe(true);
    expect(isActivityForChat({ chatId: 'c2' }, 'c1')).toBe(false);
  });
});
