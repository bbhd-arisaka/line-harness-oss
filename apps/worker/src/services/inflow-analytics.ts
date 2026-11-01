// 流入経路の分析(ホームの「流入経路分析」)。公式アカウントごとに、流入経路×月の「人数」と「回数」を返す。
// 期間・並べ替えの足し合わせは端末で行う(切り替えのたびにサーバーを呼ばない)。
// 月は、日本時間(YYYY-MM-DDT...)で保存されている created_at の先頭7文字。
import { monthStartJst } from './quota.js';

export interface InflowAnalyticsRoute {
  id: string;
  name: string;
  folder: string | null;
  /** 月(YYYY-MM)→その経路から入った人数。同じ人は、その経路を最初に使った月に1回だけ数える(月ごとの数を足しても、人数が重ならない) */
  people: Record<string, number>;
  /** 月(YYYY-MM)→その経路が読み取られた回数(同じ人の2回目以降も数える) */
  times: Record<string, number>;
}

export interface InflowAnalytics {
  accountId: string;
  generatedAt: string;
  /** いまの月(日本時間・YYYY-MM) */
  currentMonth: string;
  routes: InflowAnalyticsRoute[];
}

const isMonth = (ym: string) => /^\d{4}-\d{2}$/.test(ym);

export async function loadInflowAnalytics(db: D1Database, accountId: string, nowMs: number = Date.now()): Promise<InflowAnalytics> {
  const [routeRows, timesRows, peopleRows] = await Promise.all([
    db
      .prepare(
        `SELECT r.id AS id, r.name AS name, f.name AS folder
           FROM entry_routes r LEFT JOIN entry_route_folders f ON f.id = r.folder_id
          WHERE r.line_account_id = ?`,
      )
      .bind(accountId)
      .all<{ id: string; name: string; folder: string | null }>(),
    db
      .prepare(
        `SELECT t.entry_route_id AS route_id, substr(t.created_at, 1, 7) AS ym, COUNT(*) AS n
           FROM ref_tracking t JOIN entry_routes r ON r.id = t.entry_route_id
          WHERE r.line_account_id = ?
          GROUP BY t.entry_route_id, ym`,
      )
      .bind(accountId)
      .all<{ route_id: string; ym: string; n: number }>(),
    db
      .prepare(
        `SELECT route_id, substr(first_at, 1, 7) AS ym, COUNT(*) AS n
           FROM (
             SELECT t.entry_route_id AS route_id, t.friend_id AS friend_id, MIN(t.created_at) AS first_at
               FROM ref_tracking t JOIN entry_routes r ON r.id = t.entry_route_id
              WHERE r.line_account_id = ? AND t.friend_id IS NOT NULL
              GROUP BY t.entry_route_id, t.friend_id
           )
          GROUP BY route_id, ym`,
      )
      .bind(accountId)
      .all<{ route_id: string; ym: string; n: number }>(),
  ]);

  const times = new Map<string, Record<string, number>>();
  for (const r of timesRows.results ?? []) {
    if (!isMonth(r.ym)) continue;
    const m = times.get(r.route_id) ?? {};
    m[r.ym] = (m[r.ym] ?? 0) + r.n;
    times.set(r.route_id, m);
  }
  const people = new Map<string, Record<string, number>>();
  for (const r of peopleRows.results ?? []) {
    if (!isMonth(r.ym)) continue;
    const m = people.get(r.route_id) ?? {};
    m[r.ym] = (m[r.ym] ?? 0) + r.n;
    people.set(r.route_id, m);
  }

  const routes: InflowAnalyticsRoute[] = [];
  for (const r of routeRows.results ?? []) {
    const t = times.get(r.id);
    if (!t) continue; // 一度も読み取られていない経路は出さない
    routes.push({ id: r.id, name: r.name, folder: r.folder, people: people.get(r.id) ?? {}, times: t });
  }

  return {
    accountId,
    generatedAt: new Date(nowMs).toISOString(),
    currentMonth: monthStartJst(new Date(nowMs)).slice(0, 7),
    routes,
  };
}
