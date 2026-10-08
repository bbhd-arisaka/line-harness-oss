import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { refreshFriendProfile, refreshStaleProfiles } from './profile-refresh.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_secret,channel_access_token) VALUES('a','ch-a','A店','s','tok-a')`);
  sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,display_name,picture_url,is_following) VALUES
    ('f1','U1','a','はなこ','https://old/1',1),
    ('f2','U2','a',NULL,NULL,1),
    ('f3','U3','a','ブロック中','https://old/3',0)`);
  return { db, sqlite };
}

describe('プロフィールの取り直し', () => {
  test('画像・ステータスメッセージを取り直す。名前は、空のときだけ埋める(付け替えた名前は上書きしない)', async () => {
    const { db, sqlite } = setup();
    const fetchProfile = async (userId: string) => ({ displayName: `LINE名-${userId}`, pictureUrl: `https://new/${userId}`, statusMessage: 'こんにちは' });
    const r1 = await refreshFriendProfile(db, { id: 'f1', line_user_id: 'U1' }, 't', fetchProfile);
    expect(r1).toMatchObject({ ok: true, pictureUrl: 'https://new/U1', displayName: 'はなこ' });
    const r2 = await refreshFriendProfile(db, { id: 'f2', line_user_id: 'U2' }, 't', fetchProfile);
    expect(r2).toMatchObject({ ok: true, displayName: 'LINE名-U2' });
    expect(sqlite.prepare("SELECT profile_checked_at FROM friends WHERE id='f1'").get()).not.toEqual({ profile_checked_at: null });
  });

  test('画像を設定していない人(LINEが画像を返さない)は、画像なしに戻す。取れなかった人も、確認日時は残す', async () => {
    const { db, sqlite } = setup();
    const noPic = await refreshFriendProfile(db, { id: 'f1', line_user_id: 'U1' }, 't', async () => ({ displayName: 'はなこ' }));
    expect(noPic.pictureUrl).toBeNull();
    const failed = await refreshFriendProfile(db, { id: 'f2', line_user_id: 'U2' }, 't', async () => {
      throw new Error('LINE API error: 404');
    });
    expect(failed).toMatchObject({ ok: false, reason: expect.stringContaining('404') });
    expect((sqlite.prepare("SELECT profile_checked_at AS c FROM friends WHERE id='f2'").get() as { c: string | null }).c).not.toBeNull();
  });

  test('定期の取り直し: 古い順に limit 人。ブロック中は対象外。取り直し済みは、期間内なら対象外', async () => {
    const { db, sqlite } = setup();
    let calls = 0;
    const fetchProfile = async (userId: string) => {
      calls++;
      return { displayName: userId, pictureUrl: `https://new/${userId}` };
    };
    const first = await refreshStaleProfiles(db, { limit: 1, fetchProfile });
    expect(first).toEqual({ processed: 1, updated: 1 });
    const second = await refreshStaleProfiles(db, { limit: 5, fetchProfile });
    expect(second.processed).toBe(1); // もう1人(f1/f2のうち、まだの人)。f3 はブロック中
    const third = await refreshStaleProfiles(db, { limit: 5, fetchProfile });
    expect(third.processed).toBe(0);
    expect(calls).toBe(2);
    expect((sqlite.prepare("SELECT profile_checked_at AS c FROM friends WHERE id='f3'").get() as { c: string | null }).c).toBeNull();
  });
});
