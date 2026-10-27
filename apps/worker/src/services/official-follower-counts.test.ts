import { describe, expect, it, vi } from 'vitest';
import { getOfficialFollowerCounts, toOfficialCounts } from './official-follower-counts.js';

describe('toOfficialCounts', () => {
  it('友だち = 友だち追加数 − ブロック数', () => {
    expect(toOfficialCounts({ status: 'ready', followers: 101, targetedReaches: 80, blocks: 5 }, '20261026')).toEqual({
      friends: 96,
      blocks: 5,
      date: '20261026',
    });
  });

  it('集計前・数が欠けているときは null', () => {
    expect(toOfficialCounts({ status: 'unready' }, '20261026')).toBeNull();
    expect(toOfficialCounts({ status: 'ready', followers: 10 }, '20261026')).toBeNull();
    expect(toOfficialCounts(null, '20261026')).toBeNull();
  });
});

describe('getOfficialFollowerCounts', () => {
  const now = new Date('2026-10-27T03:00:00Z'); // 日本時間 10/27 12:00

  it('前日の集計を使う', async () => {
    const client = { getFollowersInsight: vi.fn().mockResolvedValue({ status: 'ready', followers: 540, blocks: 6 }) };
    await expect(getOfficialFollowerCounts(client, 'acc', now)).resolves.toEqual({ friends: 534, blocks: 6, date: '20261026' });
    expect(client.getFollowersInsight).toHaveBeenCalledWith('20261026');
  });

  it('前日が集計前なら前々日', async () => {
    const client = {
      getFollowersInsight: vi.fn(async (date: string) =>
        date === '20261026' ? { status: 'unready' } : { status: 'ready', followers: 538, blocks: 6 },
      ),
    };
    await expect(getOfficialFollowerCounts(client, 'acc', now)).resolves.toEqual({ friends: 532, blocks: 6, date: '20261025' });
  });

  it('LINE が失敗したら null(これまでの数え方に戻す)', async () => {
    const client = { getFollowersInsight: vi.fn().mockRejectedValue(new Error('LINE API error: 401')) };
    await expect(getOfficialFollowerCounts(client, 'acc', now)).resolves.toBeNull();
  });
});
