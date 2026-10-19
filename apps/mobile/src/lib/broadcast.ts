// 一斉配信(アプリ)の、画面に依存しない部分。条件の組み立て・説明文・入力の確認。

/** サーバー(services/segment-query.ts)が受け取る条件 */
export interface SegmentRule {
  type: 'tag_exists' | 'tag_not_exists' | 'metadata_equals' | 'metadata_not_equals' | 'ref_code' | 'ref_code_not' | 'is_following';
  value: string | boolean | { key: string; value: string };
}

/** 友だち全員(友だち中の人)を数えるときの条件 */
export const ALL_FOLLOWING_CONDITION: SegmentCondition = { operator: 'AND', rules: [{ type: 'is_following', value: true }] };
export interface SegmentCondition {
  operator: 'AND' | 'OR';
  rules: SegmentRule[];
}

/** 画面で作る条件1つ */
export type RuleKind = 'tag_exists' | 'tag_not_exists' | 'field_equals' | 'field_not_equals' | 'inflow_is' | 'inflow_is_not';

export interface DraftRule {
  id: string;
  kind: RuleKind;
  tagId?: string;
  tagName?: string;
  fieldKey?: string;
  fieldLabel?: string;
  value?: string;
  /** 流入経路(ref_code)と、その名前 */
  refCode?: string;
  routeName?: string;
}

export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  tag_exists: 'タグがある',
  tag_not_exists: 'タグがない',
  field_equals: '友だち情報が一致する',
  field_not_equals: '友だち情報が一致しない',
  inflow_is: '流入経路が同じ',
  inflow_is_not: '流入経路が違う',
};

/** 条件を何個まで足せるか(多すぎると、画面でも人数の確認でも分かりにくい) */
export const MAX_RULES = 8;
/** LINE のテキストメッセージの上限 */
export const MAX_MESSAGE_LENGTH = 5000;

export function isRuleComplete(r: DraftRule): boolean {
  if (r.kind === 'tag_exists' || r.kind === 'tag_not_exists') return !!r.tagId;
  if (r.kind === 'inflow_is' || r.kind === 'inflow_is_not') return !!r.refCode;
  return !!r.fieldKey && !!r.value?.trim();
}

/** 画面の条件を、サーバーに送る形にする。完成した条件が1つも無ければ null(= 絞り込みなし) */
export function toSegmentConditions(operator: 'AND' | 'OR', rules: DraftRule[]): SegmentCondition | null {
  const done = rules.filter(isRuleComplete);
  if (done.length === 0) return null;
  return {
    operator,
    rules: done.map((r): SegmentRule => {
      switch (r.kind) {
        case 'tag_exists':
          return { type: 'tag_exists', value: r.tagId as string };
        case 'tag_not_exists':
          return { type: 'tag_not_exists', value: r.tagId as string };
        case 'inflow_is':
          return { type: 'ref_code', value: r.refCode as string };
        case 'inflow_is_not':
          return { type: 'ref_code_not', value: r.refCode as string };
        case 'field_equals':
          return { type: 'metadata_equals', value: { key: r.fieldKey as string, value: (r.value as string).trim() } };
        case 'field_not_equals':
          return { type: 'metadata_not_equals', value: { key: r.fieldKey as string, value: (r.value as string).trim() } };
      }
    }),
  };
}

/** 条件1つの説明(「タグ『常連』がある」など) */
export function describeRule(r: DraftRule): string {
  switch (r.kind) {
    case 'tag_exists':
      return `タグ「${r.tagName ?? '?'}」がある`;
    case 'tag_not_exists':
      return `タグ「${r.tagName ?? '?'}」がない`;
    case 'inflow_is':
      return `流入経路が「${r.routeName ?? '?'}」`;
    case 'inflow_is_not':
      return `流入経路が「${r.routeName ?? '?'}」ではない`;
    case 'field_equals':
      return `友だち情報「${r.fieldLabel ?? '?'}」が「${r.value ?? ''}」`;
    case 'field_not_equals':
      return `友だち情報「${r.fieldLabel ?? '?'}」が「${r.value ?? ''}」ではない`;
  }
}

/** サーバーに保存された条件(segmentConditions)の、履歴での説明。タグ名・項目名は保存していないので、種類と件数だけ */
export function describeSavedConditions(c: unknown): string | null {
  if (!c || typeof c !== 'object') return null;
  const cond = c as Partial<SegmentCondition>;
  if (!Array.isArray(cond.rules) || cond.rules.length === 0) return null;
  const rules = cond.rules.filter((r) => r && r.type !== ('is_following' as string));
  if (rules.length === 0) return null;
  return `条件で絞り込み(${rules.length}件・${cond.operator === 'OR' ? 'どれかを満たす' : 'すべて満たす'})`;
}

/** 一覧に出す題名: 本文の最初の行(最大20文字) + 日付。本文が空なら「一斉配信」 */
export function defaultTitle(message: string, now: Date): string {
  const first = (message.split(/\r?\n/).find((l) => l.trim()) ?? '').trim();
  const clipped = Array.from(first).slice(0, 20).join('');
  const date = `${now.getMonth() + 1}/${now.getDate()}`;
  return `${clipped || '一斉配信'}(${date})`;
}

export type MessageCheck = { ok: true } | { ok: false; reason: string };

export function checkMessage(text: string): MessageCheck {
  const body = text.trim();
  if (!body) return { ok: false, reason: 'メッセージを入力してください' };
  if (Array.from(body).length > MAX_MESSAGE_LENGTH) return { ok: false, reason: `メッセージは${MAX_MESSAGE_LENGTH.toLocaleString('ja-JP')}文字までです` };
  return { ok: true };
}

/* ────────────────── 配信するメッセージ(最大5通・上から順に届く) ────────────────── */

/** LINE の1回の配信に載せられるメッセージの上限 */
export const MAX_BROADCAST_MESSAGES = 5;

export type DraftKind = 'text' | 'image';

/** 画面で作るメッセージ1通。key は、並べ替えても入力欄の状態が混ざらないための印(送信しない) */
export interface DraftMessage {
  key: string;
  kind: DraftKind;
  /** テキスト: 本文(差し込み語・フォームのタグコードを含められる) */
  text: string;
  /** 画像: アップロード済みの画像のURL(https) */
  imageUrl: string | null;
}

export function newDraftMessage(kind: DraftKind = 'text', key: string = newUuid()): DraftMessage {
  return { key, kind, text: '', imageUrl: null };
}

/** サーバーに送る1通の形(POST /api/broadcasts の messages) */
export interface ApiMessage {
  type: 'text' | 'image';
  content: string;
}

/** 画面のメッセージを、サーバーに送る形にする(画像は、LINE が求める JSON の文字列) */
export function toApiMessages(messages: DraftMessage[]): ApiMessage[] {
  return messages.map((m): ApiMessage =>
    m.kind === 'image'
      ? { type: 'image', content: JSON.stringify({ originalContentUrl: m.imageUrl, previewImageUrl: m.imageUrl }) }
      : { type: 'text', content: m.text.trim() },
  );
}

/** サーバーが受け付ける差し込み語・タグ(これ以外の {{…}} は、送る前に止める) */
const KNOWN_TAG_RE = /^(name|real_name|liff_id|form_url:\S+)$/;
const ANY_TAG_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** 本文の中の、使えない {{…}} を探す(最初に見つかった分) */
export function findUnsupportedTag(text: string): string | null {
  for (const m of text.matchAll(ANY_TAG_RE)) {
    if (!KNOWN_TAG_RE.test(m[1].trim())) return `{{${m[1].trim()}}}`;
  }
  return null;
}

/** 全メッセージの確認。問題があれば、「◯通目: …」の日本語の理由を返す */
export function checkMessages(messages: DraftMessage[]): MessageCheck {
  if (messages.length === 0) return { ok: false, reason: 'メッセージを1通以上入れてください' };
  if (messages.length > MAX_BROADCAST_MESSAGES) return { ok: false, reason: `メッセージは${MAX_BROADCAST_MESSAGES}通までです` };
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const label = messages.length > 1 ? `${i + 1}通目: ` : '';
    if (m.kind === 'image') {
      if (!m.imageUrl) return { ok: false, reason: `${label}画像を選んでください` };
      continue;
    }
    const c = checkMessage(m.text);
    if (!c.ok) return { ok: false, reason: `${label}${c.reason}` };
    const bad = findUnsupportedTag(m.text);
    if (bad) return { ok: false, reason: `${label}使えない差し込み語があります(${bad})。「名前」「フォーム」のボタンから入れてください` };
  }
  return { ok: true };
}

/** 一覧・履歴に出す、メッセージ1通の短い説明(画像は「画像」) */
export function messageSummary(m: { type: string; content: string }): string {
  if (m.type === 'image') return '[画像]';
  if (m.type === 'flex') return '[Flexメッセージ]';
  return m.content.replace(/\s+/g, ' ');
}

/* ────────────────── 本文の中の差し込み語・フォームのタグ(色付きの枠で見せる) ────────────────── */

export type TagPart =
  | { kind: 'text'; text: string }
  | { kind: 'name' }
  | { kind: 'realName' }
  | { kind: 'form'; formId: string }
  | { kind: 'other'; code: string };

/** 本文を、ふつうの文字 / 名前の差し込み / フォームのタグ / その他の差し込み語 に分ける */
export function splitTags(text: string): TagPart[] {
  const parts: TagPart[] = [];
  let last = 0;
  for (const m of text.matchAll(ANY_TAG_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ kind: 'text', text: text.slice(last, idx) });
    const code = m[1].trim();
    if (code === 'name') parts.push({ kind: 'name' });
    else if (code === 'real_name') parts.push({ kind: 'realName' });
    else if (code.startsWith('form_url:')) parts.push({ kind: 'form', formId: code.slice('form_url:'.length) });
    else parts.push({ kind: 'other', code });
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** 入力欄に入れる、タグコード */
export const NAME_TAG = '{{name}}';
/** 本名(友だち情報の「本名」。未登録の人には、LINE名が入る) */
export const REAL_NAME_TAG = '{{real_name}}';
export function formTag(formId: string): string {
  return `{{form_url:${formId}}}`;
}

/** カーソル位置(選択範囲)に、文字を入れる。戻り値は、新しい本文と、入れたあとのカーソル位置 */
export function insertAtSelection(text: string, insert: string, selection: { start: number; end: number } | null): { text: string; cursor: number } {
  const start = selection ? Math.min(selection.start, selection.end) : text.length;
  const end = selection ? Math.max(selection.start, selection.end) : text.length;
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  return { text: text.slice(0, safeStart) + insert + text.slice(safeEnd), cursor: safeStart + insert.length };
}

export const BROADCAST_STATUS_LABEL: Record<string, string> = {
  draft: '下書き',
  scheduled: '予約中',
  sending: '配信中',
  sent: '配信済み',
};

export function broadcastStatusLabel(status: string): string {
  return BROADCAST_STATUS_LABEL[status] ?? status;
}

/** 送る前の確認ダイアログの本文 */
export function confirmSendMessage(accountName: string, count: number, narrowed: boolean, messageCount = 1, missingRealName = 0): string {
  const who = narrowed ? '条件に合う' : '友だち全員の';
  const how = messageCount > 1 ? `${messageCount}通のメッセージを上から順に、` : '';
  return `「${accountName}」の${who}${count.toLocaleString('ja-JP')}人に、${how}いますぐ送ります。${missingRealNameNote(missingRealName)}送ったあとは取り消せません。`;
}

/** 本名の差し込みを使うとき、本名が未登録の人(その人には LINE名が入る)がいれば、確認に添える一文 */
export function missingRealNameNote(missing: number): string {
  return missing > 0 ? `本名が未登録の${missing.toLocaleString('ja-JP')}人には、本名の代わりにLINE名が入ります。` : '';
}

/** どれかのテキストに、本名の差し込みがあるか */
export function usesRealName(messages: DraftMessage[]): boolean {
  return messages.some((m) => m.kind === 'text' && m.text.includes(REAL_NAME_TAG));
}

/** 予約するときの確認ダイアログの本文。送る人数は「いまの人数」(実際は、予約の時刻に、その時点の対象へ送る) */
export function confirmScheduleMessage(accountName: string, count: number, narrowed: boolean, whenLabel: string, messageCount = 1, missingRealName = 0): string {
  const who = narrowed ? '条件に合う' : '友だち全員の';
  const how = messageCount > 1 ? `${messageCount}通のメッセージを上から順に、` : '';
  return `「${accountName}」の${who}(いまは${count.toLocaleString('ja-JP')}人)に、${how}${whenLabel}に送るよう予約します。${missingRealNameNote(missingRealName)}送る人は、予約の時刻の時点の対象になります。予約は、配信の画面から取り消せます。`;
}

/** UUID v4(作成の二重実行を防ぐ Idempotency-Key 用。サーバーは UUID の形を求める) */
export function newUuid(random: () => number = Math.random): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const v = Math.floor(random() * 16);
    return (ch === 'x' ? v : (v & 0x3) | 0x8).toString(16);
  });
}

/** 同じ内容なら同じキー、内容が変わったら新しいキーにするための、内容の識別 */
export function draftSignature(parts: { accountId: string; messages: DraftMessage[] }): string {
  return `${parts.accountId}\n${JSON.stringify(toApiMessages(parts.messages))}`;
}
