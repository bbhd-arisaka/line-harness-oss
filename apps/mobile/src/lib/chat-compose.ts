import type { TemplateOption } from './types';

/** トークの入力欄から送る、テキストの上限(LINE のテキストメッセージ) */
export const CHAT_MAX_LENGTH = 5000;

/** 写真1枚の画像メッセージの本文(LINE が求める JSON の文字列) */
export function imageContent(url: string): string {
  return JSON.stringify({ originalContentUrl: url, previewImageUrl: url });
}

/** 一覧に出す、テンプレートの中身の短い説明。差し込みのタグコードは、{{…}} の文字のまま見せない */
export function templateNote(t: Pick<TemplateOption, 'messageType' | 'messageContent'>): string {
  if (t.messageType === 'image') return '[画像]';
  if (t.messageType === 'flex') return '[Flex メッセージ]';
  const text = t.messageContent
    .replace(/\{\{\s*form_url:\S+?\s*\}\}/g, '[フォーム]')
    .replace(/\{\{\s*name\s*\}\}/g, '[LINE名]')
    .replace(/\{\{\s*real_name\s*\}\}/g, '[本名]')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/** テンプレートのテキストを、いまの入力欄の後ろに足す(空でなければ、改行を挟む) */
export function appendTemplateText(current: string, templateText: string): string {
  const base = current.replace(/\s+$/, '');
  return base ? `${base}\n${templateText}` : templateText;
}

/** 送る前の確認で、入力欄と添付の状態から、送るものを決める。送れないときは理由を返す */
export type ComposePlan =
  | { ok: true; image: string | null; text: string | null }
  | { ok: false; reason: string };

export function planCompose(input: { text: string; imageUrl: string | null; unsupportedTag: string | null }): ComposePlan {
  const text = input.text.trim();
  if (!text && !input.imageUrl) return { ok: false, reason: '送る内容がありません' };
  if (input.unsupportedTag) return { ok: false, reason: `使えない差し込みがあります: ${input.unsupportedTag}` };
  if (Array.from(text).length > CHAT_MAX_LENGTH) return { ok: false, reason: `テキストは${CHAT_MAX_LENGTH.toLocaleString('ja-JP')}文字までです` };
  return { ok: true, image: input.imageUrl, text: text || null };
}
