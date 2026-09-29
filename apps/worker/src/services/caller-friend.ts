import { getFriendByLineUserId } from '@line-crm/db';
import type { Friend } from '@line-crm/db';

/**
 * 公開ページ(LIFF)を開いた本人の「友だち」を特定する。
 *
 * 同じプロバイダーの複数の公式アカウント(例: 店舗A・採用)を友だち追加している人は、LINEのユーザーIDが
 * どのアカウントでも同じ。ユーザーIDだけで探すと、別アカウントの友だちに回答が記録されてしまう。
 * そこで、クライアントが送る `X-Liff-Id`(いま開いているLIFFのID。アカウントごとに異なる)から
 * アカウントを特定し、そのアカウントの友だちを優先して返す。
 * アカウントを特定できない場合(古いクライアント等)だけ、従来どおりユーザーIDだけで探す。
 */
export async function findCallerFriend(
  db: D1Database,
  lineUserId: string,
  liffId: string | null | undefined,
): Promise<Friend | null> {
  const id = (liffId ?? '').trim();
  if (id) {
    const account = await db
      .prepare('SELECT id FROM line_accounts WHERE liff_id = ?')
      .bind(id)
      .first<{ id: string }>();
    // アカウントが特定できたら、そのアカウントの友だちだけを返す(他アカウントの行にはフォールバックしない)
    if (account) {
      return db
        .prepare('SELECT * FROM friends WHERE line_user_id = ? AND line_account_id = ?')
        .bind(lineUserId, account.id)
        .first<Friend>();
    }
  }
  return getFriendByLineUserId(db, lineUserId);
}
