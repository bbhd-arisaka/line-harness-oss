import type { EntryRoute } from '@line-crm/db';
import { DEFAULT_OUT_OF_PERIOD_MESSAGE } from './inflow-route-input.js';

/**
 * 流入経路(/r/:ref)の、着地ページまわりの純粋な部品: 有効期間外・位置情報のページ、HTMLタグの差し込み、
 * 広告パラメータの受け渡し、広告挿入タグのスクリプト。
 */

/** 広告のクリックIDなど、流入経路が設定しなくても、集計の「クエリパラメータ」に残すもの */
export const STANDARD_QUERY_KEYS = ['gclid', 'fbclid', 'twclid', 'ttclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const MAX_KEYS = 30;
const MAX_VALUE = 500;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function adParamMapOf(route: Pick<EntryRoute, 'ad_param_map'>): Array<{ param: string; fieldKey: string }> {
  try {
    const v = route.ad_param_map ? (JSON.parse(route.ad_param_map) as unknown) : [];
    return Array.isArray(v) ? (v as Array<{ param: string; fieldKey: string }>) : [];
  } catch {
    return [];
  }
}

/** URL のクエリから、集計に残すもの(広告連携で設定したパラメータ+広告の標準パラメータ)だけを取り出す */
export function collectInflowQuery(query: Record<string, string>, route: Pick<EntryRoute, 'ad_param_map'>): Record<string, string> {
  const keys = new Set([...STANDARD_QUERY_KEYS, ...adParamMapOf(route).map((m) => m.param)]);
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = query[k];
    if (typeof v === 'string' && v !== '') out[k] = v.slice(0, MAX_VALUE);
    if (Object.keys(out).length >= MAX_KEYS) break;
  }
  return out;
}

/** LIFF に引き継ぐ(`iqp`)ための、クエリの文字列。空なら null */
export function encodeInflowQuery(q: Record<string, string>): string | null {
  return Object.keys(q).length > 0 ? JSON.stringify(q) : null;
}

/** LIFF から届いた `iqp` を、検査して取り出す */
export function parseInflowQuery(raw: unknown): Record<string, string> | null {
  if (typeof raw !== 'string' || raw === '' || raw.length > 8000) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(k)) continue;
      out[k] = val.slice(0, MAX_VALUE);
      if (Object.keys(out).length >= MAX_KEYS) break;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

const PAGE_STYLE =
  "*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Hiragino Sans','Helvetica Neue',system-ui,sans-serif;background:#f5f7f5;display:flex;justify-content:center;align-items:center;min-height:100vh}.card{background:#fff;border-radius:20px;box-shadow:0 2px 20px rgba(0,0,0,.06);text-align:center;max-width:360px;width:90%;padding:40px 28px;border:1px solid rgba(0,0,0,.04)}.msg{font-size:15px;color:#444;font-weight:500;line-height:1.7;white-space:pre-wrap}";

function messagePage(message: string, extraBody = ''): string {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(message.split('\n')[0] || '')}</title><style>${PAGE_STYLE}</style></head><body><div class="card"><p class="msg">${escapeHtml(message)}</p></div>${extraBody}</body></html>`;
}

/** 有効期間の外のとき。メッセージは流入経路ごとに設定でき、なければ既定 */
export function outOfPeriodPage(route: Pick<EntryRoute, 'out_of_period_message'>): string {
  return messagePage(route.out_of_period_message?.trim() || DEFAULT_OUT_OF_PERIOD_MESSAGE);
}

export const OUT_OF_AREA_MESSAGE = 'この場所からはご利用いただけません';
export const GEO_DENIED_MESSAGE = '位置情報の利用を許可してください';

/** 位置情報の有効範囲があるとき、まず現在地をたずねるページ。許可されると、緯度経度をつけて同じURLを開き直す */
export function geoRequestPage(): string {
  const script = `<script>(function(){var m=document.querySelector('.msg');function go(p){var u=new URL(location.href);u.searchParams.set('_lat',String(p.coords.latitude));u.searchParams.set('_lng',String(p.coords.longitude));location.replace(u.toString())}function ng(){m.textContent=${JSON.stringify(GEO_DENIED_MESSAGE)}}if(!navigator.geolocation){ng();return}navigator.geolocation.getCurrentPosition(go,ng,{enableHighAccuracy:true,timeout:15000,maximumAge:0})})();</script>`;
  return messagePage('位置情報を確認しています', script);
}

export function outOfAreaPage(): string {
  return messagePage(OUT_OF_AREA_MESSAGE);
}

/** 流入経路の HTMLタグ(head / body)を、着地ページに差し込む */
export function injectHtml(html: string, route: Pick<EntryRoute, 'html_head' | 'html_body'>): string {
  let out = html;
  if (route.html_head) out = out.includes('</head>') ? out.replace('</head>', () => `${route.html_head}</head>`) : route.html_head + out;
  if (route.html_body) out = /<body[^>]*>/.test(out) ? out.replace(/<body[^>]*>/, (m) => `${m}${route.html_body}`) : out + route.html_body;
  return out;
}

/** 広告挿入タグが返すスクリプト。広告のリンク先ページのURLにあるパラメータを、この流入経路へのリンクに引き継ぐ */
export function adInsertScript(route: Pick<EntryRoute, 'ref_code' | 'ad_param_map'>): string {
  const keys = Array.from(new Set([...STANDARD_QUERY_KEYS, ...adParamMapOf(route).map((m) => m.param)]));
  return `(function(){var ref=${JSON.stringify(route.ref_code)};var keys=${JSON.stringify(keys)};var q=new URLSearchParams(location.search);var add=[];keys.forEach(function(k){if(q.has(k))add.push([k,q.get(k)])});if(!add.length)return;function patch(){var as=document.querySelectorAll('a[href*="/r/'+ref+'"]');for(var i=0;i<as.length;i++){try{var u=new URL(as[i].href);var ch=false;add.forEach(function(p){if(!u.searchParams.has(p[0])){u.searchParams.set(p[0],p[1]);ch=true}});if(ch)as[i].href=u.toString()}catch(e){}}}patch();try{new MutationObserver(patch).observe(document.documentElement,{childList:true,subtree:true})}catch(e){}})();`;
}
