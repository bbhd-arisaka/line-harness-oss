import { describe, expect, it, vi } from 'vitest'
import { chatEventsUrl, createCoalescer, isEventForAccount, parseChatEvent, reconnectDelayMs } from './chat-events-client'

describe('chatEventsUrl', () => {
  it('https は wss、http は ws。末尾のスラッシュは除く', () => {
    expect(chatEventsUrl('https://api.example.com')).toBe('wss://api.example.com/api/chat-events')
    expect(chatEventsUrl('http://localhost:8787/')).toBe('ws://localhost:8787/api/chat-events')
  })
})

describe('parseChatEvent', () => {
  it('合図を読む。形が違うもの・知らない種類は捨てる', () => {
    expect(parseChatEvent(JSON.stringify({ kind: 'message', friendId: 'f1', accountId: 'A', at: 't' }))).toEqual({ kind: 'message', friendId: 'f1', accountId: 'A', at: 't' })
    expect(parseChatEvent(JSON.stringify({ kind: 'sent', friendId: 'f1', accountId: null }))?.accountId).toBeNull()
    expect(parseChatEvent('pong')).toBeNull()
    expect(parseChatEvent('{"kind":"other","friendId":"f"}')).toBeNull()
    expect(parseChatEvent('{"kind":"message"}')).toBeNull()
    expect(parseChatEvent(123)).toBeNull()
  })
})

describe('reconnectDelayMs', () => {
  it('1秒から倍々で、最大30秒', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })
})

describe('isEventForAccount', () => {
  it('公式アカウントを選んでいるときは、そのアカウントの合図だけ', () => {
    expect(isEventForAccount('A', 'A')).toBe(true)
    expect(isEventForAccount('A', 'B')).toBe(false)
    expect(isEventForAccount(null, 'B')).toBe(true)
    expect(isEventForAccount('A', null)).toBe(true)
  })
})

describe('createCoalescer', () => {
  it('同じキーの合図は、待ち時間のあいだ1回にまとめる。別のキーは別々', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const c = createCoalescer(500, run)
    c.push('f1'); c.push('f1'); c.push('f2')
    vi.advanceTimersByTime(499)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run.mock.calls.map((x) => x[0]).sort()).toEqual(['f1', 'f2'])
    c.push('f1')
    c.clear()
    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
