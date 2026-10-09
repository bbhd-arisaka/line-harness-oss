import { describe, expect, test } from 'vitest';
import { icalBusyIntervals } from './ical-busy.js';

const wrap = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.map((e) => `BEGIN:VEVENT\r\n${e}\r\nEND:VEVENT`).join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const day = (d: string) => new Date(`${d}T00:00:00+09:00`).getTime();
const jst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16);

describe('iCalから、予定のある時間帯を取り出す', () => {
  test('時刻つきの予定(UTC・日本時間のTZID・時刻の指定なし)と、終日の予定', () => {
    const ics = wrap(
      'DTSTART:20261013T010000Z\r\nDTEND:20261013T020000Z\r\nSUMMARY:a', // 日本時間 10:00-11:00
      'DTSTART;TZID=Asia/Tokyo:20261013T130000\r\nDTEND;TZID=Asia/Tokyo:20261013T140000\r\nSUMMARY:b',
      'DTSTART;VALUE=DATE:20261014\r\nDTEND;VALUE=DATE:20261015\r\nSUMMARY:c',
      'DTSTART;TZID=America/New_York:20261013T000000\r\nDTEND;TZID=America/New_York:20261013T010000\r\nSUMMARY:d', // 夏時間: UTC-4 = 日本時間 13:00-14:00 と重なる
    );
    const r = icalBusyIntervals(ics, day('2026-10-13'), day('2026-10-15'));
    expect(r.map((x) => [jst(x.start), jst(x.end)])).toEqual([
      ['2026-10-13T10:00', '2026-10-13T11:00'],
      ['2026-10-13T13:00', '2026-10-13T14:00'],
      ['2026-10-14T00:00', '2026-10-15T00:00'],
    ]);
  });

  test('キャンセル済み・「予定なし」扱い・期間の外の予定は含めない', () => {
    const ics = wrap(
      'DTSTART:20261013T010000Z\r\nDTEND:20261013T020000Z\r\nSTATUS:CANCELLED',
      'DTSTART:20261013T030000Z\r\nDTEND:20261013T040000Z\r\nTRANSP:TRANSPARENT',
      'DTSTART:20261101T010000Z\r\nDTEND:20261101T020000Z',
    );
    expect(icalBusyIntervals(ics, day('2026-10-13'), day('2026-10-14'))).toEqual([]);
  });

  test('毎週・毎日・曜日指定・回数・終了日・除外日の繰り返し', () => {
    const weekly = wrap('DTSTART;TZID=Asia/Tokyo:20261005T100000\r\nDTEND;TZID=Asia/Tokyo:20261005T110000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;TZID=Asia/Tokyo:20261012T100000');
    // 10/5(月) 10/12(月・除外) 10/19(月)
    expect(icalBusyIntervals(weekly, day('2026-10-01'), day('2026-11-30')).map((x) => jst(x.start))).toEqual(['2026-10-05T10:00', '2026-10-19T10:00']);

    const byday = wrap('DTSTART;TZID=Asia/Tokyo:20261005T150000\r\nDTEND;TZID=Asia/Tokyo:20261005T160000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261014T000000Z');
    expect(icalBusyIntervals(byday, day('2026-10-01'), day('2026-11-30')).map((x) => jst(x.start))).toEqual(['2026-10-05T15:00', '2026-10-07T15:00', '2026-10-12T15:00']);

    const daily = wrap('DTSTART;TZID=Asia/Tokyo:20261010T090000\r\nDTEND;TZID=Asia/Tokyo:20261010T093000\r\nRRULE:FREQ=DAILY;INTERVAL=2');
    expect(icalBusyIntervals(daily, day('2026-10-10'), day('2026-10-16')).map((x) => jst(x.start))).toEqual(['2026-10-10T09:00', '2026-10-12T09:00', '2026-10-14T09:00']);

    const monthly = wrap('DTSTART;TZID=Asia/Tokyo:20261031T090000\r\nDTEND;TZID=Asia/Tokyo:20261031T100000\r\nRRULE:FREQ=MONTHLY');
    // 11月は31日が無いので飛ばす
    expect(icalBusyIntervals(monthly, day('2026-10-01'), day('2027-01-05')).map((x) => jst(x.start))).toEqual(['2026-10-31T09:00', '2026-12-31T09:00']);
  });

  test('折り返された行・重なる予定のまとめ', () => {
    const ics = wrap('DTSTART:20261013T010000Z\r\nDTEND:20261013T0\r\n 20000Z\r\nSUMMARY:x', 'DTSTART:20261013T013000Z\r\nDTEND:20261013T030000Z');
    const r = icalBusyIntervals(ics, day('2026-10-13'), day('2026-10-14'));
    expect(r).toHaveLength(1);
    expect([jst(r[0].start), jst(r[0].end)]).toEqual(['2026-10-13T10:00', '2026-10-13T12:00']);
  });
});
