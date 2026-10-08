/**
 * 友だちリストの「詳細検索」(Lステップの「絞り込み条件を設定」相当)の条件を、SQL の条件に変換する。
 *
 * 条件は、
 *   and : 「すべて満たす」必要がある条件(and条件)
 *   or  : 「いずれか1つ以上を満たす」必要がある条件(or条件)のグループ(複数可。グループごとに、どれか1つ満たせばよい)
 * の組み合わせ。and の全部 と、各 or グループの「どれか」を、すべて満たす友だちが結果になる。
 *
 * ユーザーの入力は、必ずプレースホルダ(?)で渡す。友だち情報欄のキーだけは JSON パスに使うため、
 * 英数字・_・- に限って受け付ける。
 */

export class FilterError extends Error {}

export type TagMode = 'any' | 'all' | 'none_any' | 'none_all';
export type FieldOp = 'eq' | 'contains' | 'exists' | 'missing' | 'neq' | 'ncontains' | 'gte' | 'gt' | 'lte' | 'lt';
export type NameTarget = 'display' | 'real' | 'system';
export type ChatStatusValue = 'unread' | 'in_progress' | 'resolved';
export type ScenarioState = 'active' | 'ever' | 'none';

export type FriendCondition =
  | { type: 'name'; value: string; targets: NameTarget[] }
  | { type: 'memo'; op: 'contains' | 'not_contains' | 'exists' | 'missing'; value: string }
  | { type: 'statusMessage'; value: string }
  | { type: 'addedDate'; from: string | null; to: string | null }
  | { type: 'chatStatus'; statuses: ChatStatusValue[] }
  | { type: 'tag'; tagIds: string[]; mode: TagMode }
  | { type: 'field'; fieldKey: string; op: FieldOp; value: string }
  | { type: 'scenario'; scenarioId: string; state: ScenarioState }
  | { type: 'form'; formId: string; answered: boolean }
  | { type: 'lastReaction'; from: string | null; to: string | null }
  | { type: 'inflow'; value: string }
  | { type: 'reserve'; calendarId: string; state: ReserveState; slotId: string | null; courseId: string | null };

export interface FriendFilter {
  and: FriendCondition[];
  or: FriendCondition[][];
  /** 表示設定。既定は「ブロックしていない友だち」だけ */
  showFollowing: boolean;
  showBlocked: boolean;
}

export type ReserveState = 'booked' | 'ever' | 'visited' | 'none';
const RESERVE_STATES: readonly ReserveState[] = ['booked', 'ever', 'visited', 'none'];

const MAX_CONDITIONS = 40;
const MAX_TEXT = 200;
const MAX_TAGS = 200;
const FIELD_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_OPS: readonly FieldOp[] = ['eq', 'contains', 'exists', 'missing', 'neq', 'ncontains', 'gte', 'gt', 'lte', 'lt'];
const TAG_MODES: readonly TagMode[] = ['any', 'all', 'none_any', 'none_all'];
const NAME_TARGETS: readonly NameTarget[] = ['display', 'real', 'system'];
const CHAT_STATUSES: readonly ChatStatusValue[] = ['unread', 'in_progress', 'resolved'];

const text = (v: unknown, label: string, max = MAX_TEXT): string => {
  if (typeof v !== 'string') throw new FilterError(`${label}は文字で指定してください`);
  if (v.length > max) throw new FilterError(`${label}は${max}文字以内で指定してください`);
  return v;
};
const id = (v: unknown, label: string): string => {
  if (typeof v !== 'string' || !v || v.length > 64) throw new FilterError(`${label}が正しくありません`);
  return v;
};
const date = (v: unknown, label: string): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !DATE.test(v)) throw new FilterError(`${label}は YYYY-MM-DD で指定してください`);
  return v;
};

function parseCondition(x: unknown): FriendCondition {
  const c = x as Record<string, unknown> | null;
  if (!c || typeof c !== 'object') throw new FilterError('条件の形式が正しくありません');
  switch (c.type) {
    case 'name': {
      const targets = Array.isArray(c.targets) ? (c.targets as unknown[]).filter((t): t is NameTarget => NAME_TARGETS.includes(t as NameTarget)) : [];
      if (!targets.length) throw new FilterError('名前は、検索する対象(LINE登録名・本名・システム表示名)を1つ以上選んでください');
      return { type: 'name', value: text(c.value ?? '', '名前'), targets: [...new Set(targets)] };
    }
    case 'memo': {
      const op = c.op;
      if (op !== 'contains' && op !== 'not_contains' && op !== 'exists' && op !== 'missing') throw new FilterError('個別メモの条件が正しくありません');
      return { type: 'memo', op, value: text(c.value ?? '', '個別メモ') };
    }
    case 'statusMessage':
      return { type: 'statusMessage', value: text(c.value ?? '', 'ステータスメッセージ') };
    case 'addedDate':
      return { type: 'addedDate', from: date(c.from, '友だち登録日(開始)'), to: date(c.to, '友だち登録日(終了)') };
    case 'chatStatus': {
      const statuses = Array.isArray(c.statuses) ? (c.statuses as unknown[]).filter((s): s is ChatStatusValue => CHAT_STATUSES.includes(s as ChatStatusValue)) : [];
      if (!statuses.length) throw new FilterError('対応マークを1つ以上選んでください');
      return { type: 'chatStatus', statuses: [...new Set(statuses)] };
    }
    case 'tag': {
      if (!Array.isArray(c.tagIds) || !c.tagIds.length) throw new FilterError('タグを1つ以上選んでください');
      if (c.tagIds.length > MAX_TAGS) throw new FilterError('タグが多すぎます');
      if (!TAG_MODES.includes(c.mode as TagMode)) throw new FilterError('タグの条件が正しくありません');
      return { type: 'tag', tagIds: [...new Set((c.tagIds as unknown[]).map((t) => id(t, 'タグ')))], mode: c.mode as TagMode };
    }
    case 'field': {
      if (typeof c.fieldKey !== 'string' || !FIELD_KEY.test(c.fieldKey)) throw new FilterError('友だち情報欄が正しくありません');
      if (!FIELD_OPS.includes(c.op as FieldOp)) throw new FilterError('友だち情報の条件が正しくありません');
      const op = c.op as FieldOp;
      const value = text(c.value ?? '', '友だち情報の値');
      if (op !== 'exists' && op !== 'missing' && value === '') throw new FilterError('友だち情報の値を入力してください');
      return { type: 'field', fieldKey: c.fieldKey, op, value };
    }
    case 'scenario': {
      if (c.state !== 'active' && c.state !== 'ever' && c.state !== 'none') throw new FilterError('シナリオの条件が正しくありません');
      return { type: 'scenario', scenarioId: id(c.scenarioId, 'シナリオ'), state: c.state };
    }
    case 'form':
      return { type: 'form', formId: id(c.formId, 'フォーム'), answered: c.answered !== false };
    case 'lastReaction':
      return { type: 'lastReaction', from: date(c.from, '最終反応日(開始)'), to: date(c.to, '最終反応日(終了)') };
    case 'inflow':
      return { type: 'inflow', value: text(c.value ?? '', '流入経路') };
    case 'reserve': {
      if (!RESERVE_STATES.includes(c.state as ReserveState)) throw new FilterError('カレンダー予約の条件が正しくありません');
      return {
        type: 'reserve',
        calendarId: id(c.calendarId, 'カレンダー'),
        state: c.state as ReserveState,
        slotId: c.slotId ? id(c.slotId, '予約枠') : null,
        courseId: c.courseId ? id(c.courseId, 'コース') : null,
      };
    }
    default:
      throw new FilterError('未対応の条件です');
  }
}

/** 画面から来た条件(JSON)を検証して、型のついた条件にする。不正なら FilterError。 */
export function parseFriendFilter(x: unknown): FriendFilter {
  const f = (x ?? {}) as Record<string, unknown>;
  if (typeof f !== 'object' || Array.isArray(f)) throw new FilterError('検索条件の形式が正しくありません');
  const and = Array.isArray(f.and) ? (f.and as unknown[]).map(parseCondition) : [];
  const or = Array.isArray(f.or)
    ? (f.or as unknown[]).map((g) => {
        if (!Array.isArray(g)) throw new FilterError('or条件の形式が正しくありません');
        return (g as unknown[]).map(parseCondition);
      }).filter((g) => g.length > 0)
    : [];
  const total = and.length + or.reduce((n, g) => n + g.length, 0);
  if (total > MAX_CONDITIONS) throw new FilterError(`条件は${MAX_CONDITIONS}個までです`);
  const showFollowing = f.showFollowing === undefined ? true : f.showFollowing === true;
  const showBlocked = f.showBlocked === true;
  return { and, or, showFollowing, showBlocked };
}

const esc = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
const like = (s: string) => `%${esc(s)}%`;

interface Piece { sql: string; binds: unknown[] }

const NAME_COL: Record<NameTarget, string> = { display: 'f.display_name', real: 'f.real_name', system: 'f.system_display_name' };
const FIELD_VALUE = (): string => "CAST(json_extract(f.metadata, '$.' || ?) AS TEXT)";

function conditionSql(c: FriendCondition): Piece {
  switch (c.type) {
    case 'name': {
      // 半角スペース区切りは「いずれかにあてはまる」
      const tokens = c.value.split(/ +/).filter(Boolean);
      if (!tokens.length) return { sql: '1=1', binds: [] };
      const cols = c.targets.map((t) => NAME_COL[t]);
      const parts: string[] = [];
      const binds: unknown[] = [];
      for (const tk of tokens) {
        for (const col of cols) { parts.push(`${col} LIKE ? ESCAPE '\\'`); binds.push(like(tk)); }
      }
      return { sql: `(${parts.join(' OR ')})`, binds };
    }
    case 'memo':
      if (c.op === 'exists') return { sql: "(f.memo IS NOT NULL AND f.memo != '')", binds: [] };
      if (c.op === 'missing') return { sql: "(f.memo IS NULL OR f.memo = '')", binds: [] };
      if (c.op === 'contains') return { sql: "f.memo LIKE ? ESCAPE '\\'", binds: [like(c.value)] };
      return { sql: "(f.memo IS NULL OR f.memo NOT LIKE ? ESCAPE '\\')", binds: [like(c.value)] };
    case 'statusMessage':
      return { sql: "f.status_message LIKE ? ESCAPE '\\'", binds: [like(c.value)] };
    case 'addedDate': {
      const parts: string[] = [];
      const binds: unknown[] = [];
      if (c.from) { parts.push('substr(f.created_at, 1, 10) >= ?'); binds.push(c.from); }
      if (c.to) { parts.push('substr(f.created_at, 1, 10) <= ?'); binds.push(c.to); }
      return { sql: parts.length ? `(${parts.join(' AND ')})` : '1=1', binds };
    }
    case 'chatStatus':
      return {
        sql: `COALESCE((SELECT status FROM chats ch WHERE ch.friend_id = f.id ORDER BY ch.created_at DESC LIMIT 1), 'resolved') IN (${c.statuses.map(() => '?').join(',')})`,
        binds: [...c.statuses],
      };
    case 'tag': {
      const ph = c.tagIds.map(() => '?').join(',');
      const any = `EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id IN (${ph}))`;
      const all = `(SELECT COUNT(DISTINCT ft.tag_id) FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id IN (${ph})) = ?`;
      if (c.mode === 'any') return { sql: any, binds: [...c.tagIds] };
      if (c.mode === 'none_any') return { sql: `NOT ${any}`, binds: [...c.tagIds] };
      if (c.mode === 'all') return { sql: all, binds: [...c.tagIds, c.tagIds.length] };
      return { sql: `NOT (${all})`, binds: [...c.tagIds, c.tagIds.length] };
    }
    case 'field': {
      const v = FIELD_VALUE();
      const k = c.fieldKey;
      switch (c.op) {
        case 'exists': return { sql: `(${v} IS NOT NULL AND ${v} != '')`, binds: [k, k] };
        case 'missing': return { sql: `(${v} IS NULL OR ${v} = '')`, binds: [k, k] };
        case 'eq': return { sql: `${v} = ?`, binds: [k, c.value] };
        case 'neq': return { sql: `(${v} IS NULL OR ${v} != ?)`, binds: [k, k, c.value] };
        case 'contains': return { sql: `${v} LIKE ? ESCAPE '\\'`, binds: [k, like(c.value)] };
        case 'ncontains': return { sql: `(${v} IS NULL OR ${v} NOT LIKE ? ESCAPE '\\')`, binds: [k, k, like(c.value)] };
        default: {
          const op = { gte: '>=', gt: '>', lte: '<=', lt: '<' }[c.op];
          // 数字どうしなら数値で、そうでなければ文字(日付は YYYY-MM-DD なので文字で並べて比べられる)で比べる
          if (c.value.trim() !== '' && Number.isFinite(Number(c.value))) {
            return { sql: `(${v} IS NOT NULL AND ${v} != '' AND CAST(${v} AS REAL) ${op} ?)`, binds: [k, k, k, Number(c.value)] };
          }
          return { sql: `(${v} IS NOT NULL AND ${v} != '' AND ${v} ${op} ?)`, binds: [k, k, k, c.value] };
        }
      }
    }
    case 'scenario':
      if (c.state === 'none') return { sql: 'NOT EXISTS (SELECT 1 FROM friend_scenarios fs WHERE fs.friend_id = f.id AND fs.scenario_id = ?)', binds: [c.scenarioId] };
      if (c.state === 'ever') return { sql: 'EXISTS (SELECT 1 FROM friend_scenarios fs WHERE fs.friend_id = f.id AND fs.scenario_id = ?)', binds: [c.scenarioId] };
      return { sql: "EXISTS (SELECT 1 FROM friend_scenarios fs WHERE fs.friend_id = f.id AND fs.scenario_id = ? AND fs.status IN ('active', 'delivering'))", binds: [c.scenarioId] };
    case 'form': {
      const e = 'EXISTS (SELECT 1 FROM form_submissions sub WHERE sub.friend_id = f.id AND sub.form_id = ?)';
      return { sql: c.answered ? e : `NOT ${e}`, binds: [c.formId] };
    }
    case 'lastReaction': {
      const last = "(SELECT MAX(substr(m.created_at, 1, 10)) FROM messages_log m WHERE m.friend_id = f.id AND m.direction = 'incoming')";
      const parts: string[] = [`${last} IS NOT NULL`];
      const binds: unknown[] = [];
      if (c.from) { parts.push(`${last} >= ?`); binds.push(c.from); }
      if (c.to) { parts.push(`${last} <= ?`); binds.push(c.to); }
      return { sql: `(${parts.join(' AND ')})`, binds };
    }
    case 'reserve': {
      const parts = ['rb.friend_id = f.id', 'rb.calendar_id = ?', 'rb.is_block = 0'];
      const binds: unknown[] = [c.calendarId];
      if (c.slotId) { parts.push('rb.slot_id = ?'); binds.push(c.slotId); }
      if (c.courseId) { parts.push('rb.course_id = ?'); binds.push(c.courseId); }
      if (c.state === 'booked') parts.push("rb.status IN ('confirmed', 'pending')", "rb.ends_at >= strftime('%Y-%m-%dT%H:%M', 'now', '+9 hours')");
      else if (c.state === 'visited') parts.push("rb.status = 'confirmed'", 'rb.visited = 1');
      else parts.push("rb.status IN ('confirmed', 'pending')");
      const e = `EXISTS (SELECT 1 FROM reserve_bookings rb WHERE ${parts.join(' AND ')})`;
      return { sql: c.state === 'none' ? `NOT ${e}` : e, binds };
    }
    case 'inflow':
      return {
        sql: "(f.ref_code LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM tracked_links tl WHERE tl.id = f.first_tracked_link_id AND tl.name LIKE ? ESCAPE '\\'))",
        binds: [like(c.value), like(c.value)],
      };
  }
}

/** 友だち(テーブル別名 f)に対する WHERE 条件の部品を返す(条件が無ければ空配列)。呼び出し側で AND につなぐ。 */
export function buildFriendFilterPieces(filter: FriendFilter): Piece[] {
  const pieces: Piece[] = [];
  for (const c of filter.and) pieces.push(conditionSql(c));
  for (const group of filter.or) {
    const gp = group.map(conditionSql);
    pieces.push({ sql: `(${gp.map((p) => p.sql).join(' OR ')})`, binds: gp.flatMap((p) => p.binds) });
  }
  // 表示設定: どちらも選ばなければ何も出ない。両方なら全員
  if (filter.showFollowing && !filter.showBlocked) pieces.push({ sql: 'f.is_following = 1', binds: [] });
  else if (!filter.showFollowing && filter.showBlocked) pieces.push({ sql: 'f.is_following = 0', binds: [] });
  else if (!filter.showFollowing && !filter.showBlocked) pieces.push({ sql: '1 = 0', binds: [] });
  return pieces;
}
