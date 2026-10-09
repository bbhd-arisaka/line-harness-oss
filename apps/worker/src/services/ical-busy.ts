// iCal(.ics)の予定から、「予定のある時間帯」を取り出す。
// Googleカレンダーの「iCal形式の非公開URL」を読むために使う(Googleの認可設定がいらない)。
// 対応: 時刻つき・終日の予定、Z/TZID/時刻の指定なし(日本時間)、繰り返し(DAILY/WEEKLY/MONTHLY/YEARLY・INTERVAL・COUNT・UNTIL・BYDAY[週ごと])、EXDATE、キャンセル・「予定なし」扱いの予定の除外。

export interface BusyInterval {
  start: string; // ISO(UTC)
  end: string;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

const JST_OFFSET_MIN = 9 * 60;

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseProp(line: string): Prop | null {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const left = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...ps] = left.split(';');
  const params: Record<string, string> = {};
  for (const p of ps) {
    const [k, v] = p.split('=');
    if (k && v !== undefined) params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

/** 指定のタイムゾーンの、ある日時(壁時計)が、UTCの何ミリ秒か */
function zonedToMs(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string | undefined): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!tz || tz === 'Asia/Tokyo') return asUtc - JST_OFFSET_MIN * 60_000;
  try {
    // その時刻に、タイムゾーンがUTCから何分ずれているかを求める(2回で、夏時間の境目も合わせる)
    const offsetAt = (ms: number): number => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
      const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms) / 60_000;
    };
    let ms = asUtc - offsetAt(asUtc) * 60_000;
    ms = asUtc - offsetAt(ms) * 60_000;
    return ms;
  } catch {
    return asUtc - JST_OFFSET_MIN * 60_000;
  }
}

/** DTSTART/DTEND/EXDATE の値を、UTCのミリ秒にする。終日(日付のみ)かどうかも返す */
function parseDate(prop: Prop): { ms: number; allDay: boolean } | null {
  const v = prop.value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { ms: zonedToMs(+m[1], +m[2], +m[3], 0, 0, 0, undefined), allDay: true };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  if (m[7] === 'Z') return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), allDay: false };
  return { ms: zonedToMs(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], prop.params.TZID), allDay: false };
}

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  untilMs: number | null;
  byDay: number[]; // 0=日
}

const DAY_CODE: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(value: string): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(';')) {
    const [k, v] = part.split('=');
    if (k && v) kv[k.toUpperCase()] = v;
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(kv.FREQ)) return null;
  const until = kv.UNTIL ? parseDate({ name: 'UNTIL', params: {}, value: kv.UNTIL }) : null;
  return {
    freq: kv.FREQ as Rule['freq'],
    interval: Math.max(1, Number(kv.INTERVAL ?? 1) || 1),
    count: kv.COUNT ? Number(kv.COUNT) : null,
    untilMs: until ? (until.allDay ? until.ms + 24 * 3600_000 : until.ms) : null,
    byDay: (kv.BYDAY ?? '').split(',').map((d) => DAY_CODE[d.slice(-2)]).filter((d) => d !== undefined),
  };
}

const DAY_MS = 24 * 3600_000;
const MAX_OCCURRENCES = 3000;

/** 繰り返しの予定の、開始時刻(ミリ秒)を、見る期間の終わりまで並べる */
function occurrences(startMs: number, rule: Rule, toMs: number): number[] {
  const out: number[] = [];
  const jst = (ms: number) => new Date(ms + JST_OFFSET_MIN * 60_000);
  const startJst = jst(startMs);
  const timeOfDay = startMs - Date.UTC(startJst.getUTCFullYear(), startJst.getUTCMonth(), startJst.getUTCDate()) + JST_OFFSET_MIN * 60_000; // 日本時間の0時からの経過
  const push = (ms: number): boolean => {
    if (ms < startMs) return true;
    if (rule.untilMs !== null && ms > rule.untilMs) return false;
    if (ms > toMs) return false;
    out.push(ms);
    return !(rule.count !== null && out.length >= rule.count) && out.length < MAX_OCCURRENCES;
  };
  const dayStart = (y: number, m: number, d: number) => Date.UTC(y, m, d) - JST_OFFSET_MIN * 60_000 + timeOfDay;
  const y0 = startJst.getUTCFullYear();
  const m0 = startJst.getUTCMonth();
  const d0 = startJst.getUTCDate();
  if (rule.freq === 'DAILY') {
    for (let i = 0; i < MAX_OCCURRENCES; i++) if (!push(dayStart(y0, m0, d0 + i * rule.interval))) break;
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length ? rule.byDay : [startJst.getUTCDay()];
    const weekBase = d0 - startJst.getUTCDay();
    outer: for (let w = 0; w < MAX_OCCURRENCES; w++) {
      for (const wd of [...days].sort((a, b) => a - b)) {
        if (!push(dayStart(y0, m0, weekBase + w * 7 * rule.interval + wd))) break outer;
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const ms = dayStart(y0, m0 + i * rule.interval, d0);
      const t = jst(ms);
      if (t.getUTCDate() !== d0) continue; // 31日などが無い月は飛ばす
      if (!push(ms)) break;
    }
  } else {
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const ms = dayStart(y0 + i * rule.interval, m0, d0);
      if (jst(ms).getUTCMonth() !== m0) continue; // うるう日
      if (!push(ms)) break;
    }
  }
  return out;
}

/** .ics の本文から、[fromMs, toMs) にかかる「予定のある時間帯」を取り出す(重なりはまとめる) */
export function icalBusyIntervals(text: string, fromMs: number, toMs: number): BusyInterval[] {
  const lines = unfold(text);
  const raw: Array<[number, number]> = [];
  let ev: Prop[] | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') ev = [];
    else if (line === 'END:VEVENT') {
      if (ev) collect(ev);
      ev = null;
    } else if (ev) {
      const p = parseProp(line);
      if (p) ev.push(p);
    }
  }

  function collect(props: Prop[]): void {
    const get = (n: string) => props.find((p) => p.name === n);
    if (get('STATUS')?.value.toUpperCase() === 'CANCELLED') return;
    if (get('TRANSP')?.value.toUpperCase() === 'TRANSPARENT') return;
    if (get('RECURRENCE-ID')) return; // 繰り返しの中の、1回だけ変えた予定は、元の予定で足りる(厳密ではないが、ブロックが増える側に倒す)
    const ds = get('DTSTART');
    if (!ds) return;
    const s = parseDate(ds);
    if (!s) return;
    const de = get('DTEND');
    const e = de ? parseDate(de) : null;
    let durMs = e ? e.ms - s.ms : s.allDay ? DAY_MS : 0;
    const dur = get('DURATION');
    if (!e && dur) {
      const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(dur.value);
      if (m) durMs = ((+(m[1] ?? 0) * 7 + +(m[2] ?? 0)) * 24 + +(m[3] ?? 0)) * 3600_000 + +(m[4] ?? 0) * 60_000 + +(m[5] ?? 0) * 1000;
    }
    if (durMs <= 0) return;
    const rr = get('RRULE');
    const rule = rr ? parseRule(rr.value) : null;
    const exdates = new Set(props.filter((p) => p.name === 'EXDATE').flatMap((p) => p.value.split(',').map((v) => parseDate({ ...p, value: v })?.ms)).filter((x): x is number => x !== undefined));
    const starts = rule ? occurrences(s.ms, rule, toMs) : [s.ms];
    for (const st of starts) {
      if (exdates.has(st)) continue;
      if (st < toMs && st + durMs > fromMs) raw.push([st, st + durMs]);
    }
  }

  raw.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of raw) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged.map(([a, b]) => ({ start: new Date(a).toISOString(), end: new Date(b).toISOString() }));
}

const cache = new Map<string, { at: number; text: string }>();
const CACHE_MS = 5 * 60_000;

/** iCalのURLを読んで、予定のある時間帯を返す(5分間は、同じURLを読み直さない)。https のURLだけ */
export async function fetchIcalBusy(url: string, fromMs: number, toMs: number): Promise<BusyInterval[]> {
  if (!/^https:\/\//i.test(url)) return [];
  const hit = cache.get(url);
  let text: string;
  if (hit && Date.now() - hit.at < CACHE_MS) text = hit.text;
  else {
    const res = await fetch(url, { headers: { Accept: 'text/calendar' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`iCal fetch error ${res.status}`);
    text = await res.text();
    if (text.length > 15_000_000) throw new Error('iCal too large');
    cache.set(url, { at: Date.now(), text });
  }
  return icalBusyIntervals(text, fromMs, toMs);
}
