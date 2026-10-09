// 表示用の整形(名前の優先順位・日時・吹き出し)。React Native に依存しない純粋な関数だけ。
import type { ChatEvent, ChatMessage, ChatStatus, FriendFieldDefinition, FriendRichMenu } from './types';

/** 友だちの表示名: 本名 > システム表示名 > LINE名(Web の resolveFriendName と同じ) */
export function resolveFriendName(f: {
  realName?: string | null;
  systemDisplayName?: string | null;
  displayName?: string | null;
}): string {
  return f.realName?.trim() || f.systemDisplayName?.trim() || f.displayName || '名前なし';
}

/** アイコンが無いときの頭文字 */
export function nameInitial(name: string): string {
  const ch = Array.from(name.trim())[0];
  return ch ?? '?';
}

export const STATUS_LABEL: Record<ChatStatus, string> = {
  unread: '未対応',
  in_progress: '対応中',
  resolved: '対応済み',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status as ChatStatus] ?? status;
}

// ── 日時(日本時間で表示する。端末のタイムゾーンに左右されない) ──

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** API の日時(+09:00 付き ISO)を Date にする。タイムゾーン指定がなければ日本時間とみなす。 */
export function parseApiDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  let s = value.trim();
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s = `${s.replace(' ', 'T')}+09:00`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface JstParts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  dow: number;
}

function jstParts(date: Date): JstParts {
  const j = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    y: j.getUTCFullYear(),
    m: j.getUTCMonth() + 1,
    d: j.getUTCDate(),
    h: j.getUTCHours(),
    min: j.getUTCMinutes(),
    dow: j.getUTCDay(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const dayNumber = (p: JstParts) => Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000);

/** 吹き出しの時刻 "18:05" */
export function formatTime(value: string | null | undefined): string {
  const d = parseApiDate(value);
  if (!d) return '';
  const p = jstParts(d);
  return `${pad2(p.h)}:${pad2(p.min)}`;
}

/** 日付の区切り "2026年10月3日(土)" */
export function formatDateSeparator(value: string | null | undefined): string {
  const d = parseApiDate(value);
  if (!d) return '';
  const p = jstParts(d);
  return `${p.y}年${p.m}月${p.d}日(${WEEKDAYS[p.dow]})`;
}

/** 日付の判定用キー "2026-10-03" */
export function dayKey(value: string | null | undefined): string {
  const d = parseApiDate(value);
  if (!d) return '';
  const p = jstParts(d);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** 一覧の時刻: 今日=18:05 / 昨日=昨日 / 今年=10/3 / それ以前=2025/12/31 */
export function formatListTime(value: string | null | undefined, now: Date = new Date()): string {
  const d = parseApiDate(value);
  if (!d) return '';
  const p = jstParts(d);
  const n = jstParts(now);
  const diff = dayNumber(n) - dayNumber(p);
  if (diff === 0) return `${pad2(p.h)}:${pad2(p.min)}`;
  if (diff === 1) return '昨日';
  if (p.y === n.y) return `${p.m}/${p.d}`;
  return `${p.y}/${p.m}/${p.d}`;
}

/** 詳細画面の日時 "2026/10/03 18:05" */
export function formatDateTime(value: string | null | undefined): string {
  const d = parseApiDate(value);
  if (!d) return '-';
  const p = jstParts(d);
  return `${p.y}/${pad2(p.m)}/${pad2(p.d)} ${pad2(p.h)}:${pad2(p.min)}`;
}

// ── メッセージ ──

const TYPE_LABEL: Record<string, string> = {
  text: '',
  image: '[画像]',
  sticker: '[スタンプ]',
  flex: '[カード]',
  form_answer: '[フォーム回答]',
  audio: '[音声]',
  video: '[動画]',
  file: '[ファイル]',
  location: '[位置情報]',
};

export function messageTypeLabel(type: string | null | undefined): string {
  if (!type) return '';
  return TYPE_LABEL[type] ?? `[${type}]`;
}

/** トーク一覧の最後のメッセージ(1行)。自分の送信には「あなた: 」を付ける。 */
export function messagePreview(chat: {
  lastMessageContent: string | null;
  lastMessageType: string | null;
  lastMessageDirection: 'incoming' | 'outgoing' | null;
}): string {
  const body =
    chat.lastMessageType && chat.lastMessageType !== 'text'
      ? messageTypeLabel(chat.lastMessageType)
      : (chat.lastMessageContent ?? '').replace(/\s+/g, ' ').trim();
  if (!body) return chat.lastMessageType ? messageTypeLabel(chat.lastMessageType) : '';
  return chat.lastMessageDirection === 'outgoing' ? `あなた: ${body}` : body;
}

/** Flex メッセージの中の text を集めて、カードの内容を短く文字で示す */
export function extractFlexText(content: string, maxLength = 120): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return '';
  }
  const texts: string[] = [];
  const walk = (node: unknown): void => {
    if (texts.join(' ').length > maxLength * 2) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (obj.type === 'text' && typeof obj.text === 'string' && obj.text.trim()) texts.push(obj.text.trim());
      for (const v of Object.values(obj)) if (v && typeof v === 'object') walk(v);
    }
  };
  walk(parsed);
  const joined = texts.join(' ');
  return joined.length > maxLength ? `${joined.slice(0, maxLength)}…` : joined;
}

export type BubbleKind = 'text' | 'image' | 'sticker' | 'flex' | 'formAnswer' | 'other';

/** トークに残る「回答結果を見る」カード(サーバーが決めた文言) */
export interface FormAnswerCard {
  formId: string;
  formName: string;
  submissionId: string;
  title: string;
  body: string;
  buttonLabel: string;
}

export function parseFormAnswerCard(content: string): FormAnswerCard | null {
  try {
    const v = JSON.parse(content) as Partial<FormAnswerCard> | null;
    if (!v || typeof v.formId !== 'string' || typeof v.submissionId !== 'string') return null;
    return {
      formId: v.formId,
      formName: typeof v.formName === 'string' ? v.formName : '',
      submissionId: v.submissionId,
      title: typeof v.title === 'string' ? v.title : '',
      body: typeof v.body === 'string' ? v.body : '',
      buttonLabel: typeof v.buttonLabel === 'string' && v.buttonLabel ? v.buttonLabel : '回答結果を見る',
    };
  } catch {
    return null;
  }
}

export interface Bubble {
  id: string;
  side: 'incoming' | 'outgoing';
  kind: BubbleKind;
  /** 本文、または画像・スタンプ等の代替表示 */
  text: string;
  /** 画像メッセージで URL が取れたとき */
  imageUrl: string | null;
  /** 拡大表示用の元画像の URL(取れなければ imageUrl と同じ) */
  fullImageUrl?: string | null;
  /** kind が formAnswer のとき、カードの内容 */
  formAnswer?: FormAnswerCard;
  time: string;
  createdAt: string;
}

function safeUrl(v: unknown): string | null {
  return typeof v === 'string' && /^https?:\/\//.test(v) ? v : null;
}

/** 画像メッセージの content(JSON)から、一覧用(preview)と拡大用(original)の URL を取り出す */
function parseImageUrls(content: string): { preview: string | null; full: string | null } {
  try {
    const parsed = JSON.parse(content) as { originalContentUrl?: unknown; previewImageUrl?: unknown };
    const preview = safeUrl(parsed.previewImageUrl) ?? safeUrl(parsed.originalContentUrl);
    const full = safeUrl(parsed.originalContentUrl) ?? preview;
    return { preview, full };
  } catch {
    return { preview: null, full: null };
  }
}

/** 1通のメッセージを、画面に出す吹き出しの形にする */
export function toBubble(m: ChatMessage): Bubble {
  const side = m.direction === 'outgoing' ? 'outgoing' : 'incoming';
  const base = { id: m.id, side, time: formatTime(m.createdAt), createdAt: m.createdAt } as const;
  switch (m.messageType) {
    case 'text':
      return { ...base, kind: 'text', text: m.content, imageUrl: null };
    case 'image': {
      const { preview, full } = parseImageUrls(m.content);
      return { ...base, kind: 'image', text: '[画像]', imageUrl: preview, fullImageUrl: full };
    }
    case 'sticker':
      return { ...base, kind: 'sticker', text: '[スタンプ]', imageUrl: null };
    case 'flex': {
      const summary = extractFlexText(m.content);
      return { ...base, kind: 'flex', text: summary ? `[カード] ${summary}` : '[カード]', imageUrl: null };
    }
    case 'form_answer': {
      const card = parseFormAnswerCard(m.content);
      if (!card) return { ...base, kind: 'other', text: '[フォーム回答]', imageUrl: null };
      return { ...base, kind: 'formAnswer', text: card.title || '[フォーム回答]', imageUrl: null, formAnswer: card };
    }
    default:
      return { ...base, kind: 'other', text: messageTypeLabel(m.messageType) || '[メッセージ]', imageUrl: null };
  }
}

/** 出来事のログ1行(中央の小さなグレーの行)。未知の type も同じ見た目 */
export interface EventRow {
  id: string;
  type: string;
  /** 本文 + 操作した人(あれば「 ・ 山田」) */
  text: string;
  time: string;
  createdAt: string;
}

export type ChatListItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'bubble'; key: string; bubble: Bubble }
  | { type: 'event'; key: string; event: EventRow };

export function toEventRow(e: ChatEvent): EventRow {
  const actor = e.actor?.trim();
  return {
    id: e.id,
    type: e.type,
    text: actor ? `${e.text} ・ ${actor}` : e.text,
    time: formatTime(e.createdAt),
    createdAt: e.createdAt,
  };
}

function timeMs(iso: string): number {
  return parseApiDate(iso)?.getTime() ?? 0;
}

/**
 * 古い順のメッセージと出来事を時刻順に混ぜ、日付の区切りを差し込んだ一覧にする。
 * 同時刻はメッセージが先。events が無い(undefined)ときはメッセージだけ。
 */
export function buildChatItems(messages: ChatMessage[], events?: ChatEvent[]): ChatListItem[] {
  type Entry = { at: string; order: number; item: ChatListItem };
  const entries: Entry[] = [];
  for (const m of messages) entries.push({ at: m.createdAt, order: 0, item: { type: 'bubble', key: m.id, bubble: toBubble(m) } });
  for (const e of events ?? []) entries.push({ at: e.createdAt, order: 1, item: { type: 'event', key: `event-${e.id}`, event: toEventRow(e) } });
  if (events && events.length > 0) {
    // 安定ソート: 時刻 → メッセージ優先 → 元の並び
    const indexed = entries.map((x, i) => ({ x, i }));
    indexed.sort((a, b) => timeMs(a.x.at) - timeMs(b.x.at) || a.x.order - b.x.order || a.i - b.i);
    entries.splice(0, entries.length, ...indexed.map((y) => y.x));
  }
  const items: ChatListItem[] = [];
  let lastDay = '';
  for (const { at, item } of entries) {
    const day = dayKey(at);
    if (day && day !== lastDay) {
      items.push({ type: 'date', key: `date-${day}`, label: formatDateSeparator(at) });
      lastDay = day;
    }
    items.push(item);
  }
  return items;
}

/** ポーリングで取り直したメッセージが、いまの表示と同じか(同じなら再描画しない) */
export function sameMessages(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  return a[a.length - 1].id === b[b.length - 1].id && a[0].id === b[0].id;
}

/** 出来事のログが、いまの表示と同じか(undefined は空と同じ。件数・先頭と末尾の id・本文で比べる) */
export function sameEvents(a: ChatEvent[] | undefined, b: ChatEvent[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  if (x.length === 0) return true;
  const last = x.length - 1;
  return x[0].id === y[0].id && x[last].id === y[last].id && x[last].text === y[last].text;
}

// ── 友だち詳細 ──

export interface InfoRow {
  key: string;
  label: string;
  value: string;
}

function fieldValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    return value.includes('/api/form-uploads/') ? '(添付ファイルあり)' : value.trim();
  }
  if (Array.isArray(value)) return value.map(fieldValueText).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** 友だち情報欄: 値が入っている項目だけ、定義の並び順で */
export function buildInfoRows(
  metadata: Record<string, unknown> | null | undefined,
  defs: FriendFieldDefinition[],
): InfoRow[] {
  const rows: InfoRow[] = [];
  const sorted = [...defs].sort((a, b) => a.displayOrder - b.displayOrder);
  for (const def of sorted) {
    const value = fieldValueText(metadata?.[def.fieldKey]);
    if (value) rows.push({ key: def.fieldKey, label: def.label, value });
  }
  return rows;
}

export interface RichMenuView {
  state: 'none' | 'set';
  title: string;
  badge: string;
  details: string[];
}

/** リッチメニューの表示内容(Web の FriendRichMenuView と同じ文言) */
export function describeRichMenu(menu: FriendRichMenu): RichMenuView {
  if (menu.id === null) {
    return { state: 'none', title: 'リッチメニューは設定されていません', badge: '', details: [] };
  }
  const details: string[] = [];
  if (menu.groupName) details.push(`グループ: ${menu.groupName}`);
  if (menu.pageName) details.push(`ページ: ${menu.pageName}`);
  if (menu.chatBarText) details.push(`メニューバー: ${menu.chatBarText}`);
  return {
    state: 'set',
    title: menu.name ?? '(名前なし)',
    badge: menu.isDefault ? 'デフォルト' : '個別に設定',
    details,
  };
}
