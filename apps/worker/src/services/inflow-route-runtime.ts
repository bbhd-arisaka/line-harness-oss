import { getFriendById, getLineAccountById, parseFriendAddActions } from '@line-crm/db';
import type { EntryRoute } from '@line-crm/db';
import { applyScenarioAndActions, changeFriendField } from './friend-add-settings.js';
import { pushImmediateFirstStep } from './immediate-first-step.js';
import { adParamMapOf } from './inflow-route-landing.js';

/** アクション設定つきの流入経路で、「友だち追加時設定のアクション」を「無視する」にしているか */
export function ignoresFriendAddSettings(route: Pick<EntryRoute, 'actions' | 'ignore_friend_add_settings'>): boolean {
  return typeof route.actions === 'string' && route.ignore_friend_add_settings === 1;
}

const FIRST_ADD_WINDOW_MS = 24 * 3600_000;

/** DB の日本時間の文字列(「+09:00」ありなし)を、ミリ秒に */
function jstMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(/[+-]\d\d:\d\d$|Z$/.test(s) ? s : `${s}+09:00`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 「この友だちにとって、この流入経路が初めての友だち追加か」。
 * この流入経路での記録がいまのものだけ(=初めて読み取った)で、かつ友だちになってから間もないとき。
 */
export async function isFirstFriendAdd(db: D1Database, routeId: string, friendId: string, nowMs: number = Date.now()): Promise<boolean> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM ref_tracking WHERE entry_route_id = ? AND friend_id = ?')
    .bind(routeId, friendId)
    .first<{ n: number }>();
  if ((row?.n ?? 0) > 1) return false;
  const friend = await getFriendById(db, friendId);
  const addedAt = jstMs(friend?.first_followed_at ?? friend?.created_at);
  return addedAt !== null && nowMs - addedAt <= FIRST_ADD_WINDOW_MS;
}

/**
 * 流入経路(アクション設定つきの新しい形式)を読み取った友だちに、設定どおりのことをする。
 *  - アクションの実行: 「初回の友だち追加時のみ」/「いつでも」
 *  - 広告連携: URLのパラメータを友だち情報欄に入れる(「いつでも」/「初回のみ」)
 * 並行運用中のアカウントでは何もしない(LINEへ送らない)。
 */
export async function runInflowRoute(
  db: D1Database,
  env: { WORKER_URL?: string },
  route: EntryRoute,
  friendId: string,
  opts: { queryParams?: Record<string, string> | null } = {},
): Promise<void> {
  if (!route.line_account_id) return;
  const account = await getLineAccountById(db, route.line_account_id);
  if (!account || account.lstep_forward_url) return;
  const first = await isFirstFriendAdd(db, route.id, friendId);

  if (route.ad_import_mode === 'always' || first) {
    for (const m of adParamMapOf(route)) {
      const v = opts.queryParams?.[m.param];
      if (typeof v !== 'string' || v === '') continue;
      try {
        await changeFriendField(db, friendId, m.fieldKey, 'set', v);
      } catch (err) {
        console.error('[inflow-route] ad param import failed', m.param, err instanceof Error ? err.message : err);
      }
    }
  }

  if (route.action_mode !== 'always' && !first) return;
  let actions: ReturnType<typeof parseFriendAddActions> = [];
  try {
    actions = parseFriendAddActions(route.actions ? JSON.parse(route.actions) : []);
  } catch (err) {
    console.error('[inflow-route] actions are invalid; skipped', err instanceof Error ? err.message : err);
  }
  await applyScenarioAndActions(db, {
    friendId,
    lineAccountId: account.id,
    lineAccessToken: account.channel_access_token,
    workerUrl: env.WORKER_URL,
    scenarioId: route.scenario_id,
    actions,
    onEnrolled: async (scenarioId, enrollment) => {
      await pushImmediateFirstStep(
        db,
        friendId,
        scenarioId,
        { defaultAccessToken: account.channel_access_token, workerUrl: env.WORKER_URL, accountChannelId: account.channel_id },
        { enrollment },
      );
    },
  });
}
