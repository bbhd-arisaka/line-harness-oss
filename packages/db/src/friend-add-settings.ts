/**
 * 友だち追加時設定(Lステップの「友だち追加時設定」)。公式アカウントごとに2区分:
 *   new       新規友だち(システム導入後に、はじめてフォローした人)
 *   returning すでに名簿にいる人が、またフォローしたとき(システム導入前からの友だち・ブロックを解除した友だち)
 * それぞれ「登録するシナリオ」と「その他のアクション」(Lステップの「アクション設定」と同じ並び)を持つ。
 */

export type FriendAddKind = 'new' | 'returning';

/** 送信タイミング(テキスト・テンプレートの送信だけ) */
export type FriendAddTiming =
  | { mode: 'now' }
  /** 送信を遅らせる(友だち追加から、○分/○時間/○日後) */
  | { mode: 'delay'; amount: number; unit: 'minutes' | 'hours' | 'days' }
  /** 時刻を指定する(友だち追加の○日後の、HH:MM。日本時間。0日後で、すでに過ぎていれば翌日) */
  | { mode: 'at'; days: number; time: string };

export type FriendAddActionType =
  | 'rich_menu' // メニュー操作
  | 'text' // テキスト送信
  | 'template' // テンプレート送信
  | 'tag' // タグ操作
  | 'friend_field' // 友だち情報操作
  | 'reminder' // リマインダ操作
  | 'conversion'; // コンバージョン操作

export interface FriendAddAction {
  type: FriendAddActionType;
  params: Record<string, unknown>;
  /** 条件ON: この友だちが条件(友だち絞り込み)に合うときだけ実行する。null なら条件なし。中身は worker 側で検証する */
  condition: Record<string, unknown> | null;
  /** テキスト・テンプレートの送信タイミング。省略は「すぐに」 */
  timing?: FriendAddTiming;
}

export interface FriendAddSetting {
  lineAccountId: string;
  kind: FriendAddKind;
  scenarioId: string | null;
  actions: FriendAddAction[];
  updatedAt: string | null;
}

export class FriendAddSettingError extends Error {}

const MAX_ACTIONS = 30;
const MAX_TEXT = 4500;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const str = (v: unknown, label: string, max = 100): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new FriendAddSettingError(`${label}を選んでください`);
  return v.trim();
};

function parseTiming(raw: unknown): FriendAddTiming | undefined {
  if (raw === undefined || raw === null) return undefined;
  const t = raw as { mode?: unknown; amount?: unknown; unit?: unknown; days?: unknown; time?: unknown };
  if (t.mode === 'now') return { mode: 'now' };
  if (t.mode === 'delay') {
    const amount = Number(t.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 9999) throw new FriendAddSettingError('送信を遅らせる時間は、1以上の整数で入力してください');
    if (t.unit !== 'minutes' && t.unit !== 'hours' && t.unit !== 'days') throw new FriendAddSettingError('遅らせる単位(分・時間・日)を選んでください');
    return { mode: 'delay', amount, unit: t.unit };
  }
  if (t.mode === 'at') {
    const days = Number(t.days);
    if (!Number.isInteger(days) || days < 0 || days > 365) throw new FriendAddSettingError('日数は、0〜365の整数で入力してください');
    if (typeof t.time !== 'string' || !TIME.test(t.time)) throw new FriendAddSettingError('時刻は、09:00 の形で入力してください');
    return { mode: 'at', days, time: t.time };
  }
  throw new FriendAddSettingError('送信タイミングが正しくありません');
}

export function parseFriendAddActions(raw: unknown): FriendAddAction[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new FriendAddSettingError('アクションの形が正しくありません');
  if (raw.length > MAX_ACTIONS) throw new FriendAddSettingError(`アクションは${MAX_ACTIONS}個までです`);
  const out: FriendAddAction[] = [];
  for (const item of raw as Array<{ type?: unknown; params?: Record<string, unknown>; condition?: unknown; timing?: unknown }>) {
    const p = item?.params ?? {};
    const condition = item?.condition && typeof item.condition === 'object' ? (item.condition as Record<string, unknown>) : null;
    let action: FriendAddAction;
    switch (item?.type) {
      case 'rich_menu':
        action = { type: 'rich_menu', params: { menu: str(p.menu, 'メニュー') }, condition };
        break;
      case 'text': {
        const content = typeof p.content === 'string' ? p.content : '';
        if (!content.trim()) throw new FriendAddSettingError('テキスト送信のメッセージを入力してください');
        if (content.length > MAX_TEXT) throw new FriendAddSettingError(`テキスト送信は${MAX_TEXT}文字以内で入力してください`);
        action = { type: 'text', params: { content }, condition, timing: parseTiming(item.timing) };
        break;
      }
      case 'template':
        action = { type: 'template', params: { templateId: str(p.templateId, 'テンプレート') }, condition, timing: parseTiming(item.timing) };
        break;
      case 'tag': {
        const ids = Array.isArray(p.tagIds) ? [...new Set((p.tagIds as unknown[]).map((x) => str(x, 'タグ')))] : [];
        if (ids.length === 0) throw new FriendAddSettingError('タグ操作のタグを選んでください');
        if (p.op !== 'add' && p.op !== 'remove') throw new FriendAddSettingError('タグを追加するか、はずすかを選んでください');
        action = { type: 'tag', params: { op: p.op, tagIds: ids }, condition };
        break;
      }
      case 'friend_field': {
        if (p.op !== 'set' && p.op !== 'add' && p.op !== 'sub') throw new FriendAddSettingError('友だち情報操作の操作内容が正しくありません');
        const value = typeof p.value === 'string' ? p.value : String(p.value ?? '');
        if (value.length > 500) throw new FriendAddSettingError('友だち情報操作の値は500文字以内で入力してください');
        if ((p.op === 'add' || p.op === 'sub') && !Number.isFinite(Number(value))) throw new FriendAddSettingError('加算・減算の値は、数字で入力してください');
        action = { type: 'friend_field', params: { fieldKey: str(p.fieldKey, '友だち情報欄'), op: p.op, value }, condition };
        break;
      }
      case 'reminder':
        if (p.op !== 'start' && p.op !== 'cancel') throw new FriendAddSettingError('リマインダを開始するか、キャンセルするかを選んでください');
        action = { type: 'reminder', params: { op: p.op, reminderId: str(p.reminderId, 'リマインダ') }, condition };
        break;
      case 'conversion':
        action = { type: 'conversion', params: { conversionPointId: str(p.conversionPointId, 'コンバージョン') }, condition };
        break;
      default:
        throw new FriendAddSettingError('未対応のアクションが含まれています');
    }
    out.push(action);
  }
  return out;
}

interface Row {
  line_account_id: string;
  kind: FriendAddKind;
  scenario_id: string | null;
  actions: string;
  updated_at: string;
}

function toSetting(r: Row): FriendAddSetting {
  let actions: FriendAddAction[] = [];
  try {
    actions = JSON.parse(r.actions) as FriendAddAction[];
  } catch {
    actions = [];
  }
  return { lineAccountId: r.line_account_id, kind: r.kind, scenarioId: r.scenario_id, actions, updatedAt: r.updated_at };
}

/** 2区分とも返す(まだ保存されていない区分は、空の設定) */
export async function getFriendAddSettings(db: D1Database, lineAccountId: string): Promise<Record<FriendAddKind, FriendAddSetting>> {
  const rows = await db
    .prepare('SELECT line_account_id, kind, scenario_id, actions, updated_at FROM friend_add_settings WHERE line_account_id = ?')
    .bind(lineAccountId)
    .all<Row>();
  const empty = (kind: FriendAddKind): FriendAddSetting => ({ lineAccountId, kind, scenarioId: null, actions: [], updatedAt: null });
  const result: Record<FriendAddKind, FriendAddSetting> = { new: empty('new'), returning: empty('returning') };
  for (const r of rows.results ?? []) result[r.kind] = toSetting(r);
  return result;
}

export async function saveFriendAddSetting(
  db: D1Database,
  lineAccountId: string,
  kind: FriendAddKind,
  input: { scenarioId?: unknown; actions?: unknown },
): Promise<FriendAddSetting> {
  const actions = parseFriendAddActions(input.actions);
  const scenarioId = typeof input.scenarioId === 'string' && input.scenarioId.trim() ? input.scenarioId.trim() : null;
  if (scenarioId) {
    const sc = await db.prepare('SELECT id, line_account_id FROM scenarios WHERE id = ?').bind(scenarioId).first<{ id: string; line_account_id: string | null }>();
    if (!sc || (sc.line_account_id && sc.line_account_id !== lineAccountId)) throw new FriendAddSettingError('このアカウントで使えるシナリオを選んでください');
  }
  await db
    .prepare(
      `INSERT INTO friend_add_settings (id, line_account_id, kind, scenario_id, actions)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (line_account_id, kind) DO UPDATE SET scenario_id = excluded.scenario_id, actions = excluded.actions,
         updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
    )
    .bind(crypto.randomUUID(), lineAccountId, kind, scenarioId, JSON.stringify(actions))
    .run();
  return (await getFriendAddSettings(db, lineAccountId))[kind];
}

/** 送信タイミングから、実行する時刻(日本時間のISO形式。例 2026-10-07T10:00:00.000)を求める。「すぐに」は null */
export function resolveDeferredRunAt(timing: FriendAddTiming | undefined, base: Date = new Date()): string | null {
  if (!timing || timing.mode === 'now') return null;
  const JST = 9 * 3600 * 1000;
  const iso = (ms: number) => new Date(ms + JST).toISOString().slice(0, 23);
  if (timing.mode === 'delay') {
    const unitMs = timing.unit === 'minutes' ? 60_000 : timing.unit === 'hours' ? 3_600_000 : 86_400_000;
    return iso(base.getTime() + timing.amount * unitMs);
  }
  const [hh, mm] = timing.time.split(':').map(Number);
  const nowJst = new Date(base.getTime() + JST);
  let target = Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate() + timing.days, hh, mm) - JST;
  // 今日(0日後)で、すでに過ぎた時刻なら、翌日にする
  if (timing.days === 0 && target <= base.getTime()) target += 86_400_000;
  return iso(target);
}
