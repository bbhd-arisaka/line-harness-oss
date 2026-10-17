// ホーム(トップ)画面の、画面に依存しない部分。サーバー(GET /api/home)の形と、表示用の計算。

export type HomeAlert = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail?: string;
  target?: { kind: 'chats'; status: 'unread' } | { kind: 'broadcasts' } | { kind: 'friends' };
};

export type HomeTrendRow = { date: string; added: number; blocked: number; delta: number; active: number };

export type HomeSummary = {
  accountId: string;
  generatedAt: string;
  friends: { active: number; blocked: number; total: number };
  chatStatus: { unread: number; in_progress: number; resolved: number };
  unreadOver24h: number;
  oldestUnreadHours: number | null;
  quota: { type: 'limited' | 'none'; limit: number | null; consumption: number | null; remaining: number | null } | null;
  sentThisMonth: number;
  trend: HomeTrendRow[];
  ops: {
    avgFirstReplyMinutes: number | null;
    repliedCount: number;
    receivedThisMonth: number;
    formAnswersThisMonth: number;
    addedThisMonth: number;
    blockedThisMonth: number;
    blockRatePct: number | null;
  };
  routes: Array<{ key: string; label: string; count: number }>;
  alerts: HomeAlert[];
};

export const num = (v: number): string => v.toLocaleString('ja-JP');

/** 分 → 「32分」「1時間20分」 */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/** 「+3」「−2」「±0」 */
export function signed(v: number): string {
  return v > 0 ? `+${num(v)}` : v < 0 ? `−${num(Math.abs(v))}` : '±0';
}

/** 「2026-10-18」→「10/18」 */
export function monthDay(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** トーク一覧を、どの状態に絞って開くか(ホームの「対応状況」・お知らせから) */
export type ChatFilterParam = 'unread' | 'in_progress' | 'resolved';

/** お知らせをタップしたときの行き先 */
export function alertRoute(a: HomeAlert): { kind: 'chats'; filter: ChatFilterParam } | { kind: 'tab'; name: 'broadcasts' | 'friends' } | null {
  if (!a.target) return null;
  if (a.target.kind === 'chats') return { kind: 'chats', filter: a.target.status };
  return { kind: 'tab', name: a.target.kind };
}

/** URL・画面の引数の文字を、絞り込みの種類にする(それ以外は null = 絞り込まない) */
export function parseChatFilter(v: string | string[] | undefined): ChatFilterParam | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s === 'unread' || s === 'in_progress' || s === 'resolved' ? s : null;
}

/** 推移の棒グラフ用: 登録・ブロックの高さを、いちばん大きい値に合わせた 0〜1 にする */
export function barRatios(rows: HomeTrendRow[]): Array<{ up: number; down: number }> {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.added, r.blocked)));
  return rows.map((r) => ({ up: r.added / max, down: r.blocked / max }));
}
