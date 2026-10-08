/**
 * カレンダー予約(Lステップの「カレンダー予約」と同じ仕様)の設定の形と、入力の検証。
 * 設定は、カレンダーごとに JSON で持つ。足りない項目は、ここの既定値で補う。
 * 時刻は、すべて日本時間。日付は YYYY-MM-DD、時刻は HH:MM、日時は YYYY-MM-DDTHH:MM。
 */
import { parseFriendAddActions } from './friend-add-settings';
import type { FriendAddAction } from './friend-add-settings';

export class ReserveError extends Error {}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

// ── 予約受付 ────────────────────────────────────────────────────────────────

export interface TimeRange {
  from: string;
  to: string;
}
export interface DayRule {
  closed: boolean;
  allDay: boolean;
  ranges: TimeRange[];
}
export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'holiday';
export const WEEKDAY_KEYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday'];

export type DeadlineKey = 'start' | '1h' | '3h' | '6h' | '12h' | '24h' | '1d' | '2d' | '3d' | '4d' | '5d' | '6d' | '1w' | '10d' | '2w';
export const DEADLINE_KEYS: DeadlineKey[] = ['start', '1h', '3h', '6h', '12h', '24h', '1d', '2d', '3d', '4d', '5d', '6d', '1w', '10d', '2w'];

export type RelativeUnit = 'days' | 'hours' | 'minutes';

export interface ReceptionSettings {
  hoursMode: 'daily' | 'weekday';
  daily: DayRule;
  weekdays: Record<WeekdayKey, DayRule>;
  /** 特定日の設定(特定日 > 祝日 > 曜日 の順に使う) */
  specialDays: Array<DayRule & { date: string }>;
  /** 受付開始: 予約日時の一定期間前から / 特定の日時から / 常に */
  start: { mode: 'relative'; amount: number; unit: RelativeUnit } | { mode: 'at'; at: string } | { mode: 'always' };
  /** 受付締切: 予約日時の一定期間前まで(日前は時刻つき) / 特定の日時まで / 予約開始まで */
  deadline: { mode: 'relative'; amount: number; unit: RelativeUnit; time: string | null } | { mode: 'at'; at: string } | { mode: 'until_start' };
  changeDeadline: DeadlineKey;
  cancelDeadline: DeadlineKey;
  /** 全体の同時予約可能数。null=無制限 */
  totalCapacity: number | null;
  approval: {
    newBooking: 'auto' | 'request';
    change: 'allow' | 'deny' | 'request';
    cancel: 'allow' | 'deny' | 'request';
  };
}

const openRule = (): DayRule => ({ closed: false, allDay: false, ranges: [{ from: '10:00', to: '19:00' }] });
const closedRule = (): DayRule => ({ closed: true, allDay: false, ranges: [] });

export function defaultReception(): ReceptionSettings {
  return {
    hoursMode: 'weekday',
    daily: openRule(),
    weekdays: { mon: openRule(), tue: openRule(), wed: openRule(), thu: openRule(), fri: openRule(), sat: closedRule(), sun: closedRule(), holiday: closedRule() },
    specialDays: [],
    start: { mode: 'always' },
    deadline: { mode: 'until_start' },
    changeDeadline: 'start',
    cancelDeadline: 'start',
    totalCapacity: null,
    approval: { newBooking: 'auto', change: 'allow', cancel: 'allow' },
  };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown, label: string, min: number, max: number): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ReserveError(`${label}は、${min}〜${max}の整数で入力してください`);
  return n;
};

function parseDayRule(raw: unknown, label: string): DayRule {
  const r = obj(raw);
  const closed = r.closed === true;
  const allDay = r.allDay === true;
  const ranges: TimeRange[] = [];
  if (!closed && !allDay) {
    const list = Array.isArray(r.ranges) ? r.ranges : [];
    if (list.length === 0) throw new ReserveError(`${label}の受付時間を入力してください`);
    if (list.length > 10) throw new ReserveError(`${label}の受付時間は、10個までです`);
    for (const x of list) {
      const t = obj(x);
      if (typeof t.from !== 'string' || typeof t.to !== 'string' || !HHMM.test(t.from) || !HHMM.test(t.to)) throw new ReserveError(`${label}の時刻は、10:00 の形で入力してください`);
      if (t.from >= t.to) throw new ReserveError(`${label}の終了時刻は、開始時刻より後にしてください`);
      ranges.push({ from: t.from, to: t.to });
    }
    ranges.sort((a, b) => a.from.localeCompare(b.from));
    for (let i = 1; i < ranges.length; i++) if (ranges[i].from < ranges[i - 1].to) throw new ReserveError(`${label}の受付時間が重なっています`);
  }
  return { closed, allDay, ranges };
}

const WEEKDAY_LABEL: Record<WeekdayKey, string> = { mon: '月曜日', tue: '火曜日', wed: '水曜日', thu: '木曜日', fri: '金曜日', sat: '土曜日', sun: '日曜日', holiday: '祝日' };

export function parseReception(raw: unknown): ReceptionSettings {
  const base = defaultReception();
  const r = obj(raw);
  const out: ReceptionSettings = { ...base };
  out.hoursMode = r.hoursMode === 'daily' ? 'daily' : 'weekday';
  out.daily = r.daily === undefined ? base.daily : parseDayRule(r.daily, '毎日共通の');
  const wk = obj(r.weekdays);
  out.weekdays = { ...base.weekdays };
  for (const k of WEEKDAY_KEYS) if (wk[k] !== undefined) out.weekdays[k] = parseDayRule(wk[k], WEEKDAY_LABEL[k]);
  const specials = Array.isArray(r.specialDays) ? r.specialDays : [];
  if (specials.length > 200) throw new ReserveError('特定日の設定は、200個までです');
  const seen = new Set<string>();
  out.specialDays = specials.map((s) => {
    const o = obj(s);
    if (typeof o.date !== 'string' || !DATE.test(o.date)) throw new ReserveError('特定日の日付が正しくありません');
    if (seen.has(o.date)) throw new ReserveError(`特定日 ${o.date} が重複しています`);
    seen.add(o.date);
    return { date: o.date, ...parseDayRule(o, `特定日 ${o.date} の`) };
  });

  const st = obj(r.start);
  if (st.mode === 'relative') out.start = { mode: 'relative', amount: int(st.amount, '受付開始の期間', 0, 9999), unit: parseUnit(st.unit) };
  else if (st.mode === 'at') {
    if (typeof st.at !== 'string' || !DATETIME.test(st.at)) throw new ReserveError('受付開始の日時が正しくありません');
    out.start = { mode: 'at', at: st.at };
  } else out.start = { mode: 'always' };

  const dl = obj(r.deadline);
  if (dl.mode === 'relative') {
    const unit = parseUnit(dl.unit);
    const time = unit === 'days' && typeof dl.time === 'string' && dl.time ? dl.time : null;
    if (time && !HHMM.test(time)) throw new ReserveError('受付締切の時刻は、10:00 の形で入力してください');
    out.deadline = { mode: 'relative', amount: int(dl.amount, '受付締切の期間', 0, 9999), unit, time };
  } else if (dl.mode === 'at') {
    if (typeof dl.at !== 'string' || !DATETIME.test(dl.at)) throw new ReserveError('受付締切の日時が正しくありません');
    out.deadline = { mode: 'at', at: dl.at };
  } else out.deadline = { mode: 'until_start' };

  out.changeDeadline = DEADLINE_KEYS.includes(r.changeDeadline as DeadlineKey) ? (r.changeDeadline as DeadlineKey) : base.changeDeadline;
  out.cancelDeadline = DEADLINE_KEYS.includes(r.cancelDeadline as DeadlineKey) ? (r.cancelDeadline as DeadlineKey) : base.cancelDeadline;
  out.totalCapacity = r.totalCapacity === null || r.totalCapacity === undefined || r.totalCapacity === '' ? null : int(r.totalCapacity, '全体の同時予約可能数', 1, 9999);

  const ap = obj(r.approval);
  out.approval = {
    newBooking: ap.newBooking === 'request' ? 'request' : 'auto',
    change: ap.change === 'deny' || ap.change === 'request' ? ap.change : 'allow',
    cancel: ap.cancel === 'deny' || ap.cancel === 'request' ? ap.cancel : 'allow',
  };
  return out;
}

/** 保存済みの受付設定を読むとき用: 検証に通らなくても、読める範囲で既定値を補って返す */
export function parseReceptionSafe(raw: unknown): ReceptionSettings {
  try {
    return parseReception(raw);
  } catch {
    return defaultReception();
  }
}

function parseUnit(v: unknown): RelativeUnit {
  if (v === 'days' || v === 'hours' || v === 'minutes') return v;
  throw new ReserveError('単位(日・時間・分)を選んでください');
}

/** 変更・キャンセルの期限(キー)を、「予約開始の何分前まで」にする。'start'=0、'1d'(前日まで)は、予約日の0時まで(→予約開始から見た分数は日による)ので null を返し、呼び出し側で日付から求める */
export function deadlineMinutesBefore(key: DeadlineKey): number | null {
  switch (key) {
    case 'start': return 0;
    case '1h': return 60;
    case '3h': return 180;
    case '6h': return 360;
    case '12h': return 720;
    case '24h': return 1440;
    case '1w': return 7 * 1440;
    case '10d': return 10 * 1440;
    case '2w': return 14 * 1440;
    default: return null; // 1d〜6d は、日付(予約日の0時の何日前)で求める
  }
}
/** '1d'〜'6d'(前日まで・2日前まで…)の日数。それ以外は null */
export function deadlineDays(key: DeadlineKey): number | null {
  const m = /^(\d)d$/.exec(key);
  return m ? Number(m[1]) : null;
}

// ── 予約枠・コースの設定 ─────────────────────────────────────────────────────

export interface SlotSettings {
  title: string;
  required: boolean;
  priceEnabled: boolean;
  /** 同時予約可能数(既定)。null=無制限 */
  defaultCapacity: number | null;
  shiftLinked: boolean;
  /** 予約枠未選択時の自動振り分け(予約枠の選択が任意のときだけ) */
  autoAssign: boolean;
}
export interface CourseSettings {
  title: string;
  required: boolean;
  priceEnabled: boolean;
  showDuration: boolean;
  /** コース未指定時の所要時間(分)。コースの選択が任意のときだけ使う */
  unspecifiedMinutes: number;
}

export const defaultSlotSettings = (): SlotSettings => ({ title: '予約枠', required: true, priceEnabled: false, defaultCapacity: 1, shiftLinked: false, autoAssign: false });
export const defaultCourseSettings = (): CourseSettings => ({ title: 'コース', required: false, priceEnabled: false, showDuration: false, unspecifiedMinutes: 30 });

const title = (v: unknown, fallback: string, label: string): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return fallback;
  if (s.length > 50) throw new ReserveError(`${label}は50文字以内で入力してください`);
  return s;
};

export function parseSlotSettings(raw: unknown): SlotSettings {
  const b = defaultSlotSettings();
  const r = obj(raw);
  const required = r.required === undefined ? b.required : r.required === true;
  return {
    title: title(r.title, b.title, '予約枠タイトル'),
    required,
    priceEnabled: r.priceEnabled === true,
    defaultCapacity: r.defaultCapacity === undefined ? b.defaultCapacity : r.defaultCapacity === null || r.defaultCapacity === '' ? null : int(r.defaultCapacity, '同時予約可能数', 1, 9999),
    shiftLinked: r.shiftLinked === true,
    autoAssign: !required && r.autoAssign === true,
  };
}
export function parseCourseSettings(raw: unknown): CourseSettings {
  const b = defaultCourseSettings();
  const r = obj(raw);
  return {
    title: title(r.title, b.title, 'コースタイトル'),
    required: r.required === true,
    priceEnabled: r.priceEnabled === true,
    showDuration: r.showDuration === true,
    unspecifiedMinutes: r.unspecifiedMinutes === undefined ? b.unspecifiedMinutes : int(r.unspecifiedMinutes, 'コース未指定時の所要時間', 5, 1440),
  };
}

// ── 予約画面 ────────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'textarea' | 'select';
export type TextKind = 'none' | 'name' | 'kana' | 'email' | 'phone' | 'integer';

export interface ScreenField {
  id: string;
  label: string;
  description: string;
  type: FieldType;
  textKind: TextKind;
  options: string[];
  required: boolean;
  /** 回答を、この友だち情報欄(friends.metadata のキー)に反映する */
  friendFieldKey: string | null;
  linkGoogle: boolean;
  /** 回答を、友だちの本名に反映する(名前の項目だけ・1つだけ) */
  linkRealName: boolean;
}

export interface ScreenSettings {
  view: 'week' | 'month';
  unitMinutes: number;
  adminInfo: { show: boolean; imageUrl: string; name: string; address: string; phone: string; description: string };
  consent: { show: boolean; title: string; body: string };
  thanksUrls: { complete: string; change: string; cancel: string };
  fields: ScreenField[];
}

export function defaultScreen(): ScreenSettings {
  return {
    view: 'week',
    unitMinutes: 15,
    adminInfo: { show: true, imageUrl: '', name: '', address: '', phone: '', description: '' },
    consent: { show: false, title: '', body: '' },
    thanksUrls: { complete: '', change: '', cancel: '' },
    fields: [
      { id: 'name', label: 'お名前', description: '', type: 'text', textKind: 'name', options: [], required: true, friendFieldKey: null, linkGoogle: true, linkRealName: false },
      { id: 'kana', label: 'お名前(カナ)', description: '', type: 'text', textKind: 'kana', options: [], required: true, friendFieldKey: null, linkGoogle: true, linkRealName: false },
    ],
  };
}

const str = (v: unknown, max: number, label: string): string => {
  const s = typeof v === 'string' ? v : '';
  if (s.length > max) throw new ReserveError(`${label}は${max}文字以内で入力してください`);
  return s;
};
const url = (v: unknown, label: string): string => {
  const s = str(v, 500, label).trim();
  if (s && !/^https?:\/\//i.test(s)) throw new ReserveError(`${label}は、https:// から始まるURLで入力してください`);
  return s;
};

export function parseScreen(raw: unknown): ScreenSettings {
  const b = defaultScreen();
  const r = obj(raw);
  const ai = obj(r.adminInfo);
  const co = obj(r.consent);
  const th = obj(r.thanksUrls);
  const unit = r.unitMinutes === undefined ? b.unitMinutes : int(r.unitMinutes, '予約時間の単位', 5, 1440);
  if (1440 % unit !== 0 && unit % 5 !== 0) throw new ReserveError('予約時間の単位は、5分刻みで入力してください');
  const fieldsRaw = Array.isArray(r.fields) ? r.fields : b.fields;
  if (fieldsRaw.length > 30) throw new ReserveError('予約情報取得項目は、30個までです');
  const ids = new Set<string>();
  let realNameCount = 0;
  const fields: ScreenField[] = fieldsRaw.map((f, i) => {
    const o = obj(f);
    const id = typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : `f${i + 1}`;
    if (ids.has(id)) throw new ReserveError('予約情報取得項目のIDが重複しています');
    ids.add(id);
    const label = str(o.label, 100, '項目名').trim();
    if (!label) throw new ReserveError('予約情報取得項目の項目名を入力してください');
    const type: FieldType = o.type === 'textarea' || o.type === 'select' ? o.type : 'text';
    const textKind: TextKind = type === 'text' && ['name', 'kana', 'email', 'phone', 'integer'].includes(String(o.textKind)) ? (o.textKind as TextKind) : 'none';
    const options = type === 'select' ? (Array.isArray(o.options) ? o.options.map((x) => str(x, 100, '選択肢').trim()).filter(Boolean) : []) : [];
    if (type === 'select' && options.length === 0) throw new ReserveError(`「${label}」の選択肢を入力してください`);
    const linkRealName = o.linkRealName === true && textKind === 'name';
    if (linkRealName) realNameCount++;
    return {
      id,
      label,
      description: str(o.description, 500, '項目の説明文'),
      type,
      textKind,
      options,
      required: o.required === true,
      friendFieldKey: typeof o.friendFieldKey === 'string' && o.friendFieldKey ? o.friendFieldKey.slice(0, 64) : null,
      linkGoogle: textKind === 'name' || textKind === 'kana' ? true : o.linkGoogle === true,
      linkRealName,
    };
  });
  if (realNameCount > 1) throw new ReserveError('本名と紐づけられる項目は、1つだけです');
  const consentShow = co.show === true;
  if (consentShow && !str(co.body, 5000, '同意事項の説明文').trim()) throw new ReserveError('同意事項の説明文を入力してください');
  return {
    view: r.view === 'month' ? 'month' : 'week',
    unitMinutes: unit,
    adminInfo: {
      show: ai.show === undefined ? b.adminInfo.show : ai.show === true,
      imageUrl: url(ai.imageUrl, 'イメージ画像のURL'),
      name: str(ai.name, 100, '管理者名'),
      address: str(ai.address, 200, '所在地'),
      phone: str(ai.phone, 50, '電話番号'),
      description: str(ai.description, 5000, '説明文'),
    },
    consent: { show: consentShow, title: str(co.title, 100, '同意事項項目名'), body: str(co.body, 5000, '同意事項の説明文') },
    thanksUrls: { complete: url(th.complete, '予約完了後のサンクスページURL'), change: url(th.change, '予約変更後のサンクスページURL'), cancel: url(th.cancel, '予約キャンセル後のサンクスページURL') },
    fields,
  };
}

// ── アクション・リマインダ・フォロー ──────────────────────────────────────────

export const ACTION_KEYS = [
  'onBooked',
  'onChanged',
  'onCancelled',
  'requestNewSubmitted',
  'requestNewApproved',
  'requestNewRejected',
  'requestChangeSubmitted',
  'requestChangeApproved',
  'requestChangeRejected',
  'requestCancelSubmitted',
  'requestCancelApproved',
  'requestCancelRejected',
] as const;
export type ReserveActionKey = (typeof ACTION_KEYS)[number];
export type ReserveActions = Record<ReserveActionKey, FriendAddAction[]> & {
  /** リクエストを承認・否認するとき、アクションを実行する、を初期値にするか */
  runActionsByDefault: boolean;
};

export function defaultActions(): ReserveActions {
  const a = { runActionsByDefault: false } as ReserveActions;
  for (const k of ACTION_KEYS) a[k] = [];
  return a;
}

export function parseReserveActions(raw: unknown): ReserveActions {
  const r = obj(raw);
  const out = defaultActions();
  for (const k of ACTION_KEYS) out[k] = parseFriendAddActions(r[k]);
  out.runActionsByDefault = r.runActionsByDefault === true;
  return out;
}

export interface ReminderItem {
  id: string;
  /** time=予約日の○日前の○時 / remaining=予約時間の○時間前・○分前 */
  kind: 'time' | 'remaining';
  daysBefore: number;
  time: string;
  amount: number;
  unit: 'hours' | 'minutes';
  actions: FriendAddAction[];
}
export interface FollowItem {
  id: string;
  /** time=予約日の○日後の○時 / elapsed=コース終了後○時間・○分 */
  kind: 'time' | 'elapsed';
  daysAfter: number;
  time: string;
  amount: number;
  unit: 'hours' | 'minutes';
  actions: FriendAddAction[];
}
export interface ReminderSettings {
  enabled: boolean;
  /** オンにした日時。これより前に入っていた予約には、送らない */
  enabledAt: string | null;
  items: ReminderItem[];
}
export interface FollowSettings {
  enabled: boolean;
  enabledAt: string | null;
  items: FollowItem[];
}

const MAX_TIMING_ITEMS = 10;

export function parseReminders(raw: unknown, previous?: ReminderSettings | null): ReminderSettings {
  const r = obj(raw);
  const list = Array.isArray(r.items) ? r.items : [];
  if (list.length > MAX_TIMING_ITEMS) throw new ReserveError(`リマインダは、${MAX_TIMING_ITEMS}件までです`);
  const items: ReminderItem[] = list.map((x, i) => {
    const o = obj(x);
    const kind = o.kind === 'remaining' ? 'remaining' : 'time';
    const time = typeof o.time === 'string' && HHMM.test(o.time) ? o.time : '10:00';
    if (kind === 'time' && o.time !== undefined && !HHMM.test(String(o.time))) throw new ReserveError('リマインダの時刻は、10:00 の形で入力してください');
    return {
      id: typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : `r${i + 1}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      daysBefore: kind === 'time' ? int(o.daysBefore ?? 1, 'リマインダの日数', 0, 365) : 0,
      time,
      amount: kind === 'remaining' ? int(o.amount ?? 1, 'リマインダの時間', 1, 9999) : 1,
      unit: o.unit === 'minutes' ? 'minutes' : 'hours',
      actions: parseFriendAddActions(o.actions),
    };
  });
  const enabled = r.enabled === true;
  const wasEnabled = previous?.enabled === true;
  return { enabled, enabledAt: enabled ? (wasEnabled && previous?.enabledAt ? previous.enabledAt : nowJstMinute()) : (previous?.enabledAt ?? null), items };
}

export function parseFollow(raw: unknown, previous?: FollowSettings | null): FollowSettings {
  const r = obj(raw);
  const list = Array.isArray(r.items) ? r.items : [];
  if (list.length > MAX_TIMING_ITEMS) throw new ReserveError(`フォローは、${MAX_TIMING_ITEMS}件までです`);
  const items: FollowItem[] = list.map((x, i) => {
    const o = obj(x);
    const kind = o.kind === 'elapsed' ? 'elapsed' : 'time';
    const time = typeof o.time === 'string' && HHMM.test(o.time) ? o.time : '10:00';
    if (kind === 'time' && o.time !== undefined && !HHMM.test(String(o.time))) throw new ReserveError('フォローの時刻は、10:00 の形で入力してください');
    return {
      id: typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : `f${i + 1}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      daysAfter: kind === 'time' ? int(o.daysAfter ?? 1, 'フォローの日数', 0, 365) : 0,
      time,
      amount: kind === 'elapsed' ? int(o.amount ?? 1, 'フォローの時間', 1, 9999) : 1,
      unit: o.unit === 'minutes' ? 'minutes' : 'hours',
      actions: parseFriendAddActions(o.actions),
    };
  });
  const enabled = r.enabled === true;
  const wasEnabled = previous?.enabled === true;
  return { enabled, enabledAt: enabled ? (wasEnabled && previous?.enabledAt ? previous.enabledAt : nowJstMinute()) : (previous?.enabledAt ?? null), items };
}

export interface ExternalSettings {
  google: {
    enabled: boolean;
    /** calendar_connections の id */
    connectionId: string | null;
    /** all=予約の反映もシフトへの反映も / bookings=予約をGoogleの予定に反映だけ / shift=Googleの予定をシフトに反映だけ */
    target: 'all' | 'bookings' | 'shift';
  };
}
export const defaultExternal = (): ExternalSettings => ({ google: { enabled: false, connectionId: null, target: 'all' } });
export function parseExternal(raw: unknown): ExternalSettings {
  const g = obj(obj(raw).google);
  return {
    google: {
      enabled: g.enabled === true,
      connectionId: typeof g.connectionId === 'string' && g.connectionId ? g.connectionId : null,
      target: g.target === 'bookings' || g.target === 'shift' ? g.target : 'all',
    },
  };
}

export function nowJstMinute(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16);
}
