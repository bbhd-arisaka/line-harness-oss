// 友だちの「本名・システム表示名・個別メモ」の編集まわりの判断。React Native に依存しない純粋な関数。
import type { FriendProfileInput } from './types';

/** 本名・システム表示名の上限(API と同じ。Lステップの表示名編集と同じ 20 文字) */
export const NAME_MAX_LENGTH = 20;

export interface ProfileFields {
  realName: string | null | undefined;
  systemDisplayName: string | null | undefined;
  memo: string | null | undefined;
}

export interface ProfileDraft {
  realName: string;
  systemDisplayName: string;
  memo: string;
}

/** 友だちの現在の値から、編集欄の初期値を作る */
export function draftFromFriend(f: ProfileFields): ProfileDraft {
  return {
    realName: f.realName ?? '',
    systemDisplayName: f.systemDisplayName ?? '',
    memo: f.memo ?? '',
  };
}

/** 文字数(絵文字などのサロゲートペアも 1 文字と数える。サーバーの [...v].length と同じ) */
export function charLength(value: string): number {
  return Array.from(value).length;
}

export type ProfilePlan =
  | { ok: true; changed: false }
  | { ok: true; changed: true; input: FriendProfileInput }
  | { ok: false; error: string };

/**
 * 編集内容から、送る内容を作る。
 * - 前後の空白は取り、空にした項目は null(= 消す)で送る
 * - 変更した項目だけ送る(別の端末での編集を上書きしないため)
 * - 本名・システム表示名は 20 文字まで
 */
export function planProfileUpdate(current: ProfileFields, draft: ProfileDraft): ProfilePlan {
  const next = {
    realName: draft.realName.trim(),
    systemDisplayName: draft.systemDisplayName.trim(),
    memo: draft.memo.trim(),
  };
  if (charLength(next.realName) > NAME_MAX_LENGTH) return { ok: false, error: `本名は${NAME_MAX_LENGTH}文字以内で入力してください` };
  if (charLength(next.systemDisplayName) > NAME_MAX_LENGTH) {
    return { ok: false, error: `システム表示名は${NAME_MAX_LENGTH}文字以内で入力してください` };
  }

  const input: FriendProfileInput = {};
  if (next.realName !== (current.realName ?? '').trim()) input.realName = next.realName || null;
  if (next.systemDisplayName !== (current.systemDisplayName ?? '').trim()) input.systemDisplayName = next.systemDisplayName || null;
  if (next.memo !== (current.memo ?? '').trim()) input.memo = next.memo || null;

  return Object.keys(input).length === 0 ? { ok: true, changed: false } : { ok: true, changed: true, input };
}
