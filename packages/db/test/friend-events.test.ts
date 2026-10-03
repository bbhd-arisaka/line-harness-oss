import { beforeEach, describe, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordFriendEvent, listFriendEvents, changedMetadataKeys } from '../src/friend-events.js';
import { addTagToFriend, removeTagFromFriend } from '../src/tags.js';
import { upsertFriend, updateFriendFollowStatus, updateFriendRegistrationFields } from '../src/friends.js';
import { createFormSubmission } from '../src/forms.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function asD1(sqlite: Database.Database): D1Database {
  function prepare(sql: string, values: unknown[] = []) {
    return {
      bind: (...args: unknown[]) => prepare(sql, args),
      async run() {
        const info = sqlite.prepare(sql).run(...(values as never[]));
        return { results: [], success: true, meta: { changes: Number(info.changes) } };
      },
      async first<T>() {
        return (sqlite.prepare(sql).get(...(values as never[])) as T) ?? null;
      },
      async all<T>() {
        return { results: sqlite.prepare(sql).all(...(values as never[])) as T[], success: true, meta: {} };
      },
    };
  }
  return { prepare } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

function events(friendId = 'f1') {
  return sqlite
    .prepare('SELECT event_type, text, actor, detail, line_account_id FROM friend_events WHERE friend_id = ? ORDER BY rowid')
    .all(friendId) as Array<{ event_type: string; text: string; actor: string | null; detail: string | null; line_account_id: string | null }>;
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(__dirname, '../bootstrap.sql'), 'utf8'));
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('acc-a','ch-a','A店','s','t')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,metadata) VALUES('f1','U1','acc-a','たろう','{"phone":"080","addr":"東京"}')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,metadata) VALUES('f2','U2','acc-a','はなこ','{}')`);
  sqlite.exec(`INSERT INTO tags(id,name) VALUES('t1','SNS流入'),('t2','来店済み')`);
  db = asD1(sqlite);
});

describe('friend_events の記録・一覧', () => {
  test('記録した出来事を、時刻の昇順で返す(他の友だちのものは混ざらない)', async () => {
    await recordFriendEvent(db, { friendId: 'f1', type: 'blocked', text: 'ブロックされました', actor: 'LINE' });
    await recordFriendEvent(db, { friendId: 'f1', type: 'unblocked', text: 'ブロックが解除されました', detail: { a: 1 } });
    await recordFriendEvent(db, { friendId: 'f2', type: 'followed', text: '別の友だち' });
    const list = await listFriendEvents(db, 'f1');
    expect(list.map((e) => e.event_type)).toEqual(['blocked', 'unblocked']);
    expect(list[0].actor).toBe('LINE');
    expect(list[1].actor).toBeNull();
    expect(JSON.parse(list[1].detail!)).toEqual({ a: 1 });
  });

  test('新しい500件までを、昇順で返す', async () => {
    const stmt = sqlite.prepare(`INSERT INTO friend_events(id,friend_id,event_type,text,created_at) VALUES(?,?,?,?,?)`);
    for (let i = 0; i < 520; i++) {
      const sec = String(Math.floor(i / 10)).padStart(2, '0');
      stmt.run(`e${i}`, 'f1', 'blocked', `t${i}`, `2026-10-01T00:00:${sec}.${String(i % 10).padStart(3, '0')}`);
    }
    const list = await listFriendEvents(db, 'f1', { limit: 500 });
    expect(list).toHaveLength(500);
    expect(list[0].text).toBe('t20');
    expect(list[499].text).toBe('t519');
  });

  test('記録に失敗しても例外を出さない(テーブルが無い・DBエラー)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sqlite.exec('DROP TABLE friend_events');
    await expect(recordFriendEvent(db, { friendId: 'f1', type: 'blocked', text: 'x' })).resolves.toBeUndefined();
    await expect(listFriendEvents(db, 'f1')).resolves.toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('友だちを削除すると、その出来事も消える', async () => {
    sqlite.pragma('foreign_keys = ON');
    await recordFriendEvent(db, { friendId: 'f2', type: 'followed', text: 'x' });
    sqlite.exec(`DELETE FROM friends WHERE id='f2'`);
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_events').get()).toEqual({ c: 0 });
  });
});

describe('タグの付け外し', () => {
  test('付いたときだけ記録し、付け直しでは記録しない。actor を残す', async () => {
    expect(await addTagToFriend(db, 'f1', 't1', { actor: '佐藤' })).toBe(true);
    expect(await addTagToFriend(db, 'f1', 't1', { actor: '佐藤' })).toBe(false);
    expect(events()).toEqual([
      { event_type: 'tag_added', text: 'タグ「SNS流入」を追加しました', actor: '佐藤', detail: '{"tagId":"t1"}', line_account_id: 'acc-a' },
    ]);
  });

  test('外したときだけ記録し、付いていないタグを外しても記録しない', async () => {
    await addTagToFriend(db, 'f1', 't1');
    expect(await removeTagFromFriend(db, 'f1', 't2', { actor: '佐藤' })).toBe(false);
    expect(await removeTagFromFriend(db, 'f1', 't1', { actor: '佐藤' })).toBe(true);
    expect(events().map((e) => [e.event_type, e.text, e.actor])).toEqual([
      ['tag_added', 'タグ「SNS流入」を追加しました', null],
      ['tag_removed', 'タグ「SNS流入」を削除しました', '佐藤'],
    ]);
  });

  test('記録に失敗してもタグ付けは成功する', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sqlite.exec('DROP TABLE friend_events');
    await expect(addTagToFriend(db, 'f1', 't1')).resolves.toBe(true);
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_tags').get()).toEqual({ c: 1 });
    spy.mockRestore();
  });
});

describe('ブロック・ブロック解除・友だち追加', () => {
  test('新規の友だちは followed', async () => {
    const f = await upsertFriend(db, { lineUserId: 'U9', lineAccountId: 'acc-a', displayName: 'new' });
    expect(events(f.id).map((e) => [e.event_type, e.text, e.actor])).toEqual([['followed', '友だち追加されました', 'LINE']]);
  });

  test('1→0 は blocked、0→1 は unblocked。変化しないときは記録しない', async () => {
    await updateFriendFollowStatus(db, 'U1', true, 'acc-a'); // すでに追加済み
    expect(events()).toHaveLength(0);
    await updateFriendFollowStatus(db, 'U1', false, 'acc-a');
    await updateFriendFollowStatus(db, 'U1', false, 'acc-a'); // 重複したブロック通知
    await upsertFriend(db, { lineUserId: 'U1', lineAccountId: 'acc-a', displayName: 'たろう' });
    await upsertFriend(db, { lineUserId: 'U1', lineAccountId: 'acc-a', displayName: 'たろう' }); // 追加済みの再通知
    expect(events().map((e) => [e.event_type, e.text])).toEqual([
      ['blocked', 'ブロックされました'],
      ['unblocked', 'ブロックが解除されました'],
    ]);
  });

  test('ブロックの記録が無い再登録は followed', async () => {
    sqlite.exec(`UPDATE friends SET is_following = 0 WHERE id = 'f1'`);
    await updateFriendFollowStatus(db, 'U1', true, 'acc-a');
    expect(events().map((e) => e.event_type)).toEqual(['followed']);
  });
});

describe('フォーム回答', () => {
  test('友だちが特定できる回答だけ、フォーム名つきで記録する', async () => {
    sqlite.exec(`INSERT INTO forms(id,name,fields) VALUES('form1','カウンセリング','[]')`);
    await createFormSubmission(db, { formId: 'form1', friendId: 'f1', data: '{}' });
    await createFormSubmission(db, { formId: 'form1', friendId: null, data: '{}' });
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_events').get()).toEqual({ c: 1 });
    expect(events().map((e) => [e.event_type, e.text, e.actor])).toEqual([
      ['form_submitted', 'フォーム「カウンセリング」に回答しました', 'フォーム'],
    ]);
  });
});

describe('友だち情報・プロフィールの変更', () => {
  beforeEach(() => {
    sqlite.exec(`INSERT INTO friend_field_definitions(id,field_key,label,field_type) VALUES('d1','phone','電話番号','text'),('d2','addr','住所','text')`);
  });

  test('変わった項目だけ、ラベルで記録する(値は入れない)', async () => {
    await updateFriendRegistrationFields(db, 'f1', { metadataPatch: { phone: '090', addr: '東京', zzz: 'x' } }, { actor: '佐藤' });
    const e = events();
    expect(e).toHaveLength(1);
    expect(e[0].event_type).toBe('friend_info_changed');
    expect(e[0].text).toBe('友だち情報「電話番号」「zzz」を変更しました'); // 定義が無いキーはキー名
    expect(e[0].actor).toBe('佐藤');
    expect(JSON.parse(e[0].detail!)).toEqual({ fields: ['電話番号', 'zzz'] });
    expect(JSON.stringify(e)).not.toContain('090');
  });

  test('値が同じなら記録しない。null での削除は変更として記録する', async () => {
    await updateFriendRegistrationFields(db, 'f1', { metadataPatch: { phone: '080' } });
    expect(events()).toHaveLength(0);
    await updateFriendRegistrationFields(db, 'f1', { metadataPatch: { addr: null } });
    expect(events().map((e) => e.text)).toEqual(['友だち情報「住所」を変更しました']);
  });

  test('本名・システム表示名・個別メモは、変わった項目をまとめて記録する(値は入れない)', async () => {
    await updateFriendRegistrationFields(db, 'f1', { realName: '山田', systemDisplayName: '山田さん', memo: '' }, { actor: 'フォーム' });
    await updateFriendRegistrationFields(db, 'f1', { realName: '山田', memo: 'ひみつメモ' });
    expect(events().map((e) => [e.event_type, e.text, e.actor])).toEqual([
      ['profile_changed', '本名・システム表示名を変更しました', 'フォーム'],
      ['profile_changed', '個別メモを変更しました', null],
    ]);
    expect(JSON.stringify(events())).not.toContain('ひみつメモ');
    expect(JSON.stringify(events())).not.toContain('山田');
  });

  test('changedMetadataKeys', () => {
    expect(changedMetadataKeys({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2], c: null, d: 'x' })).toEqual(['d']);
    expect(changedMetadataKeys({ a: 1 }, { a: null })).toEqual(['a']);
  });
});
