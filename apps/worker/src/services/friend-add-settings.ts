import {
  cancelFriendReminder,
  enrollFriendInReminder,
  enrollFriendInScenario,
  getFriendAddSettings,
  getFriendById,
  getLineAccountById,
  resolveDeferredRunAt,
  trackConversion,
} from '@line-crm/db';
import type { FriendAddAction, FriendAddKind } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { buildFriendFilterPieces, parseFriendFilter } from './friend-filter.js';
import { logOutgoingMessage, runActionList } from './event-bus.js';
import { buildMessage, expandVariables, messageToLogPayload, resolveMetadata } from './step-delivery.js';

/**
 * 友だち追加時設定を実行する(フォローされたとき)。Lステップの「友だち追加時設定」と同じ動き。
 *  - シナリオ: 登録する。まだ登録していない人が登録されたときだけ、最初の配信の処理(onEnrolled)を呼ぶ
 *    (旧来の「友だち追加で始まるシナリオ」で、すでに登録済みなら、二重には送らない)
 *  - その他のアクション: 上から順に実行。条件(条件ON)があれば、その友だちが条件に合うときだけ。
 *    テキスト・テンプレートの送信は、送信タイミング(すぐに／遅らせる／時刻を指定)に従う
 * 失敗しても、友だち追加の処理そのものは止めない(記録だけ残す)。
 */
export async function applyFriendAddSettings(
  db: D1Database,
  input: {
    kind: FriendAddKind;
    friendId: string;
    lineAccountId: string | null;
    lineAccessToken?: string;
    workerUrl?: string;
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

    for (const action of setting.actions) {
      try {
        const runAt = action.type === 'text' || action.type === 'template' ? resolveDeferredRunAt(action.timing) : null;
        if (runAt) {
          await db
            .prepare('INSERT INTO friend_add_deferred_actions (id, friend_id, line_account_id, action, run_at) VALUES (?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), input.friendId, input.lineAccountId, JSON.stringify(action), runAt)
            .run();
          continue;
        }
        await executeFriendAddAction(db, { friendId: input.friendId, lineAccountId: input.lineAccountId, lineAccessToken: input.lineAccessToken, workerUrl: input.workerUrl }, action);
      } catch (err) {
        console.error('[friend-add-settings] action failed', action.type, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[friend-add-settings] failed', err);
  }
}

/** この友だちが、条件(友だち絞り込み)に合うか */
export async function friendMatchesCondition(db: D1Database, friendId: string, condition: Record<string, unknown>): Promise<boolean> {
  const pieces = buildFriendFilterPieces(parseFriendFilter(condition));
  const sql = `SELECT 1 AS ok FROM friends f WHERE f.id = ?${pieces.map((p) => ` AND (${p.sql})`).join('')} LIMIT 1`;
  const row = await db
    .prepare(sql)
    .bind(friendId, ...pieces.flatMap((p) => p.binds))
    .first();
  return !!row;
}

interface Target {
  friendId: string;
  lineAccountId: string | null;
  lineAccessToken?: string;
  workerUrl?: string;
}

/** アクションを1つ実行する(条件が合わなければ何もしない) */
export async function executeFriendAddAction(db: D1Database, target: Target, action: FriendAddAction): Promise<void> {
  if (action.condition) {
    let ok: boolean;
    try {
      ok = await friendMatchesCondition(db, target.friendId, action.condition);
    } catch (err) {
      console.error('[friend-add-settings] condition is invalid; skipped', err instanceof Error ? err.message : err);
      return;
    }
    if (!ok) return;
  }
  const payload = { friendId: target.friendId, eventData: { source: 'friend_add_settings' } };
  const p = action.params;

  switch (action.type) {
    case 'rich_menu': {
      if (p.menu === 'default') {
        await expectOk(await runActionList(db, [{ type: 'remove_rich_menu', params: {} }], payload, target.lineAccessToken, target.lineAccountId));
        return;
      }
      const row = await db
        .prepare(
          `SELECT p.line_richmenu_id AS id
             FROM rich_menu_groups g
             JOIN rich_menu_pages p ON p.id = COALESCE(g.default_page_id, (SELECT id FROM rich_menu_pages WHERE group_id = g.id ORDER BY order_index LIMIT 1))
            WHERE g.id = ? AND g.account_id = ?`,
        )
        .bind(String(p.menu), target.lineAccountId)
        .first<{ id: string | null }>();
      if (!row?.id) throw new Error('このリッチメニューは、まだLINEに公開されていません');
      await expectOk(await runActionList(db, [{ type: 'switch_rich_menu', params: { richMenuId: row.id } }], payload, target.lineAccessToken, target.lineAccountId));
      return;
    }
    case 'text':
      await sendText(db, target, String(p.content ?? ''));
      return;
    case 'template':
      await expectOk(await runActionList(db, [{ type: 'send_message', params: { template_id: String(p.templateId) } }], payload, target.lineAccessToken, target.lineAccountId));
      return;
    case 'tag': {
      const type = p.op === 'remove' ? 'remove_tag' : 'add_tag';
      const tagIds = Array.isArray(p.tagIds) ? (p.tagIds as string[]) : [];
      await expectOk(await runActionList(db, tagIds.map((tagId) => ({ type, params: { tagId } })), payload, target.lineAccessToken, target.lineAccountId));
      return;
    }
    case 'friend_field':
      await changeFriendField(db, target.friendId, String(p.fieldKey), p.op as 'set' | 'add' | 'sub', String(p.value ?? ''));
      return;
    case 'reminder': {
      if (p.op === 'start') {
        await enrollFriendInReminder(db, { friendId: target.friendId, reminderId: String(p.reminderId), targetDate: new Date().toISOString() });
      } else {
        const rows = await db
          .prepare("SELECT id FROM friend_reminders WHERE friend_id = ? AND reminder_id = ? AND status = 'active'")
          .bind(target.friendId, String(p.reminderId))
          .all<{ id: string }>();
        for (const r of rows.results ?? []) await cancelFriendReminder(db, r.id);
      }
      return;
    }
    case 'conversion':
      await trackConversion(db, { conversionPointId: String(p.conversionPointId), friendId: target.friendId });
      return;
  }
}

function expectOk(results: Array<{ action: string; success: boolean; error?: string }>): void {
  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) throw new Error(failed.map((f) => f.error ?? f.action).join(' / '));
}

/** テキスト送信。{{name}} などの差し込みは、自動応答と同じように展開する */
async function sendText(db: D1Database, target: Target, text: string): Promise<void> {
  if (!target.lineAccessToken) throw new Error('LINEの認証情報がありません');
  const friend = await getFriendById(db, target.friendId);
  if (!friend) return;
  const metadata = await resolveMetadata(db, friend);
  const content = expandVariables(text, { ...friend, metadata }, target.workerUrl, 'text');
  const message = buildMessage('text', content);
  await new LineClient(target.lineAccessToken).pushMessage(friend.line_user_id, [message]);
  const log = messageToLogPayload(message);
  await logOutgoingMessage(db, {
    friendId: friend.id,
    messageType: log.messageType,
    content: log.content,
    deliveryType: 'push',
    source: 'automation',
    lineAccountId: target.lineAccountId,
  });
}

/** 友だち情報欄の値を、代入・加算・減算する(friends.metadata のキー) */
async function changeFriendField(db: D1Database, friendId: string, fieldKey: string, op: 'set' | 'add' | 'sub', value: string): Promise<void> {
  const row = await db.prepare('SELECT metadata FROM friends WHERE id = ?').bind(friendId).first<{ metadata: string | null }>();
  if (!row) return;
  const meta = JSON.parse(row.metadata || '{}') as Record<string, unknown>;
  if (op === 'set') meta[fieldKey] = value;
  else {
    const current = Number(meta[fieldKey] ?? 0);
    const delta = Number(value);
    meta[fieldKey] = String((Number.isFinite(current) ? current : 0) + (op === 'add' ? delta : -delta));
  }
  await db.prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(meta), new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 23), friendId).run();
}

/**
 * 時刻が来た「送信を遅らせる／時刻を指定する」アクションを実行する(cron から呼ぶ)。
 * 1回あたり最大50件。実行できたら done、失敗したら failed(理由つき)。
 */
export async function processDeferredFriendAddActions(db: D1Database, opts: { workerUrl?: string; limit?: number } = {}): Promise<number> {
  const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 23);
  const due = await db
    .prepare("SELECT id, friend_id, line_account_id, action FROM friend_add_deferred_actions WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT ?")
    .bind(now, opts.limit ?? 50)
    .all<{ id: string; friend_id: string; line_account_id: string | null; action: string }>();
  let done = 0;
  for (const row of due.results ?? []) {
    // 同時に走っても二重に送らないよう、先に取る
    const claimed = await db.prepare("UPDATE friend_add_deferred_actions SET status = 'done' WHERE id = ? AND status = 'pending'").bind(row.id).run();
    if (!claimed.meta?.changes) continue;
    try {
      const account = row.line_account_id ? await getLineAccountById(db, row.line_account_id) : null;
      await executeFriendAddAction(
        db,
        { friendId: row.friend_id, lineAccountId: row.line_account_id, lineAccessToken: account?.channel_access_token, workerUrl: opts.workerUrl },
        JSON.parse(row.action) as FriendAddAction,
      );
      done++;
    } catch (err) {
      await db
        .prepare("UPDATE friend_add_deferred_actions SET status = 'failed', error = ? WHERE id = ?")
        .bind((err instanceof Error ? err.message : String(err)).slice(0, 300), row.id)
        .run();
    }
  }
  return done;
}
