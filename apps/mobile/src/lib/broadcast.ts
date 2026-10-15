// 一斉配信(アプリ)の、画面に依存しない部分。条件の組み立て・説明文・入力の確認。

/** サーバー(services/segment-query.ts)が受け取る条件 */
export interface SegmentRule {
  type: 'tag_exists' | 'tag_not_exists' | 'metadata_equals' | 'metadata_not_equals' | 'is_following';
  value: string | boolean | { key: string; value: string };
}

/** 友だち全員(友だち中の人)を数えるときの条件 */
export const ALL_FOLLOWING_CONDITION: SegmentCondition = { operator: 'AND', rules: [{ type: 'is_following', value: true }] };
export interface SegmentCondition {
  operator: 'AND' | 'OR';
  rules: SegmentRule[];
}

/** 画面で作る条件1つ */
export type RuleKind = 'tag_exists' | 'tag_not_exists' | 'field_equals' | 'field_not_equals';

export interface DraftRule {
  id: string;
  kind: RuleKind;
  tagId?: string;
  tagName?: string;
  fieldKey?: string;
  fieldLabel?: string;
  value?: string;
}

export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  tag_exists: 'タグがある',
  tag_not_exists: 'タグがない',
  field_equals: '友だち情報が一致する',
  field_not_equals: '友だち情報が一致しない',
};

/** 条件を何個まで足せるか(多すぎると、画面でも人数の確認でも分かりにくい) */
export const MAX_RULES = 8;
/** LINE のテキストメッセージの上限 */
export const MAX_MESSAGE_LENGTH = 5000;

export function isRuleComplete(r: DraftRule): boolean {
  if (r.kind === 'tag_exists' || r.kind === 'tag_not_exists') return !!r.tagId;
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
export function confirmSendMessage(accountName: string, count: number, narrowed: boolean): string {
  const who = narrowed ? '条件に合う' : '友だち全員の';
  return `「${accountName}」の${who}${count.toLocaleString('ja-JP')}人に、いますぐ送ります。送ったあとは取り消せません。`;
}

/** UUID v4(作成の二重実行を防ぐ Idempotency-Key 用。サーバーは UUID の形を求める) */
export function newUuid(random: () => number = Math.random): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const v = Math.floor(random() * 16);
    return (ch === 'x' ? v : (v & 0x3) | 0x8).toString(16);
  });
}

/** 同じ内容なら同じキー、内容が変わったら新しいキーにするための、内容の識別 */
export function draftSignature(parts: { accountId: string; message: string }): string {
  return `${parts.accountId}\n${parts.message.trim()}`;
}
