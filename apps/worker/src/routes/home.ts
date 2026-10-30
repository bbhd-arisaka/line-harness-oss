import { Hono } from 'hono';
import { getLineAccountById } from '@line-crm/db';
import { loadHomeSummary, type HomeSummary } from '../services/home-summary.js';
import { loadFormAnalytics, type FormAnalytics } from '../services/form-analytics.js';
import type { Env } from '../index.js';

const home = new Hono<Env>();

// 同じアカウントを短い間に何度も開いても、集計を作り直さない(D1 の読み取りを抑える)。?fresh=1 で、すぐ作り直す
const CACHE_TTL_MS = 45_000;
const cache = new Map<string, { at: number; data: HomeSummary }>();

/** ホーム(トップ)画面の集計。アプリ・Web が同じものを使う。アカウントの指定が必須 */
home.get('/api/home', async (c) => {
  try {
    const accountId = c.req.query('lineAccountId');
    if (!accountId) return c.json({ success: false, error: '公式アカウントを指定してください' }, 400);
    const allowed = c.get('allowedAccountIds');
    if (allowed && !allowed.includes(accountId)) return c.json({ success: false, error: 'Forbidden' }, 403);

    const now = Date.now();
    const hit = cache.get(accountId);
    if (hit && c.req.query('fresh') !== '1' && now - hit.at < CACHE_TTL_MS) {
      return c.json({ success: true, data: hit.data });
    }
    const account = await getLineAccountById(c.env.DB, accountId);
    if (!account) return c.json({ success: false, error: 'アカウントが見つかりません' }, 404);

    const data = await loadHomeSummary(c.env.DB, account, now);
    if (cache.size > 50) cache.clear();
    cache.set(accountId, { at: now, data });
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/home error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

const analyticsCache = new Map<string, { at: number; data: FormAnalytics }>();

/** ホームの「フォーム分析」。フォーム×月の回答数(足し合わせは端末側)。アカウントの指定が必須 */
home.get('/api/home/form-analytics', async (c) => {
  try {
    const accountId = c.req.query('lineAccountId');
    if (!accountId) return c.json({ success: false, error: '公式アカウントを指定してください' }, 400);
    const allowed = c.get('allowedAccountIds');
    if (allowed && !allowed.includes(accountId)) return c.json({ success: false, error: 'Forbidden' }, 403);

    const now = Date.now();
    const hit = analyticsCache.get(accountId);
    if (hit && c.req.query('fresh') !== '1' && now - hit.at < CACHE_TTL_MS) {
      return c.json({ success: true, data: hit.data });
    }
    const data = await loadFormAnalytics(c.env.DB, accountId, now);
    if (analyticsCache.size > 50) analyticsCache.clear();
    analyticsCache.set(accountId, { at: now, data });
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/home/form-analytics error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { home };
