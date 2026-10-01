import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import {
  ImportError,
  applyFormConfigs,
  applyFriends,
  applyMessages,
  applySubmissions,
  finishImport,
  planMessages,
  planDefinitions,
  planFriends,
  loadTagIds,
  startImport,
  undoImport,
  validateDefinitions,
  validateFormConfigs,
  validateFriends,
  validateMessages,
  validateSubmissions,
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

describe('フォーム(代入先の是正・回答結果の取り込み)', () => {
  const FORM_FIELDS = [
    { name: 'name', label: 'お名前', type: 'text', registrationTargets: [{ type: 'real_name' }] },
    { name: 'q1', label: '経験', type: 'radio', options: ['はい', 'いいえ'] },
  ];
  function setupForm() {
    const s = setup();
    s.sqlite.prepare("INSERT INTO forms (id, name, fields, save_to_metadata, submit_count) VALUES ('form-1', 'カウンセリング', ?, 1, 1)").run(JSON.stringify(FORM_FIELDS));
    s.sqlite.prepare("INSERT INTO form_submissions (id, form_id, friend_id, data) VALUES ('old', 'form-1', 'f1', '{}')").run();
    return s;
  }
  const CONFIGS = [{
    formId: 'form-1', saveToMetadata: false,
    fields: {
      name: { registrationTargets: [{ type: 'friend_field', fieldKey: 'ls_name' }] },
      q1: { friendFieldKey: 'ls_first', optionFriendFieldValues: { はい: 'あり', いいえ: 'なし' } },
    },
    addFields: [{ name: 'lstep_extra_1', label: '追加(Lステップ)', type: 'text', hidden: true }],
  }];
  const subs = (n = 2) => Array.from({ length: n }, (_, i) => ({
    formId: 'form-1', beyondFriendId: i === 0 ? 'f1' : 'fb', createdAt: '2025-10-28T13:07:04.000+09:00',
    data: { name: '山田', q1: 'はい', _lstep: { key: 'lstep:1:' + i, answerId: String(i) } },
  }));

  test('代入先を直し(本名への誤登録をやめる)、隠し項目を足し、保存設定を切る。元に戻せる', async () => {
    const { db, sqlite } = setupForm();
    const defs = validateDefinitions(DEFS);
    const { batchId } = await startImport(db, defs, 'o');
    const r = await applyFormConfigs(db, batchId, validateFormConfigs(CONFIGS));
    expect(r).toEqual({ formsUpdated: 1, fieldsPatched: 2, hiddenAdded: 1 });
    const row = sqlite.prepare('SELECT fields, save_to_metadata FROM forms WHERE id=?').get('form-1') as { fields: string; save_to_metadata: number };
    const fields = JSON.parse(row.fields) as Array<Record<string, unknown>>;
    expect(row.save_to_metadata).toBe(0);
    expect(fields[0].registrationTargets).toEqual([{ type: 'friend_field', fieldKey: 'ls_name' }]);
    expect(fields[1]).toMatchObject({ friendFieldKey: 'ls_first', optionFriendFieldValues: { はい: 'あり', いいえ: 'なし' } });
    expect(fields[2]).toMatchObject({ name: 'lstep_extra_1', hidden: true });
    await finishImport(db, batchId, {});
    const u = await undoImport(db, batchId);
    expect(u.restoredForms).toBe(1);
    const back = sqlite.prepare('SELECT fields, save_to_metadata FROM forms WHERE id=?').get('form-1') as { fields: string; save_to_metadata: number };
    expect(JSON.parse(back.fields)).toEqual(FORM_FIELDS);
    expect(back.save_to_metadata).toBe(1);
  });

  test('回答の取り込み: 友だちに紐づけ(別アカウントの友だちは未紐づけ)、2回目は重複しない、件数が合う', async () => {
    const { db, sqlite } = setupForm();
    const { batchId } = await startImport(db, validateDefinitions(DEFS), 'o');
    const r = await applySubmissions(db, batchId, validateSubmissions(subs()));
    expect(r).toEqual({ added: 2, skipped: 0, detached: 1 });
    expect(sqlite.prepare('SELECT friend_id FROM form_submissions WHERE id != ? ORDER BY created_at, friend_id').all('old')).toEqual([{ friend_id: null }, { friend_id: 'f1' }]);
    expect(sqlite.prepare("SELECT submit_count c FROM forms WHERE id='form-1'").get()).toEqual({ c: 3 });
    // 同じ回答は入らない
    const again = await applySubmissions(db, batchId, validateSubmissions(subs()));
    expect(again).toEqual({ added: 0, skipped: 2, detached: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) c FROM form_submissions").get()).toEqual({ c: 3 });
    // 元に戻すと、取り込んだ分だけ消え、既存の回答と件数は残る
    await finishImport(db, batchId, {});
    const u = await undoImport(db, batchId);
    expect(u.removedSubmissions).toBe(2);
    expect(sqlite.prepare("SELECT COUNT(*) c FROM form_submissions").get()).toEqual({ c: 1 });
    expect(sqlite.prepare("SELECT submit_count c FROM forms WHERE id='form-1'").get()).toEqual({ c: 1 });
  });

  test('形式の不正を拒否する', () => {
    expect(() => validateSubmissions([{ formId: 'f', createdAt: '2025-10-28 13:07:04', data: { _lstep: { key: 'k' } } }])).toThrow(/日時/);
    expect(() => validateSubmissions([{ formId: 'f', createdAt: '2025-10-28T13:07:04.000+09:00', data: {} }])).toThrow(/形式/);
    expect(() => validateFormConfigs([{ formId: 'f', fields: { a: { registrationTargets: [{ type: 'bogus' }] } } }])).toThrow(/代入先/);
    expect(() => validateFormConfigs([{ formId: 'f', fields: {}, addFields: [{ name: 'bad name', label: 'x' }] }])).toThrow(/名前/);
  });
});

describe('トーク履歴の取り込み', () => {
  const msgs = () => [
    { id: '1001', beyondFriendId: 'f1', direction: 'outgoing', messageType: 'text', content: 'こんにちは', source: 'manual', createdAt: '2025-10-28T13:07:04.000+09:00' },
    { id: '1002', beyondFriendId: 'f1', direction: 'incoming', messageType: 'text', content: '予約したいです', source: 'user', createdAt: '2025-10-28T13:09:00.000+09:00' },
    { id: '1003', beyondFriendId: 'f1', direction: 'outgoing', messageType: 'flex', content: JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } }), source: 'broadcast', createdAt: '2025-11-01T10:00:00.000+09:00' },
    { id: '1004', beyondFriendId: 'fb', direction: 'incoming', messageType: 'text', content: '別アカウントの人', source: 'user', createdAt: '2025-11-02T10:00:00.000+09:00' },
  ];

  test('取り込み: 別アカウントの友だちは入れない。印が付き、未読・チャットには触れない', async () => {
    const { db, sqlite } = setup();
    sqlite.exec("INSERT INTO chats (id, friend_id, status) VALUES ('c1', 'f1', 'resolved')");
    const plan = await planMessages(db, 'acc-a', validateMessages(msgs()));
    expect(plan).toMatchObject({ total: 4, text: 3, flex: 1, outgoing: 2, incoming: 2, friendNotInAccount: 1, alreadyImported: 0 });
    const { batchId } = await startImport(db, validateDefinitions(DEFS), 'o');
    const r = await applyMessages(db, batchId, validateMessages(msgs()));
    expect(r).toEqual({ added: 3, skipped: 0, nearDuplicates: 0, friendNotInAccount: 1 });
    const rows = sqlite.prepare('SELECT id, friend_id, direction, message_type, source, line_account_id, import_batch_id FROM messages_log ORDER BY created_at').all() as Array<Record<string, string>>;
    expect(rows.map((x) => x.id)).toEqual(['lstep:1001', 'lstep:1002', 'lstep:1003']);
    expect(rows.every((x) => x.line_account_id === 'acc-a' && x.import_batch_id === batchId)).toBe(true);
    expect(sqlite.prepare("SELECT status FROM chats WHERE id='c1'").get()).toEqual({ status: 'resolved' });
    // 2回目は入らない
    expect(await applyMessages(db, batchId, validateMessages(msgs()))).toMatchObject({ added: 0, skipped: 3 });
    // 元に戻す
    await finishImport(db, batchId, {});
    expect((await undoImport(db, batchId)).removedMessages).toBe(3);
    expect(sqlite.prepare('SELECT COUNT(*) c FROM messages_log').get()).toEqual({ c: 0 });
  });

  test('並行運用の期間にすでに記録されている受信メッセージは、重複して入れない(送信側は入れる)', async () => {
    const { db, sqlite } = setup();
    sqlite.prepare("INSERT INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at) VALUES ('existing', 'f1', 'incoming', 'text', 'こんにちは', 'user', 'acc-a', '2026-09-30T20:05:30.000+09:00')").run();
    const { batchId } = await startImport(db, validateDefinitions(DEFS), 'o');
    const r = await applyMessages(db, batchId, validateMessages([
      { id: '2001', beyondFriendId: 'f1', direction: 'incoming', messageType: 'text', content: 'こんにちは', source: 'user', createdAt: '2026-09-30T20:05:28.000+09:00' },
      { id: '2002', beyondFriendId: 'f1', direction: 'outgoing', messageType: 'text', content: '返信', source: 'manual', createdAt: '2026-09-30T20:06:00.000+09:00' },
    ]));
    expect(r).toMatchObject({ added: 1, nearDuplicates: 1 });
  });

  test('形式の不正を拒否する', () => {
    expect(() => validateMessages([{ id: 'x', beyondFriendId: 'f1', direction: 'incoming', messageType: 'text', content: 'a', source: 'user', createdAt: '2025-10-28T13:07:04.000+09:00' }])).toThrow(/ID/);
    expect(() => validateMessages([{ id: '1', beyondFriendId: 'f1', direction: 'incoming', messageType: 'flex', content: 'not json', source: 'user', createdAt: '2025-10-28T13:07:04.000+09:00' }])).toThrow(/JSON/);
    expect(() => validateMessages(new Array(201).fill({}))).toThrow(/200件/);
  });
});
