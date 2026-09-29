import { describe, expect, test, vi } from 'vitest';

const fallback = vi.hoisted(() => vi.fn());
vi.mock('@line-crm/db', () => ({ getFriendByLineUserId: fallback }));

import { findCallerFriend } from './caller-friend';

/** line_accounts / friends を引くだけの D1 疑似。 */
function fakeDb(rows: { accountByLiff?: Record<string, string>; friends?: Array<{ id: string; line_user_id: string; line_account_id: string }> }) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('FROM line_accounts')) {
            const id = rows.accountByLiff?.[String(args[0])];
            return id ? { id } : null;
          }
          return rows.friends?.find((f) => f.line_user_id === args[0] && f.line_account_id === args[1]) ?? null;
        },
      }),
    }),
  } as unknown as D1Database;
}

const friends = [
  { id: 'friend-recruit', line_user_id: 'U1', line_account_id: 'acc-recruit' },
  { id: 'friend-daimon', line_user_id: 'U1', line_account_id: 'acc-daimon' },
];

describe('findCallerFriend', () => {
  test('同じLINEユーザーが2アカウントの友だちでも、開いたLIFFのアカウントの友だちを返す', async () => {
    const db = fakeDb({ accountByLiff: { 'LIFF-D': 'acc-daimon', 'LIFF-R': 'acc-recruit' }, friends });
    expect((await findCallerFriend(db, 'U1', 'LIFF-D'))?.id).toBe('friend-daimon');
    expect((await findCallerFriend(db, 'U1', 'LIFF-R'))?.id).toBe('friend-recruit');
    expect(fallback).not.toHaveBeenCalled();
  });

  test('LIFF IDが無い・不明な場合は、従来どおりユーザーIDだけで探す', async () => {
    fallback.mockResolvedValue({ id: 'friend-any' });
    const db = fakeDb({ accountByLiff: { 'LIFF-D': 'acc-daimon' }, friends });
    expect((await findCallerFriend(db, 'U1', null))?.id).toBe('friend-any');
    expect((await findCallerFriend(db, 'U1', 'LIFF-UNKNOWN'))?.id).toBe('friend-any');
  });

  test('そのアカウントの友だちがまだ居なければ、ユーザーIDだけで探す', async () => {
    fallback.mockResolvedValue({ id: 'friend-other' });
    const db = fakeDb({ accountByLiff: { 'LIFF-N': 'acc-new' }, friends });
    expect((await findCallerFriend(db, 'U1', 'LIFF-N'))?.id).toBe('friend-other');
  });
});
