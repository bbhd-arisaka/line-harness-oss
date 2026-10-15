// 予約配信の日時の選び方・表示。画面に依存しない純粋な関数だけ。
// 日時は、端末のタイムゾーンに関係なく、日本時間(JST)として扱う(配信の時刻は、お客様に届く日本時間で考えるため)。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** いまの日本時間を、(年・月・日・時・分・曜日)で返す */
export function jstParts(now: Date): { y: number; m: number; d: number; hh: number; mm: number; dow: number } {
  const t = new Date(now.getTime() + JST_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), dow: t.getUTCDay() };
}

const pad = (n: number) => String(n).padStart(2, '0');

export interface ScheduleOption {
  /** 並び・照合に使う値(日付: 2026-10-16、時刻: 09:30) */
  id: string;
  label: string;
}

/** 日付の選択肢: 今日から days 日ぶん(「今日」「明日」を付ける) */
export function buildDateOptions(now: Date, days = 90): ScheduleOption[] {
  const base = jstParts(now);
  const out: ScheduleOption[] = [];
  for (let i = 0; i < days; i++) {
    const t = new Date(Date.UTC(base.y, base.m - 1, base.d + i));
    const y = t.getUTCFullYear();
    const m = t.getUTCMonth() + 1;
    const d = t.getUTCDate();
    const tag = i === 0 ? '(今日)' : i === 1 ? '(明日)' : '';
    out.push({ id: `${y}-${pad(m)}-${pad(d)}`, label: `${m}月${d}日(${WEEKDAYS[t.getUTCDay()]})${tag}` });
  }
  return out;
}

/** 時刻の選択肢: 朝の6時から夜中まで、step 分きざみ。そのあと0時〜5時台(お客様への配信は、日中が多いので朝から並べる) */
export function buildTimeOptions(step = 10): ScheduleOption[] {
  const out: ScheduleOption[] = [];
  for (let k = 0; k < 24 * 60; k += step) {
    const mins = (6 * 60 + k) % (24 * 60);
    const id = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
    out.push({ id, label: id });
  }
  return out;
}

/** サーバーに送る形(日本時間・ +09:00 つき)。例: 2026-10-16 と 09:30 → 2026-10-16T09:30:00.000+09:00 */
export function toScheduledAt(dateId: string, timeId: string): string {
  return `${dateId}T${timeId}:00.000+09:00`;
}

/** 予約の日時が、いまから minMinutes 分より先か(配信の処理は1分ごとなので、直前すぎる予約は受け付けない) */
export function isFutureEnough(scheduledAt: string, now: Date, minMinutes = 3): boolean {
  const t = new Date(scheduledAt).getTime();
  return Number.isFinite(t) && t - now.getTime() >= minMinutes * 60_000;
}

/** 表示用: 「10月16日(金) 09:30」。読めなければ空文字 */
export function formatScheduled(scheduledAt: string | null | undefined): string {
  if (!scheduledAt) return '';
  const t = new Date(scheduledAt);
  if (!Number.isFinite(t.getTime())) return '';
  const p = jstParts(t);
  return `${p.m}月${p.d}日(${WEEKDAYS[p.dow]}) ${pad(p.hh)}:${pad(p.mm)}`;
}

/** 初期の選択: あしたの朝9時 */
export function defaultSchedule(now: Date): { dateId: string; timeId: string } {
  const opts = buildDateOptions(now, 2);
  return { dateId: opts[1].id, timeId: '09:00' };
}
