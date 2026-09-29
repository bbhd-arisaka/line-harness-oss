import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { getFriendByLineUserIdForAccount, updateFriendFollowStatus, upsertFriend } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { findCallerFriend } from './caller-friend.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const PERSON = 'U0123456789abcdef0123456789abcdef';

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token,liff_id)
    VALUES('acc-a','ch-a','店舗A','s','t','LIFF-A'),('acc-b','ch-b','店舗B','s','t','LIFF-B')`);
  return { db, sqlite };
}

/**
 * 実際のSQLite(本番と同じスキーマ)で、「同じ人が2つの公式アカウントを友だち追加した」場面を通しで確認する。
 */
describe('同じ人が2つの公式アカウントの友だちになる', () => {
  test('アカウントごとに別の友だち行になり、片方の操作がもう片方に影響しない', async () => {
    const { db, sqlite } = setup();

    const a = await upsertFriend(db, { lineUserId: PERSON, lineAccountId: 'acc-a', displayName: 'A店での名前' });
    const b = await upsertFriend(db, { lineUserId: PERSON, lineAccountId: 'acc-b', displayName: 'B店での名前' });

    // 行が2つに分かれ、内部キーも別々、LINEへ送る実IDはどちらも同じ
    expect(a.id).not.toBe(b.id);
    expect(a.line_account_id).toBe('acc-a');
    expect(b.line_account_id).toBe('acc-b');
    expect(a.line_user_id).toBe(PERSON);
    expect(b.line_user_id).toBe(PERSON);
    expect(sqlite.prepare('SELECT line_user_key k FROM friends ORDER BY created_at, id').all().map((r) => (r as { k: string }).k).sort())
      .toEqual([PERSON, `${PERSON}#acc-b`].sort());

    // タグ・メタデータ・メモは行ごとに独立
    sqlite.exec(`INSERT INTO tags(id,name) VALUES('t1','来店済み')`);
    sqlite.prepare('INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,?)').run(a.id, 't1');
    sqlite.prepare(`UPDATE friends SET metadata='{"k":"A"}', memo='Aのメモ' WHERE id=?`).run(a.id);
    const bAfter = sqlite.prepare('SELECT metadata, memo FROM friends WHERE id=?').get(b.id) as { metadata: string; memo: string | null };
    expect(bAfter.metadata).toBe('{}');
    expect(bAfter.memo).toBeNull();
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friend_tags WHERE friend_id=?').get(b.id)).toEqual({ c: 0 });

    // Bだけブロック → Aは友だちのまま
    await updateFriendFollowStatus(db, PERSON, false, 'acc-b');
    expect((sqlite.prepare('SELECT is_following f FROM friends WHERE id=?').get(a.id) as { f: number }).f).toBe(1);
    expect((sqlite.prepare('SELECT is_following f FROM friends WHERE id=?').get(b.id) as { f: number }).f).toBe(0);

    // Bを再フォロー(upsert)しても、Aの行・所属は変わらない
    const b2 = await upsertFriend(db, { lineUserId: PERSON, lineAccountId: 'acc-b', displayName: 'B店での名前(更新)' });
    expect(b2.id).toBe(b.id);
    expect(b2.is_following).toBe(1);
    expect((await getFriendByLineUserIdForAccount(db, PERSON, 'acc-a'))?.display_name).toBe('A店での名前');
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friends').get()).toEqual({ c: 2 });
  });

  test('フォームを開いたLIFFのアカウントの友だちに記録される(他アカウントにはフォールバックしない)', async () => {
    const { db } = setup();
    const a = await upsertFriend(db, { lineUserId: PERSON, lineAccountId: 'acc-a' });
    const b = await upsertFriend(db, { lineUserId: PERSON, lineAccountId: 'acc-b' });
    expect((await findCallerFriend(db, PERSON, 'LIFF-A'))?.id).toBe(a.id);
    expect((await findCallerFriend(db, PERSON, 'LIFF-B'))?.id).toBe(b.id);
  });

  test('片方のアカウントにしか居ない人は、もう片方のLIFFでは友だちとして見つからない', async () => {
    const { db } = setup();
    await upsertFriend(db, { lineUserId: PERSON, lineAccountId: 'acc-a' });
    expect(await findCallerFriend(db, PERSON, 'LIFF-B')).toBeNull();
  });

  test('同じアカウントで重複して行を作ろうとしても、1行のまま', async () => {
    const { db, sqlite } = setup();
    const first = await upsertFriend(db, { lineUserId: PERSON, lineAccountId: 'acc-a' });
    const again = await upsertFriend(db, { lineUserId: PERSON, lineAccountId: 'acc-a' });
    expect(again.id).toBe(first.id);
    expect(sqlite.prepare('SELECT COUNT(*) c FROM friends').get()).toEqual({ c: 1 });
  });
});
