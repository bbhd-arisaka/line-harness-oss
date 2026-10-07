import { getFriendAddSettings, enrollFriendInScenario } from '@line-crm/db';
import type { FriendAddKind } from '@line-crm/db';
import { runActionList } from './event-bus.js';

/**
 * 友だち追加時設定を実行する(フォローされたとき)。
 *  - シナリオ: 登録する。まだ登録していない人が登録されたときだけ、最初の配信の処理(onEnrolled)を呼ぶ
 *    (旧来の「友だち追加で始まるシナリオ」で、すでに登録済みなら、二重には送らない)
 *  - その他のアクション: タグ・テンプレート送信・リッチメニュー
 * 失敗しても、友だち追加の処理そのものは止めない(記録だけ残す)。
 */
export async function applyFriendAddSettings(
  db: D1Database,
  input: {
    kind: FriendAddKind;
    friendId: string;
    lineAccountId: string | null;
    lineAccessToken?: string;
    onEnrolled?: (scenarioId: string, enrollment: NonNullable<Awaited<ReturnType<typeof enrollFriendInScenario>>>) => Promise<void>;
  },
): Promise<void> {
  if (!input.lineAccountId) return;
  try {
    const setting = (await getFriendAddSettings(db, input.lineAccountId))[input.kind];

    if (setting.scenarioId) {
      try {
        // すでに登録されている(旧来の「友だち追加で始まるシナリオ」など)なら、二重には送らない
        const already = await db
          .prepare('SELECT 1 AS x FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?')
          .bind(input.friendId, setting.scenarioId)
          .first();
        if (!already) {
          const enrollment = await enrollFriendInScenario(db, input.friendId, setting.scenarioId);
          if (enrollment && input.onEnrolled) await input.onEnrolled(setting.scenarioId, enrollment);
        }
      } catch (err) {
        console.error('[friend-add-settings] scenario enrollment failed', err);
      }
    }

    if (setting.actions.length === 0) return;
    // リッチメニューは、メニュー(グループ)の「最初に開くページ」の LINE 上のメニューに切り替える
    const actions: Array<{ type: string; params: Record<string, string> }> = [];
    for (const a of setting.actions) {
      if (a.type === 'switch_rich_menu_group') {
        const row = await db
          .prepare(
            `SELECT p.line_richmenu_id AS id
               FROM rich_menu_groups g
               JOIN rich_menu_pages p ON p.id = COALESCE(g.default_page_id, (SELECT id FROM rich_menu_pages WHERE group_id = g.id ORDER BY order_index LIMIT 1))
              WHERE g.id = ? AND g.account_id = ?`,
          )
          .bind(a.params.groupId, input.lineAccountId)
          .first<{ id: string | null }>();
        if (row?.id) actions.push({ type: 'switch_rich_menu', params: { richMenuId: row.id } });
        else console.error('[friend-add-settings] rich menu group is not published', a.params.groupId);
      } else {
        actions.push({ type: a.type, params: a.params as Record<string, string> });
      }
    }
    const results = await runActionList(db, actions, { friendId: input.friendId, eventData: { source: 'friend_add_settings', kind: input.kind } }, input.lineAccessToken, input.lineAccountId);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) console.error('[friend-add-settings] some actions failed', JSON.stringify(failed));
  } catch (err) {
    console.error('[friend-add-settings] failed', err);
  }
}
