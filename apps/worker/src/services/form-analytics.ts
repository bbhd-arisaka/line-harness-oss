// 回答フォームの分析(ホームの「フォーム分析」)。公式アカウントごとに、フォーム×月の回答数を返す。
// 全体・フォーム別・月別・期間別の数字は、この表を端末で足し合わせて出す(切り替えのたびにサーバーを呼ばない)。
// 回答の created_at は日本時間(YYYY-MM-DDTHH:...+09:00)で保存されているので、先頭7文字がそのまま「日本時間の月」になる。
import { monthStartJst } from './quota.js';

export interface FormAnalyticsForm {
  id: string;
  name: string;
  folder: string | null;
  /** 月(YYYY-MM)→回答数。回答のある月だけ */
  counts: Record<string, number>;
}

export interface FormAnalytics {
  accountId: string;
  generatedAt: string;
  /** いまの月(日本時間・YYYY-MM) */
  currentMonth: string;
  forms: FormAnalyticsForm[];
}

export async function loadFormAnalytics(db: D1Database, accountId: string, nowMs: number = Date.now()): Promise<FormAnalytics> {
  const [countRows, formRows] = await Promise.all([
    db
      .prepare(
        `SELECT s.form_id AS form_id, substr(s.created_at, 1, 7) AS ym, COUNT(*) AS n
           FROM form_submissions s JOIN friends f ON f.id = s.friend_id
          WHERE f.line_account_id = ?
          GROUP BY s.form_id, ym`,
      )
      .bind(accountId)
      .all<{ form_id: string; ym: string; n: number }>(),
    db
      .prepare(`SELECT fm.id AS id, fm.name AS name, ff.name AS folder FROM forms fm LEFT JOIN form_folders ff ON ff.id = fm.folder_id`)
      .all<{ id: string; name: string; folder: string | null }>(),
  ]);

  const byForm = new Map<string, Record<string, number>>();
  for (const r of countRows.results ?? []) {
    if (!/^\d{4}-\d{2}$/.test(r.ym)) continue;
    const counts = byForm.get(r.form_id) ?? {};
    counts[r.ym] = (counts[r.ym] ?? 0) + r.n;
    byForm.set(r.form_id, counts);
  }

  const forms: FormAnalyticsForm[] = [];
  for (const f of formRows.results ?? []) {
    const counts = byForm.get(f.id);
    if (counts) forms.push({ id: f.id, name: f.name, folder: f.folder, counts });
  }

  return {
    accountId,
    generatedAt: new Date(nowMs).toISOString(),
    currentMonth: monthStartJst(new Date(nowMs)).slice(0, 7),
    forms,
  };
}
