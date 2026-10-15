import type { Message } from '@line-crm/line-sdk';
import { expandFormLinks } from './form-link.js';
import {
  assertNoUnresolvedBroadcastVariables,
  getUnsupportedBroadcastVariables,
  hasRecipientVariables,
  renderBroadcastMessageContent,
} from './render-message.js';

/**
 * 【一斉配信は、1回に最大5通まで】
 * LINE の push / multicast / broadcast は、1リクエストに最大5通のメッセージを載せられる。上から順に届く。
 * 1通目は従来どおり broadcasts.message_type / message_content、2通目以降(最大4通)は extra_messages(JSON)に入れる。
 * こうして、1通だけの配信(これまでの全部)は、1文字も変えずに動く。
 */
export const MAX_BROADCAST_MESSAGES = 5;
/** LINE のテキストメッセージの上限(文字数) */
export const MAX_TEXT_LENGTH = 5000;

export type BroadcastMessageKind = 'text' | 'image' | 'flex';

export interface BroadcastMessageItem {
  type: BroadcastMessageKind;
  content: string;
  /** Flex の通知文(省略可) */
  altText?: string | null;
}

const KINDS = new Set<string>(['text', 'image', 'flex']);

/** extra_messages 列(JSON 文字列)を読む。壊れていたら空(=追加なし)として扱う */
export function parseExtraMessages(raw: unknown): BroadcastMessageItem[] {
  if (!raw) return [];
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: BroadcastMessageItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    if (typeof m.type !== 'string' || !KINDS.has(m.type) || typeof m.content !== 'string') continue;
    out.push({ type: m.type as BroadcastMessageKind, content: m.content, altText: typeof m.altText === 'string' ? m.altText : null });
  }
  return out.slice(0, MAX_BROADCAST_MESSAGES - 1);
}

export function serializeExtraMessages(items: BroadcastMessageItem[]): string | null {
  return items.length === 0
    ? null
    : JSON.stringify(items.map((m) => ({ type: m.type, content: m.content, ...(m.altText ? { altText: m.altText } : {}) })));
}

interface BroadcastLike {
  message_type: string;
  message_content: string;
  alt_text?: string | null;
  extra_messages?: string | null;
}

/** 配信の全メッセージ(1通目+2通目以降)。順番がそのまま配信順 */
export function allBroadcastMessages(b: BroadcastLike): BroadcastMessageItem[] {
  return [
    { type: b.message_type as BroadcastMessageKind, content: b.message_content, altText: b.alt_text ?? null },
    ...parseExtraMessages(b.extra_messages),
  ];
}

export function broadcastMessageCount(b: BroadcastLike): number {
  return 1 + parseExtraMessages(b.extra_messages).length;
}

/** 全メッセージの本文(変数の検査用) */
export function allBroadcastContents(b: BroadcastLike): string[] {
  return allBroadcastMessages(b).map((m) => m.content);
}

/** どれかに、友だちごとに変わる変数({{name}})があるか(あれば、1人ずつ push で送る) */
export function broadcastHasRecipientVariables(b: BroadcastLike): boolean {
  return allBroadcastContents(b).some((c) => hasRecipientVariables(c));
}

/** 全メッセージの中から、未対応の変数を探す(最初に見つかった本文の分) */
export function firstUnsupportedVariables(b: BroadcastLike): string[] {
  for (const c of allBroadcastContents(b)) {
    const u = getUnsupportedBroadcastVariables(c);
    if (u.length > 0) return u;
  }
  return [];
}

function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/** 1通の中身の検査。問題があれば、画面にそのまま出せる日本語の理由を返す */
export function validateMessageItem(m: BroadcastMessageItem, position: number): string | null {
  const label = `${position}通目`;
  if (!KINDS.has(m.type)) return `${label}: メッセージの種類が正しくありません`;
  if (typeof m.content !== 'string' || m.content.trim() === '') return `${label}: 内容が空です`;
  const unsupported = getUnsupportedBroadcastVariables(m.content);
  if (unsupported.length > 0) return `${label}: 使えない差し込み語があります(${unsupported.map((v) => `{{${v}}}`).join('、')})`;
  if (m.type === 'text') {
    if (Array.from(m.content).length > MAX_TEXT_LENGTH) return `${label}: 文字数が多すぎます(${MAX_TEXT_LENGTH}文字まで)`;
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(m.content);
  } catch {
    return `${label}: ${m.type === 'image' ? '画像' : 'Flex'}の内容(JSON)が正しくありません`;
  }
  if (m.type === 'image') {
    const p = parsed as { originalContentUrl?: unknown; previewImageUrl?: unknown } | null;
    if (!p || !isHttpsUrl(p.originalContentUrl) || !isHttpsUrl(p.previewImageUrl)) {
      return `${label}: 画像のURLが正しくありません(https のURLが必要です)`;
    }
  } else if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return `${label}: Flex の内容が正しくありません`;
  }
  return null;
}

export type NormalizedMessages =
  | { ok: true; first: BroadcastMessageItem; extras: BroadcastMessageItem[] }
  | { ok: false; error: string };

/** リクエストの messages(1〜5通)を、検査して「1通目」と「2通目以降」に分ける */
export function normalizeMessagesInput(input: unknown): NormalizedMessages {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'メッセージを1通以上入れてください' };
  if (input.length > MAX_BROADCAST_MESSAGES) return { ok: false, error: `メッセージは${MAX_BROADCAST_MESSAGES}通までです` };
  const items: BroadcastMessageItem[] = [];
  for (let i = 0; i < input.length; i++) {
    const m = input[i] as Record<string, unknown> | null;
    const item: BroadcastMessageItem = {
      type: (m?.type as BroadcastMessageKind) ?? 'text',
      content: typeof m?.content === 'string' ? m.content : '',
      altText: typeof m?.altText === 'string' && m.altText ? m.altText : null,
    };
    const problem = validateMessageItem(item, i + 1);
    if (problem) return { ok: false, error: problem };
    items.push(item);
  }
  return { ok: true, first: items[0], extras: items.slice(1) };
}

export interface PrepareExtrasOptions {
  workerUrl?: string;
  accountId: string | null;
  /** リンクを計測用に短縮するか(track_links) */
  trackLinks: boolean;
  /** 計測リンクへの変換を、今回やるか(1回の配信で1回だけ。やり直すと、計測リンクが二重にできるため) */
  applyTracking: boolean;
}

/**
 * 2通目以降を、送れる形にする: ①フォームのタグコード→LIFFリンク ②URL→計測リンク(applyTracking のとき) 。
 * 戻り値の changed は、保存し直す必要があるか(計測リンクへ変換した)。
 */
export async function prepareExtraMessages(
  db: D1Database,
  extras: BroadcastMessageItem[],
  opts: PrepareExtrasOptions,
): Promise<{ items: BroadcastMessageItem[]; changed: boolean }> {
  const out: BroadcastMessageItem[] = [];
  let changed = false;
  for (const m of extras) {
    let type = m.type;
    // フォームのタグコードは保存せず、毎回、送信の直前に展開する(画像は対象外)
    let content = m.type === 'image' ? m.content : await expandFormLinks(db, m.content, opts.accountId);
    if (opts.workerUrl && opts.applyTracking && opts.trackLinks && m.type !== 'image') {
      const { autoTrackContent } = await import('./auto-track.js');
      const tracked = await autoTrackContent(db, m.type, content, opts.workerUrl, { lineAccountId: opts.accountId });
      if (tracked.messageType !== m.type || tracked.content !== content) changed = true;
      type = tracked.messageType as BroadcastMessageKind;
      content = tracked.content;
    }
    out.push({ type, content, altText: m.altText ?? null });
  }
  return { items: out, changed };
}

/** 友だちごとの差し込み({{name}}・{{liff_id}})を入れて、LINE に送る形(Message)にする */
export function renderMessageItems(
  items: BroadcastMessageItem[],
  context: { liffId?: string | null; displayName?: string | null },
  build: (type: string, content: string, altText?: string) => Message,
): Array<{ type: string; content: string; message: Message }> {
  return items.map((m) => {
    const content = renderBroadcastMessageContent(m.type, m.content, context);
    assertNoUnresolvedBroadcastVariables(content);
    return { type: m.type, content, message: build(m.type, content, m.altText || undefined) };
  });
}

/**
 * 同じ友だちへの複数通は、トーク履歴で配信順に並ぶよう、記録の時刻を1ミリ秒ずつずらす
 * (同じ時刻だと、表示の順番が決まらない)。
 */
export function jstPlusMs(iso: string, ms: number): string {
  if (ms === 0) return iso;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  return new Date(t + ms + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
}

/** クォータの見積もり(人数)は、メッセージの通数をかけた数になる(LINE は1通ごとに数える) */
export function scaleAudience(
  audience: number | (() => Promise<number>),
  count: number,
): number | (() => Promise<number>) {
  if (count <= 1) return audience;
  if (typeof audience === 'number') return audience * count;
  return async () => (await audience()) * count;
}
