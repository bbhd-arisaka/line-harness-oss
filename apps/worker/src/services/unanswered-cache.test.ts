import { describe, expect, test, vi } from 'vitest';
import { countUnanswered, invalidateUnansweredCache } from './unanswered-inbox.js';

function fakeDb() {
  const all = vi.fn(async () => ({ results: [] }));
  const prepare = vi.fn(() => ({ all }));
  return { db: { prepare } as unknown as D1Database, prepare };
}

describe('未対応の集計は短時間だけ使い回す(D1の読み取り上限対策)', () => {
  test('続けて呼んでもDBは1回だけ。無効化すると、次はもう一度読む', async () => {
    const { db, prepare } = fakeDb();
    await countUnanswered(db);
    await countUnanswered(db);
    await Promise.all([countUnanswered(db), countUnanswered(db)]);
    expect(prepare).toHaveBeenCalledTimes(1);
    invalidateUnansweredCache(db);
    await countUnanswered(db);
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});
