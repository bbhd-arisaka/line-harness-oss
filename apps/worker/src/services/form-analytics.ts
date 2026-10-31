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

/** 「その他」の回答のまとめ先(選択肢に無い回答は、入力内容によらずここに数える) */
export const OTHER_OPTION = 'その他';

/** お気に入りに登録した項目(選択肢の項目)の、選択肢ごとの回答数。割合は、回答数 ÷ その項目に答えた人数で、端末が出す */
export interface FavoriteField {
  formId: string;
  formName: string;
  fieldName: string;
  label: string;
  /** 月(YYYY-MM)→その項目に答えた人数(未回答は含めない) */
  answered: Record<string, number>;
  /** 選択肢(フォームの並び順)。月(YYYY-MM)→その選択肢を選んだ人数 */
  options: Array<{ value: string; counts: Record<string, number> }>;
}

export interface FormAnalytics {
  accountId: string;
  generatedAt: string;
  /** いまの月(日本時間・YYYY-MM) */
  currentMonth: string;
  forms: FormAnalyticsForm[];
  favorites: FavoriteField[];
}

interface StoredField {
  name?: string;
  label?: string;
  type?: string;
  options?: string[];
  favorite?: boolean;
  allowOther?: boolean;
}

/** お気に入りにできる項目(選択肢のある項目)。都道府県は選択肢がフォームに無いので、回答に出た値を数える */
const FAVORITE_TYPES = new Set(['radio', 'checkbox', 'select', 'prefecture']);

function answerValues(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const out = new Set<string>();
  for (const v of list) {
    if (typeof v === 'string' && v.trim() !== '') out.add(v.trim());
  }
  return [...out];
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
      .prepare(`SELECT fm.id AS id, fm.name AS name, ff.name AS folder, fm.fields AS fields FROM forms fm LEFT JOIN form_folders ff ON ff.id = fm.folder_id`)
      .all<{ id: string; name: string; folder: string | null; fields: string | null }>(),
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
    favorites: await loadFavorites(db, accountId, formRows.results ?? []),
  };
}

/** お気に入りの項目ごとに、選択肢別の回答数(月別)を数える。お気に入りが無ければ、回答は読まない */
async function loadFavorites(
  db: D1Database,
  accountId: string,
  formRows: Array<{ id: string; name: string; fields: string | null }>,
): Promise<FavoriteField[]> {
  const byForm = new Map<string, { name: string; fields: StoredField[] }>();
  for (const f of formRows) {
    if (!f.fields || !f.fields.includes('"favorite"')) continue;
    let parsed: StoredField[] = [];
    try {
      parsed = JSON.parse(f.fields) as StoredField[];
    } catch {
      continue;
    }
    const fav = parsed.filter((x) => x.favorite && x.name && FAVORITE_TYPES.has(x.type ?? ''));
    if (fav.length > 0) byForm.set(f.id, { name: f.name, fields: fav });
  }
  if (byForm.size === 0) return [];

  const ids = [...byForm.keys()];
  const rows = await db
    .prepare(
      `SELECT s.form_id AS form_id, substr(s.created_at, 1, 7) AS ym, s.data AS data
         FROM form_submissions s JOIN friends f ON f.id = s.friend_id
        WHERE f.line_account_id = ? AND s.form_id IN (${ids.map(() => '?').join(',')})`,
    )
    .bind(accountId, ...ids)
    .all<{ form_id: string; ym: string; data: string }>();

  const out: FavoriteField[] = [];
  const state = new Map<string, FavoriteField & { index: Map<string, Record<string, number>> }>();
  for (const [formId, form] of byForm) {
    for (const field of form.fields) {
      const defined = (field.options ?? []).map((o) => o.trim()).filter(Boolean);
      const entry = {
        formId,
        formName: form.name,
        fieldName: field.name as string,
        label: field.label || (field.name as string),
        answered: {} as Record<string, number>,
        options: [] as FavoriteField['options'],
        index: new Map<string, Record<string, number>>(),
      };
      for (const value of defined) {
        const counts: Record<string, number> = {};
        entry.index.set(value, counts);
        entry.options.push({ value, counts });
      }
      state.set(`${formId}|${entry.fieldName}`, entry);
      out.push(entry);
    }
  }

  for (const r of rows.results ?? []) {
    if (!/^\d{4}-\d{2}$/.test(r.ym)) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(r.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const field of byForm.get(r.form_id)?.fields ?? []) {
      const entry = state.get(`${r.form_id}|${field.name}`);
      if (!entry) continue;
      const values = answerValues(data[field.name as string]);
      if (values.length === 0) continue;
      entry.answered[r.ym] = (entry.answered[r.ym] ?? 0) + 1;
      // 同じ回答の中で「その他」が重なっても、1人1回だけ数える
      const hit = new Set<string>();
      for (const v of values) hit.add(entry.index.has(v) ? v : OTHER_OPTION);
      for (const v of hit) {
        let counts = entry.index.get(v);
        if (!counts) {
          counts = {};
          entry.index.set(v, counts);
          entry.options.push({ value: v, counts });
        }
        counts[r.ym] = (counts[r.ym] ?? 0) + 1;
      }
    }
  }

  return out.map(({ index: _i, ...f }) => f);
}
