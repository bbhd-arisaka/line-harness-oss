import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createForm, updateForm, getFormById, createFormFolder } from '../src/forms.js';

// createForm/updateForm build their INSERT/UPDATE column lists and VALUES
// placeholders by hand, in two separate places that must stay in sync as
// columns are added over time. A one-column drift between them doesn't
// surface as a TypeScript error — D1 only reports it at request time as a
// generic 500 (see 2026-09-29 incident: "フォームを新規作成" was broken in
// production for hours because of exactly this). This test exercises both
// functions against a real SQLite engine so a placeholder/column mismatch
// fails the build instead of production.

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

// forms テーブルに影響するmigrationのみ、順番通りに適用する(007が土台)。
const FORMS_MIGRATIONS = [
  '007_forms.sql',
  '014_form_submit_message.sql',
  '017_form_webhook.sql',
  '044_forms_og.sql',
  '073_form_settings_and_friend_fields.sql',
  '074_form_design_settings.sql',
  '075_form_google_sheets.sql',
  '077_form_theme_colors.sql',
  '078_form_folders.sql',
];

/** D1Database の `.prepare(sql).bind(...args).run()/.first()/.all()` を
 * better-sqlite3 の同期APIでラップする、テスト専用の最小限アダプタ。 */
function wrapAsD1(db: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      let boundArgs: unknown[] = [];
      const wrapper = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return wrapper;
        },
        async run() {
          stmt.run(...boundArgs);
          return { success: true } as unknown;
        },
        async first<T>() {
          return (stmt.get(...boundArgs) as T) ?? null;
        },
        async all<T>() {
          return { results: stmt.all(...boundArgs) as T[] };
        },
      };
      return wrapper;
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      const results = [];
      for (const s of statements) results.push(await s.run());
      return results;
    },
  } as unknown as D1Database;
}

function testDb(): D1Database {
  const db = new Database(':memory:');
  // forms.on_submit_tag_id / on_submit_scenario_id が REFERENCES する先。
  // 中身は使わないので最小限のスタブでよい。
  db.exec(`CREATE TABLE tags (id TEXT PRIMARY KEY); CREATE TABLE scenarios (id TEXT PRIMARY KEY);`);
  for (const file of FORMS_MIGRATIONS) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return wrapAsD1(db);
}

describe('forms.ts createForm/updateForm — カラム数とプレースホルダ数の整合性', () => {
  it('createForm: 全カラム省略なしで作成できる(INSERT列数とVALUESプレースホルダ数が一致している)', async () => {
    const db = testDb();
    const folder = await createFormFolder(db, { name: 'カウンセリング' });
    const form = await createForm(db, {
      name: 'テストフォーム',
      fields: '[]',
      folderId: folder.id,
      customDesignEnabled: true,
      backgroundColor: '#fff',
      googleSheetsEnabled: true,
      googleSheetUrl: 'https://example.com',
      themeMainColor: '#111',
      themeSubColor: '#222',
      themeErrorColor: '#f00',
      themeTextColor: '#000',
      themeFont: 'ゴシック',
    });
    expect(form.name).toBe('テストフォーム');
    expect(form.folder_id).toBe(folder.id);
    expect(form.custom_design_enabled).toBe(1);
    expect(form.theme_main_color).toBe('#111');
  });

  it('updateForm: 全カラム省略なしで更新できる(SET句とbind引数の数が一致している)', async () => {
    const db = testDb();
    const folder = await createFormFolder(db, { name: '予約' });
    const created = await createForm(db, { name: '元の名前', fields: '[]' });
    const updated = await updateForm(db, created.id, {
      name: '更新後の名前',
      folderId: folder.id,
      themeFont: 'セリフ',
      googleSheetsEnabled: true,
    });
    expect(updated?.name).toBe('更新後の名前');
    expect(updated?.folder_id).toBe(folder.id);
    expect(updated?.theme_font).toBe('セリフ');
    expect(updated?.google_sheets_enabled).toBe(1);

    const reloaded = await getFormById(db, created.id);
    expect(reloaded?.name).toBe('更新後の名前');
  });
});
