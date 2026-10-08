/**
 * 通知設定(Lステップの「通知」と同じ使い方)。公式アカウントごとに、
 *   どんなとき(timings) × どの時間帯(schedule) × 絞り込み(filter) → だれに(destinations)
 * を持つ。通知先は beyond admin に登録・検証済みの宛先(LINE・メール)だけ。
 */

export type NotificationStatus = 'on' | 'off';

export type NotificationSchedule =
  | { mode: 'always' }
  /** 日本時間。days は 0=日曜〜6=土曜。from < to は同じ日の中。from > to は日をまたぐ(例 22:00〜06:00) */
  | { mode: 'weekly'; days: number[]; from: string; to: string };

export interface NotificationTiming {
  key: string;
  /** 回答フォームの通知で、フォームを絞るとき。空・なしなら全てのフォーム */
  formIds?: string[];
}

export interface NotificationDestination {
  kind: 'line' | 'mail';
  /** beyond admin 側の宛先ID */
  id: string;
  /** 画面に出す名前(登録時の表示名。beyond admin で名前が変わっても通知には影響しない) */
  name: string;
}

export interface NotificationSetting {
  id: string;
  lineAccountId: string;
  title: string;
  status: NotificationStatus;
  schedule: NotificationSchedule;
  timings: NotificationTiming[];
  filterTagIds: string[];
  destinations: NotificationDestination[];
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  line_account_id: string;
  title: string;
  status: NotificationStatus;
  schedule: string;
  timings: string;
  filter_tag_ids: string;
  destinations: string;
  is_default: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── 通知するタイミングの一覧(Lステップの「タイミング」と同じ分け方) ──────────────

export interface TimingDef {
  key: string;
  label: string;
  /** その通知を実際に送れるか(false は一覧には出すが選べない=準備中) */
  available: boolean;
  note?: string;
}
export interface TimingCategory {
  key: string;
  label: string;
  description: string;
  timings: TimingDef[];
}

export const NOTIFICATION_CATALOG: TimingCategory[] = [
  {
    key: 'friend', label: '友だち追加・ブロック', description: '友だち関連で通知するタイミングを設定します',
    timings: [
      { key: 'friend_add', label: '友だち追加時', available: true, note: '友だち追加時の通知は、対象の絞り込みを設定しないでください' },
      { key: 'friend_block', label: 'ブロック時', available: true },
    ],
  },
  {
    key: 'message', label: 'メッセージ', description: 'メッセージで通知するタイミングを設定します',
    timings: [{ key: 'message', label: '通常メッセージ', available: true }],
  },
  {
    key: 'status', label: '対応マーク', description: '対応マークで通知するタイミングを設定します',
    timings: [{ key: 'status_change', label: '対応マーク変更時', available: true }],
  },
  {
    key: 'auto_reply', label: '自動応答', description: '自動応答で通知するタイミングを設定します',
    timings: [{ key: 'auto_reply', label: '自動応答反応時', available: true }],
  },
  {
    key: 'form', label: '回答フォーム', description: '回答フォームで通知するタイミングを設定します',
    timings: [{ key: 'form_answered', label: '回答があったら通知', available: true, note: '全ての回答フォーム、または特定の回答フォームを選べます' }],
  },
  {
    key: 'event', label: 'イベント予約', description: 'イベント予約で通知するタイミングを設定します',
    timings: [
      { key: 'event_booked', label: '予約時', available: true },
      { key: 'event_cancelled', label: '予約キャンセル時', available: true },
      { key: 'event_changed', label: '予約変更時', available: false, note: '準備中' },
      { key: 'event_approved', label: '予約承認時', available: true },
      { key: 'event_rejected', label: '予約拒否時', available: true },
      { key: 'event_pending', label: '予約保留時', available: false, note: '準備中' },
    ],
  },
  {
    key: 'calendar', label: 'カレンダー予約', description: 'カレンダー予約で通知するタイミングを設定します',
    timings: [
      { key: 'calendar_booked', label: '予約時', available: true },
      { key: 'calendar_cancelled', label: '予約キャンセル時', available: true },
      { key: 'calendar_changed', label: '予約変更時', available: true },
      { key: 'calendar_request', label: '予約リクエスト時', available: true },
      { key: 'calendar_request_approved', label: '予約リクエスト承認時', available: true },
      { key: 'calendar_request_rejected', label: '予約リクエスト否認時', available: true },
      { key: 'calendar_deleted', label: '予約削除時', available: true },
    ],
  },
  {
    key: 'action', label: 'アクション', description: 'アクションで通知するタイミングを設定します',
    timings: [{ key: 'action_started', label: 'スケジュール実行開始', available: false, note: '準備中' }],
  },
  {
    key: 'tag', label: 'タグ', description: 'タグで通知するタイミングを設定します',
    timings: [{ key: 'tag_added', label: 'タグ追加時', available: true }],
  },
  {
    key: 'url_click', label: 'URLクリック', description: 'URLクリックで通知するタイミングを設定します',
    timings: [{ key: 'url_click', label: 'URLクリック検出時', available: true }],
  },
  {
    key: 'service', label: 'サービス', description: '≪推奨≫ 送信数の上限超過による送信停止等のお知らせを通知します',
    timings: [
      { key: 'send_count_warning', label: '【LINE公式】送信カウント警告通知', available: false, note: '準備中' },
    ],
  },
];

const ALL_TIMINGS = new Map(NOTIFICATION_CATALOG.flatMap((c) => c.timings.map((t) => [t.key, t])));
export const isKnownTiming = (key: string): boolean => ALL_TIMINGS.has(key);
export const isAvailableTiming = (key: string): boolean => ALL_TIMINGS.get(key)?.available === true;
export const timingLabel = (key: string): string => ALL_TIMINGS.get(key)?.label ?? key;

/** アカウントを追加したときに、自動で作る標準の設定(Lステップの「チャット通知」と同じ内容 + 友だち追加時) */
export const DEFAULT_NOTIFICATION_PRESETS: { title: string; timings: NotificationTiming[] }[] = [
  { title: 'チャット通知', timings: [{ key: 'message' }, { key: 'form_answered' }] },
  { title: '友だち追加通知', timings: [{ key: 'friend_add' }] },
];

// ── 入力の検証(画面・API から来た値をそろえる) ─────────────────────────────────

export class NotificationSettingError extends Error {}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseSchedule(x: unknown): NotificationSchedule {
  const o = x as { mode?: unknown; days?: unknown; from?: unknown; to?: unknown } | null | undefined;
  if (!o || o.mode === 'always' || o.mode === undefined) return { mode: 'always' };
  if (o.mode !== 'weekly') throw new NotificationSettingError('通知スケジュールの指定が正しくありません');
  const days = Array.isArray(o.days) ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  if (days.length === 0) throw new NotificationSettingError('通知する曜日を1つ以上選んでください');
  if (typeof o.from !== 'string' || typeof o.to !== 'string' || !HHMM.test(o.from) || !HHMM.test(o.to)) {
    throw new NotificationSettingError('通知する時間帯は「09:00」の形で指定してください');
  }
  if (o.from === o.to) throw new NotificationSettingError('開始と終了が同じ時刻です。終日にしたいときは「常に」を選んでください');
  return { mode: 'weekly', days, from: o.from, to: o.to };
}

export function parseTimings(x: unknown): NotificationTiming[] {
  if (!Array.isArray(x) || x.length === 0) throw new NotificationSettingError('通知するタイミングを1つ以上選んでください');
  const seen = new Set<string>();
  const out: NotificationTiming[] = [];
  for (const raw of x) {
    const key = typeof raw === 'string' ? raw : (raw as { key?: unknown } | null)?.key;
    if (typeof key !== 'string' || !isKnownTiming(key)) throw new NotificationSettingError('未対応の通知タイミングが含まれています');
    if (!isAvailableTiming(key)) throw new NotificationSettingError(`「${timingLabel(key)}」は、まだ選べません(準備中です)`);
    if (seen.has(key)) continue;
    seen.add(key);
    const formIds = typeof raw === 'object' && raw !== null && Array.isArray((raw as { formIds?: unknown }).formIds)
      ? [...new Set(((raw as { formIds: unknown[] }).formIds).filter((f): f is string => typeof f === 'string' && f !== ''))]
      : [];
    out.push(key === 'form_answered' && formIds.length ? { key, formIds } : { key });
  }
  return out;
}

export function parseDestinations(x: unknown): NotificationDestination[] {
  if (!Array.isArray(x) || x.length === 0) throw new NotificationSettingError('通知先を1つ以上選んでください');
  const seen = new Set<string>();
  const out: NotificationDestination[] = [];
  for (const raw of x) {
    const d = raw as { kind?: unknown; id?: unknown; name?: unknown } | null;
    if (!d || (d.kind !== 'line' && d.kind !== 'mail') || typeof d.id !== 'string' || d.id === '') {
      throw new NotificationSettingError('通知先の指定が正しくありません');
    }
    const k = `${d.kind}:${d.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: d.kind, id: d.id.slice(0, 64), name: typeof d.name === 'string' ? d.name.slice(0, 100) : '' });
  }
  return out;
}

export interface NotificationSettingInput {
  title?: unknown;
  status?: unknown;
  schedule?: unknown;
  timings?: unknown;
  filterTagIds?: unknown;
  destinations?: unknown;
}

function toSetting(r: Row): NotificationSetting {
  const json = <T>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };
  return {
    id: r.id, lineAccountId: r.line_account_id, title: r.title, status: r.status,
    schedule: json<NotificationSchedule>(r.schedule, { mode: 'always' }),
    timings: json<NotificationTiming[]>(r.timings, []),
    filterTagIds: json<string[]>(r.filter_tag_ids, []),
    destinations: json<NotificationDestination[]>(r.destinations, []),
    isDefault: r.is_default === 1, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function listNotificationSettings(db: D1Database, lineAccountId: string): Promise<NotificationSetting[]> {
  const rows = await db.prepare('SELECT * FROM notification_settings WHERE line_account_id = ? ORDER BY created_at').bind(lineAccountId).all<Row>();
  return (rows.results ?? []).map(toSetting);
}

export async function getNotificationSetting(db: D1Database, id: string): Promise<NotificationSetting | null> {
  const row = await db.prepare('SELECT * FROM notification_settings WHERE id = ?').bind(id).first<Row>();
  return row ? toSetting(row) : null;
}

/** 「オン」の設定だけ(通知を送るときに使う) */
export async function listActiveNotificationSettings(db: D1Database, lineAccountId: string): Promise<NotificationSetting[]> {
  const rows = await db.prepare("SELECT * FROM notification_settings WHERE line_account_id = ? AND status = 'on'").bind(lineAccountId).all<Row>();
  return (rows.results ?? []).map(toSetting);
}

function clean(input: NotificationSettingInput, partial: boolean) {
  const out: Partial<Pick<NotificationSetting, 'title' | 'status' | 'schedule' | 'timings' | 'filterTagIds'>> = {};
  if (!partial || input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) throw new NotificationSettingError('タイトルを入れてください');
    out.title = title.slice(0, 100);
  }
  if (input.status !== undefined) {
    if (input.status !== 'on' && input.status !== 'off') throw new NotificationSettingError('ステータスは on か off です');
    out.status = input.status;
  }
  if (!partial || input.schedule !== undefined) out.schedule = parseSchedule(input.schedule);
  if (!partial || input.timings !== undefined) out.timings = parseTimings(input.timings);
  if (input.filterTagIds !== undefined) {
    if (!Array.isArray(input.filterTagIds)) throw new NotificationSettingError('絞り込みのタグの指定が正しくありません');
    out.filterTagIds = [...new Set(input.filterTagIds.filter((t): t is string => typeof t === 'string' && t !== ''))].slice(0, 50);
  }
  return out;
}

export async function createNotificationSetting(
  db: D1Database,
  lineAccountId: string,
  input: NotificationSettingInput,
  opts: { createdBy?: string | null; isDefault?: boolean; allowEmptyDestinations?: boolean } = {},
): Promise<NotificationSetting> {
  const account = await db.prepare('SELECT id FROM line_accounts WHERE id = ?').bind(lineAccountId).first();
  if (!account) throw new NotificationSettingError('LINEアカウントが見つかりません');
  // 標準の設定は、通知先がまだ登録されていなくても作れる(あとで選ぶ)。ふつうの作成は、通知先が1つ以上
  const v = clean(input, false);
  const destinations = opts.allowEmptyDestinations && Array.isArray(input.destinations) && input.destinations.length === 0 ? [] : parseDestinations(input.destinations);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO notification_settings (id, line_account_id, title, status, schedule, timings, filter_tag_ids, destinations, is_default, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, lineAccountId, v.title, v.status ?? 'on', JSON.stringify(v.schedule), JSON.stringify(v.timings),
      JSON.stringify(v.filterTagIds ?? []), JSON.stringify(destinations), opts.isDefault ? 1 : 0, opts.createdBy ?? null,
    )
    .run();
  return (await getNotificationSetting(db, id))!;
}

export async function updateNotificationSetting(db: D1Database, id: string, input: NotificationSettingInput): Promise<NotificationSetting> {
  const cur = await getNotificationSetting(db, id);
  if (!cur) throw new NotificationSettingError('通知設定が見つかりません');
  const v = clean(input, true);
  const next = { ...cur, ...v, destinations: input.destinations !== undefined ? parseDestinations(input.destinations) : cur.destinations };
  // オンにするときは、通知先が1つ以上必要
  if (next.status === 'on' && next.destinations.length === 0) throw new NotificationSettingError('通知先を1つ以上選んでから、オンにしてください');
  await db
    .prepare(
      `UPDATE notification_settings SET title = ?, status = ?, schedule = ?, timings = ?, filter_tag_ids = ?, destinations = ?, is_default = 0,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE id = ?`,
    )
    .bind(next.title, next.status, JSON.stringify(next.schedule), JSON.stringify(next.timings), JSON.stringify(next.filterTagIds), JSON.stringify(next.destinations), id)
    .run();
  return (await getNotificationSetting(db, id))!;
}

export async function deleteNotificationSetting(db: D1Database, id: string): Promise<boolean> {
  const r = await db.prepare('DELETE FROM notification_settings WHERE id = ?').bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

/**
 * アカウントを追加したときに、標準の通知設定を自動で作る(まだ1つも無いときだけ)。
 * 通知先は、beyond admin に登録済みの宛先を渡されたものすべて(まだ無ければ空で、オフのまま作る)。
 */
export async function ensureDefaultNotificationSettings(
  db: D1Database,
  lineAccountId: string,
  destinations: NotificationDestination[],
): Promise<NotificationSetting[]> {
  const existing = await listNotificationSettings(db, lineAccountId);
  if (existing.length > 0) return [];
  const created: NotificationSetting[] = [];
  for (const preset of DEFAULT_NOTIFICATION_PRESETS) {
    created.push(
      await createNotificationSetting(
        db,
        lineAccountId,
        { title: preset.title, timings: preset.timings, schedule: { mode: 'always' }, destinations, status: destinations.length ? 'on' : 'off' },
        { isDefault: true, allowEmptyDestinations: true },
      ),
    );
  }
  return created;
}

/** 送った記録(失敗の確認用) */
export async function recordNotificationDelivery(
  db: D1Database,
  row: { settingId: string; timing: string; friendId: string | null; kind: string; destinationId: string; status: 'sent' | 'failed'; error?: string | null },
): Promise<void> {
  await db
    .prepare('INSERT INTO notification_deliveries (id, setting_id, timing, friend_id, destination_kind, destination_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), row.settingId, row.timing, row.friendId, row.kind, row.destinationId, row.status, row.error ? row.error.slice(0, 300) : null)
    .run();
}

export async function listRecentNotificationDeliveries(db: D1Database, settingId: string, limit = 20) {
  const rows = await db
    .prepare('SELECT timing, destination_kind, destination_id, status, error, created_at FROM notification_deliveries WHERE setting_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(settingId, limit)
    .all<{ timing: string; destination_kind: string; destination_id: string; status: string; error: string | null; created_at: string }>();
  return rows.results ?? [];
}
