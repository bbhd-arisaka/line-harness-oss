import { upsertChatOnMessage } from '@line-crm/db';
import type { ApnsEnv } from './apns.js';
import { notifyFormAnswered } from './push-notify.js';

/**
 * お客様がフォームに回答したときの、トーク側の扱い。
 * - お客様から連絡が来たときと同じように、トークを一覧の一番上に持ってきて、「対応済み」なら「未対応」(未読マーク)に戻す
 * - アプリの端末にプッシュ通知する(何を通知するかは、アプリの設定画面で端末ごとに選ぶ)
 * 失敗しても、回答の保存・フォームの処理は止めない。
 */
export async function handleFormAnswered(
  env: ApnsEnv,
  db: D1Database,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  input: { friendId: string; accountId: string | null; formName: string },
): Promise<void> {
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
