import { describe, expect, it } from 'vitest';
import { buildDateOptions, buildTimeOptions, defaultSchedule, formatScheduled, isFutureEnough, jstParts, toScheduledAt } from './schedule';

// 2026-10-15 22:30 UTC = 日本時間 2026-10-16(金) 07:30
const NOW = new Date('2026-10-15T22:30:00.000Z');

describe('日本時間で日時を扱う(端末の設定に関係なく)', () => {
  it('UTC の夜は、日本時間では翌日の朝', () => {
    expect(jstParts(NOW)).toMatchObject({ y: 2026, m: 10, d: 16, hh: 7, mm: 30, dow: 5 });
  });
  it('日付の選択肢: 日本時間の今日から。今日・明日の印、曜日、月またぎ・年またぎ', () => {
    const opts = buildDateOptions(NOW, 100);
    expect(opts[0]).toEqual({ id: '2026-10-16', label: '10月16日(金)(今日)' });
    expect(opts[1]).toEqual({ id: '2026-10-17', label: '10月17日(土)(明日)' });
    expect(opts[2].label).toBe('10月18日(日)');
    expect(opts.find((o) => o.id === '2026-11-01')?.label).toBe('11月1日(日)');
    expect(opts.find((o) => o.id === '2027-01-01')?.label).toBe('1月1日(金)');
    expect(opts).toHaveLength(100);
  });
  it('時刻の選択肢: 6:00 から始まり、10分きざみで24時間ぶん(夜中は最後)', () => {
    const t = buildTimeOptions(10);
    expect(t).toHaveLength(144);
    expect(t[0].id).toBe('06:00');
    expect(t.find((x) => x.id === '09:00')).toBeTruthy();
    expect(t[t.length - 1].id).toBe('05:50');
    expect(new Set(t.map((x) => x.id)).size).toBe(144);
  });
  it('サーバーに送る形は、日本時間の +09:00 つき(Web版と同じ)', () => {
    expect(toScheduledAt('2026-10-16', '09:30')).toBe('2026-10-16T09:30:00.000+09:00');
    expect(new Date(toScheduledAt('2026-10-16', '09:30')).toISOString()).toBe('2026-10-16T00:30:00.000Z');
  });
  it('直前すぎる予約(3分以内)・過去は受け付けない', () => {
    expect(isFutureEnough('2026-10-16T07:32:00.000+09:00', NOW)).toBe(false);
    expect(isFutureEnough('2026-10-16T07:34:00.000+09:00', NOW)).toBe(true);
    expect(isFutureEnough('2026-10-15T09:00:00.000+09:00', NOW)).toBe(false);
    expect(isFutureEnough('なにか', NOW)).toBe(false);
  });
  it('表示は「10月16日(金) 09:30」。読めなければ空', () => {
    expect(formatScheduled('2026-10-16T09:30:00.000+09:00')).toBe('10月16日(金) 09:30');
    // 別の表記(UTC)で保存されていても、日本時間で表示する
    expect(formatScheduled('2026-10-16T00:30:00.000Z')).toBe('10月16日(金) 09:30');
    expect(formatScheduled(null)).toBe('');
    expect(formatScheduled('x')).toBe('');
  });
  it('初期の選択は、あしたの朝9時', () => {
    expect(defaultSchedule(NOW)).toEqual({ dateId: '2026-10-17', timeId: '09:00' });
  });
});
