import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelPending, flushAllPending, getPending, remainingSeconds, startPending, subscribePending } from './pending-send';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  flushAllPending();
  vi.useRealTimers();
});

describe('送信の取り消し(10秒の待ち)', () => {
  it('10秒たつと送られる。それまでは送られない', async () => {
    const run = vi.fn(async () => undefined);
    startPending({ chatId: 'c1', text: 'こんにちは', image: null }, run);
    await vi.advanceTimersByTimeAsync(9_900);
    expect(run).not.toHaveBeenCalled();
    expect(getPending('c1')?.text).toBe('こんにちは');
    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledOnce();
    expect(getPending('c1')).toBeNull();
  });

  it('取り消すと送られず、文章が返る', async () => {
    const run = vi.fn(async () => undefined);
    const events: string[] = [];
    const off = subscribePending((e) => events.push(e.kind));
    startPending({ chatId: 'c1', text: '取り消す文章', image: { u: 1 } }, run);
    const back = cancelPending('c1');
    expect(back).toMatchObject({ text: '取り消す文章', image: { u: 1 } });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).not.toHaveBeenCalled();
    expect(events).toEqual(['queued', 'cancelled']);
    expect(cancelPending('c1')).toBeNull();
    off();
  });

  it('同じトークで続けて送ると、前の分をすぐ送って、新しく10秒待つ', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    startPending({ chatId: 'c1', text: '1通目', image: null }, first);
    startPending({ chatId: 'c1', text: '2通目', image: null }, second);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(getPending('c1')?.text).toBe('2通目');
  });

  it('別のトークの待ちは、互いに影響しない。裏に回ったとき(全部送る)は、すべて送る', () => {
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    startPending({ chatId: 'a', text: 'A', image: null }, a);
    startPending({ chatId: 'b', text: 'B', image: null }, b);
    cancelPending('a');
    flushAllPending();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('残り秒数は切り上げ。0にはしない', () => {
    expect(remainingSeconds(10_000, 0)).toBe(10);
    expect(remainingSeconds(10_000, 9_100)).toBe(1);
    expect(remainingSeconds(10_000, 12_000)).toBe(1);
  });
});
