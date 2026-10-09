import { buildAnswerCardContent, jstNow, upsertChatOnMessage } from '@line-crm/db';
import type { ApnsEnv } from './apns.js';
import { notifyFormAnswered } from './push-notify.js';

/** トークの履歴に残す「回答結果を見る」カードの message_type(お客様側のメッセージとして残す) */
export const FORM_ANSWER_MESSAGE_TYPE = 'form_answer';

/**
 * お客様がフォームに回答したときの、トーク側の扱い。
 * - フォームの設定でオンなら、トークに「回答結果を見る」カードを、お客様から届いたメッセージとして残す(お客様には何も送らない)
 * - お客様から連絡が来たときと同じように、トークを一覧の一番上に持ってきて、「対応済み」なら「未対応」(未読マーク)に戻す
 * - アプリの端末にプッシュ通知する(何を通知するかは、アプリの設定画面で端末ごとに選ぶ)
 * 失敗しても、回答の保存・フォームの処理は止めない。
 */
export async function handleFormAnswered(
  env: ApnsEnv,
  db: D1Database,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  input: {
    friendId: string;
    accountId: string | null;
    formName: string;
    /** 回答カードを出すときに使う(無ければカードは出さない) */
    formId?: string;
    submissionId?: string;
    /** forms.lstep_options(JSON文字列)。answerCard の設定が入っている */
    lstepOptions?: string | null;
    friendName?: string | null;
  },
): Promise<void> {
  try {
    if (input.formId && input.submissionId) {
      const card = buildAnswerCardContent(input.lstepOptions, {
        formId: input.formId,
        formName: input.formName,
        submissionId: input.submissionId,
        friendName: input.friendName?.trim() || 'お客様',
      });
      if (card) {
        await db
          .prepare(
            `INSERT INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
             VALUES (?, ?, 'incoming', ?, ?, 'form', ?, ?)`,
          )
          .bind(crypto.randomUUID(), input.friendId, FORM_ANSWER_MESSAGE_TYPE, JSON.stringify(card), input.accountId, jstNow())
          .run();
      }
    }
  } catch (err) {
    console.error('[form-answered] 回答カードの保存に失敗', err instanceof Error ? err.message : 'error');
  }
  try {
    await upsertChatOnMessage(db, input.friendId);
  } catch (err) {
    console.error('[form-answered] トークの更新に失敗', err instanceof Error ? err.message : 'error');
  }
  try {
    const push = notifyFormAnswered(env, db, input).catch((err) => {
      console.error('[form-answered] push notify failed', err instanceof Error ? err.message : 'error');
    });
    if (ctx) ctx.waitUntil(push);
    else await push;
  } catch (err) {
    console.error('[form-answered] push notify failed', err instanceof Error ? err.message : 'error');
  }
}
