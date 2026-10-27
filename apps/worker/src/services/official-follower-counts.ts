import type { FollowersInsight } from '@line-crm/line-sdk';
import { jstYyyyMmDd } from './quota.js';

/** LINE 公式の友だち数(ブロック中を除く)とブロック数。LINE の集計は1日1回なので、前日(集計前なら前々日)の数 */
export interface OfficialFollowerCounts {
  /** 友だち(ブロック中を除く) = 友だち追加数 − ブロック数 */
  friends: number;
  blocks: number;
  /** 集計日(yyyyMMdd) */
  date: string;
}

interface InsightSource {
  getFollowersInsight(date: string): Promise<FollowersInsight>;
}

/** 集計済み('ready')は6時間、集計待ちは30分だけ覚えておく(LINE の統計APIは1時間60回まで) */
const READY_TTL_SEC = 6 * 3600;
const UNREADY_TTL_SEC = 30 * 60;

/**
 * LINE の友だち統計(GET /v2/bot/insight/followers)を、Workers Cache を挟んで取る。
 * 'ready' になった過去日の数は変わらないので長めに、集計待ちは短めに覚える(画面を開くたびに LINE を呼ばない)。
 * caches.default が無い環境(vitest/node)では、そのまま LINE を呼ぶ。
 */
export async function getFollowersInsightCached(
  client: InsightSource,
  lineAccountId: string,
  date: string,
): Promise<FollowersInsight> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  // 配信状況(delivery-health)の覚え方(集計待ちは覚えない)と混ざらないよう、別の置き場にする
  const key = `https://line-harness.internal/official-insight/${encodeURIComponent(lineAccountId)}/${date}`;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return (await hit.json()) as FollowersInsight;
    } catch {
      // 読めなくても、LINE に聞けばよい
    }
  }
  const insight = await client.getFollowersInsight(date);
  if (cache) {
    try {
      const ttl = insight.status === 'ready' ? READY_TTL_SEC : UNREADY_TTL_SEC;
      await cache.put(
        key,
        new Response(JSON.stringify(insight), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
        }),
      );
    } catch {
      // 覚えられなくても、次に取り直すだけ
    }
  }
  return insight;
}

/** 集計済みの統計から、友だち数・ブロック数を作る。数が欠けていれば null */
export function toOfficialCounts(insight: FollowersInsight | null | undefined, date: string): OfficialFollowerCounts | null {
  if (!insight || insight.status !== 'ready') return null;
  if (typeof insight.followers !== 'number' || typeof insight.blocks !== 'number') return null;
  return { friends: Math.max(0, insight.followers - insight.blocks), blocks: insight.blocks, date };
}

/**
 * LINE 公式の友だち数・ブロック数(公式アカウントの管理画面と同じ数)。
 * 前日が集計前なら前々日を使う。取れなければ null(呼び出し側は、これまでの数え方に戻す)。
 */
export async function getOfficialFollowerCounts(
  client: InsightSource,
  lineAccountId: string,
  now: Date = new Date(),
): Promise<OfficialFollowerCounts | null> {
  for (const daysAgo of [1, 2]) {
    const date = jstYyyyMmDd(daysAgo, now);
    try {
      const counts = toOfficialCounts(await getFollowersInsightCached(client, lineAccountId, date), date);
      if (counts) return counts;
    } catch {
      return null;
    }
  }
  return null;
}
