// 友だち情報欄(フォルダごとの一覧・1項目の編集)の、画面に依存しない部分。
import type { FriendFieldDefinition, FriendFieldFolder } from './types';

export interface InfoItem {
  key: string;
  label: string;
  /** 表示用の値。未入力は空文字 */
  value: string;
  def: FriendFieldDefinition;
  /** タップして編集できるか(PDF は、フォームからの添付なので編集しない。画像は写真を選んで登録できる) */
  editable: boolean;
}

export interface InfoGroup {
  id: string;
  name: string;
  items: InfoItem[];
}

/** 値の表示用の文字(配列は「, 」でつなぐ。添付ファイルは「(添付ファイルあり)」) */
export function fieldText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.includes('/api/form-uploads/') ? '(添付ファイルあり)' : value.trim();
  if (Array.isArray(value)) return value.map(fieldText).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const isAttachmentType = (t: string): boolean => t === 'image' || t === 'pdf';

/**
 * 友だち情報欄: 用意された項目を、すべて、フォルダごとに上から順に。
 * フォルダは並び順どおり・項目はフォルダの中の並び順どおり。フォルダに入っていない項目は、最後の「未分類」。項目が1つも無いフォルダは出さない。
 */
export function buildInfoGroups(
  metadata: Record<string, unknown> | null | undefined,
  defs: FriendFieldDefinition[],
  folders: FriendFieldFolder[],
): InfoGroup[] {
  const sortedDefs = [...defs].sort((a, b) => a.displayOrder - b.displayOrder);
  const toItem = (def: FriendFieldDefinition): InfoItem => ({
    key: def.fieldKey,
    label: def.label,
    value: fieldText(metadata?.[def.fieldKey]),
    def,
    editable: def.fieldType !== 'pdf',
  });
  const known = new Set(folders.map((f) => f.id));
  const groups: InfoGroup[] = [...folders]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((f) => ({ id: f.id, name: f.name, items: sortedDefs.filter((d) => d.folderId === f.id).map(toItem) }))
    .filter((g) => g.items.length > 0);
  const loose = sortedDefs.filter((d) => !d.folderId || !known.has(d.folderId)).map(toItem);
  if (loose.length > 0) groups.push({ id: '__none__', name: '未分類', items: loose });
  return groups;
}

export type FieldInputKind = 'image' | 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'checkbox';

export function inputKindOf(fieldType: string): FieldInputKind | null {
  switch (fieldType) {
    case 'text':
    case 'textarea':
    case 'number':
    case 'date':
    case 'datetime':
    case 'checkbox':
    case 'image':
      return fieldType;
    case 'select':
    case 'radio':
      return 'select';
    default:
      return null;
  }
}

/** 入力欄に最初に入れる文字(日時は、画面では日付と時刻の間を空白にする) */
export function initialInputText(kind: FieldInputKind, stored: unknown): string {
  const text = typeof stored === 'string' ? stored.trim() : Array.isArray(stored) ? stored.join(', ') : stored == null ? '' : String(stored);
  return kind === 'datetime' ? text.replace('T', ' ') : text;
}

const DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const DATETIME_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})$/;
const pad = (n: number | string): string => String(n).padStart(2, '0');

function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last;
}

export type FieldParse = { ok: true; value: string | null } | { ok: false; error: string };

/** 入力した文字を、保存する値にする。空は「消す」(null) */
export function parseFieldInput(kind: FieldInputKind, text: string): FieldParse {
  const t = text.trim();
  if (t === '') return { ok: true, value: null };
  if (kind === 'date') {
    const m = DATE_RE.exec(t);
    if (!m || !validYmd(Number(m[1]), Number(m[2]), Number(m[3]))) return { ok: false, error: '日付は「2026-10-20」の形で入力してください' };
    return { ok: true, value: `${m[1]}-${pad(m[2])}-${pad(m[3])}` };
  }
  if (kind === 'datetime') {
    const m = DATETIME_RE.exec(t);
    if (!m || !validYmd(Number(m[1]), Number(m[2]), Number(m[3])) || Number(m[4]) > 23 || Number(m[5]) > 59) {
      return { ok: false, error: '日時は「2026-10-20 15:30」の形で入力してください' };
    }
    return { ok: true, value: `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}` };
  }
  if (kind === 'number' && !Number.isFinite(Number(t))) return { ok: false, error: '数字で入力してください' };
  return { ok: true, value: t };
}

/** 複数選択(チェックボックス)の、選んだ値の入れ外し。保存は「, 」つなぎの文字 */
export function toggleChoice(current: string, option: string): string {
  const list = current.split(',').map((v) => v.trim()).filter(Boolean);
  const next = list.includes(option) ? list.filter((v) => v !== option) : [...list, option];
  return next.join(', ');
}
