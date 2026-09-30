import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import {
  ImportError,
  applyFriends,
  finishImport,
  planDefinitions,
  planFriends,
  loadTagIds,
  startImport,
  undoImport,
  validateDefinitions,
  validateFriends,
} from './lstep-import.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

const DEFS = {
  source: 'lstep' as const,
  accountId: 'acc-a',
  folders: [{ name: '基本情報', order: 0 }, { name: '来店', order: 1 }],
  fields: [
    { key: 'ls_name', label: 'お名前', type: 'text', folder: '基本情報', order: 0, options: [], defaultValue: null },
    { key: 'phone', label: '電話番号', type: 'text', folder: '基本情報', order: 1, options: [], defaultValue: null },
    { key: 'ls_first', label: '初回', type: 'select', folder: '来店', order: 0, options: ['あり', 'なし'], defaultValue: null },
  ],
  tags: [{ name: '大門浜松町店' }, { name: 'インスタから流入' }],
};

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  // テスト用の D1 には batch が無いので、順番どおり1件ずつ実行して代用する
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    const out: D1Result<T>[] = [];
    for (const st of statements) out.push(await st.run<T>());
    return out;
  };
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('acc-a','ch-a','A店','s','t'),('acc-b','ch-b','B店','s','t')`);
  const ins = sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name,metadata,created_at) VALUES(?,?,?,?,?,?)');
  ins.run('f1', 'U1', 'acc-a', 'たろう', '{"memo_old":"残す"}', '2026-09-29T00:00:00.000+09:00');
  ins.run('f2', 'U2', 'acc-a', 'はなこ', '{}', '2026-09-29T00:00:00.000+09:00');
  sqlite.prepare('INSERT INTO friends(id,line_user_key,line_user_id,line_account_id,display_name,metadata,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('fb', 'U1#acc-b', 'U1', 'acc-b', 'たろう(B店)', '{}', '2026-09-29T00:00:00.000+09:00');
  // 既に「phone」の定義がある(フォームの代入先で使用中) → 作り直さない
  sqlite.exec(`INSERT INTO friend_field_definitions(id,field_key,label,field_type) VALUES('d-phone','phone','電話番号','text')`);
  return { db, sqlite };
}

const FRIENDS = [
  { beyondFriendId: 'f1', realName: '山田 太郎', systemDisplayName: '(大門店)山田 太郎', addedAt: '2025-09-30T14:40:17', tags: ['大門浜松町店', 'インスタから流入'], values: { ls_name: '山田', phone: '0801', ls_first: 'あり' } },
  { beyondFriendId: 'f2', realName: null, systemDisplayName: null, addedAt: null, tags: [], values: {} },
  { beyondFriendId: 'fb', realName: '別店の人', systemDisplayName: null, addedAt: null, tags: ['大門浜松町店'], values: { ls_name: '別' } },
];

describe('validate', () => {
  test('形式の不正を拒否する', () => {
    expect(() => validateDefinitions({})).toThrow(ImportError);
    expect(() => validateDefinitions({ ...DEFS, fields: [{ ...DEFS.fields[0], key: 'bad key' }] })).toThrow(/キー/);
    expect(() => validateDefinitions({ ...DEFS, fields: [DEFS.fields[0], DEFS.fields[0]] })).toThrow(/重複/);
    expect(() => validateFriends([{ beyondFriendId: 'x', values: { unknown: '1' } }], new Set(['ls_name']))).toThrow(/未定義/);
    expect(() => validateFriends(new Array(101).fill({ beyondFriendId: 'x' }), new Set())).toThrow(/100人/);
  });
});

describe('Lステップ引き継ぎ', () => {
  test('計画は何も書き込まない', async () => {
    const { db, sqlite } = setup();
    const defs = validateDefinitions(DEFS);
    const plan = await planDefinitions(db, defs);
    expect(plan.folders).toEqual({ total: 2, toCreate: 2 });
    expect(plan.fields).toMatchObject({ total: 3, toCreate: 2, existing: ['電話番号'] });
    expect(plan.tags).toEqual({ total: 2, toCreate: 2 });
    const fp = await planFriends(db, 'acc-a', validateFriends(FRIENDS, new Set(defs.fields.map((f) => f.key))), await loadTagIds(db));
    expect(fp).toMatchObject({ total: 3, inAccount: 2, notFoundOrOtherAccount: 1, willSetRealName: 1, withValues: 1, withTags: 1, newTagAssignments: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_field_folders').get()).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) c FROM import_batches').get()).toEqual({ c: 0 });
  });

  test('反映: 定義を作り、友だちごとの値・タグを入れる。他アカウントの友だちには触れない', async () => {
    const { db, sqlite } = setup();
    const defs = validateDefinitions(DEFS);
    const { batchId, created } = await startImport(db, defs, 'owner');
    expect(created).toEqual({ folders: 2, fields: 2, tags: 2 });
    const r = await applyFriends(db, batchId, validateFriends(FRIENDS, new Set(defs.fields.map((f) => f.key))));
    expect(r).toMatchObject({ updated: 2, skipped: 1, tagsAdded: 2, skippedIds: ['fb'] });
    await finishImport(db, batchId, { ok: true });

    const f1 = sqlite.prepare('SELECT real_name, system_display_name, metadata, created_at, first_followed_at FROM friends WHERE id=?').get('f1') as Record<string, string>;
    expect(f1.real_name).toBe('山田 太郎');
    expect(f1.system_display_name).toBe('(大門店)山田 太郎');
    expect(JSON.parse(f1.metadata)).toEqual({ memo_old: '残す', ls_name: '山田', phone: '0801', ls_first: 'あり' });
    expect(f1.created_at).toBe('2025-09-30T14:40:17.000+09:00');
    expect(f1.first_followed_at).toBe('2025-09-30T14:40:17.000+09:00');
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_tags WHERE friend_id=?').get('f1')).toEqual({ c: 2 });
    // 別アカウントの友だち(同じ人でも別の行)は、何も変わらない
    expect(sqlite.prepare('SELECT real_name, metadata FROM friends WHERE id=?').get('fb')).toEqual({ real_name: null, metadata: '{}' });
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_tags WHERE friend_id=?').get('fb')).toEqual({ c: 0 });
    // 既存の phone 定義は作り直さない
    expect(sqlite.prepare("SELECT COUNT(*) c FROM friend_field_definitions WHERE field_key='phone'").get()).toEqual({ c: 1 });
    expect(sqlite.prepare("SELECT field_type, options FROM friend_field_definitions WHERE field_key='ls_first'").get()).toEqual({ field_type: 'select', options: '["あり","なし"]' });
  });

  test('2回実行しても、タグは重複せず、定義も増えない', async () => {
    const { db, sqlite } = setup();
    const defs = validateDefinitions(DEFS);
    const keys = new Set(defs.fields.map((f) => f.key));
    const a = await startImport(db, defs, 'owner');
    await applyFriends(db, a.batchId, validateFriends(FRIENDS, keys));
    await finishImport(db, a.batchId, {});
    const b = await startImport(db, defs, 'owner');
    expect(b.created).toEqual({ folders: 0, fields: 0, tags: 0 });
    const r = await applyFriends(db, b.batchId, validateFriends(FRIENDS, keys));
    expect(r.tagsAdded).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_tags').get()).toEqual({ c: 2 });
  });

  test('元に戻す: 変更前の値に戻り、作った定義・タグも消える(他で使われ始めたものは残す)', async () => {
    const { db, sqlite } = setup();
    const defs = validateDefinitions(DEFS);
    const { batchId } = await startImport(db, defs, 'owner');
    await applyFriends(db, batchId, validateFriends(FRIENDS, new Set(defs.fields.map((f) => f.key))));
    await finishImport(db, batchId, {});
    const undone = await undoImport(db, batchId);
    expect(undone).toMatchObject({ restoredFriends: 2, removedTags: 2 });
    const f1 = sqlite.prepare('SELECT real_name, system_display_name, metadata, created_at, first_followed_at FROM friends WHERE id=?').get('f1') as Record<string, string | null>;
    expect(f1).toEqual({ real_name: null, system_display_name: null, metadata: '{"memo_old":"残す"}', created_at: '2026-09-29T00:00:00.000+09:00', first_followed_at: null });
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_tags').get()).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) c FROM tags').get()).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_field_folders').get()).toEqual({ c: 0 });
    // 元からあった phone は残る
    expect(sqlite.prepare('SELECT field_key FROM friend_field_definitions').all()).toEqual([{ field_key: 'phone' }]);
    await expect(undoImport(db, batchId)).rejects.toThrow(/取り消し済み/);
  });

  test('完了済み・存在しない取り込みには反映できない / 存在しないアカウントは拒否', async () => {
    const { db } = setup();
    await expect(startImport(db, validateDefinitions({ ...DEFS, accountId: 'nope' }), 'o')).rejects.toThrow(/公式アカウント/);
    const defs = validateDefinitions(DEFS);
    const { batchId } = await startImport(db, defs, 'o');
    await finishImport(db, batchId, {});
    await expect(applyFriends(db, batchId, [])).rejects.toThrow(/完了/);
    await expect(applyFriends(db, 'missing', [])).rejects.toThrow(/見つかりません/);
  });
});
