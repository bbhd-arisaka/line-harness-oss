import { describe, expect, it } from 'vitest';
import {
  adInsertScript,
  collectInflowQuery,
  encodeInflowQuery,
  geoRequestPage,
  injectHtml,
  outOfAreaPage,
  outOfPeriodPage,
  parseInflowQuery,
} from './inflow-route-landing.js';

const route = { ref_code: 'AbC234', ad_param_map: JSON.stringify([{ param: 'campaign_id', fieldKey: 'cid' }]) };

describe('流入経路の着地ページの部品', () => {
  it('有効期間外のページ: 設定したメッセージ、なければ既定。HTMLは無効化する', () => {
    expect(outOfPeriodPage({ out_of_period_message: null })).toContain('現在ご利用いただけません');
    expect(outOfPeriodPage({ out_of_period_message: '受付は終了しました' })).toContain('受付は終了しました');
    expect(outOfPeriodPage({ out_of_period_message: '<script>alert(1)</script>' })).not.toContain('<script>alert');
  });
  it('位置情報: 現在地をたずねるページと、範囲外のページ', () => {
    expect(geoRequestPage()).toContain('navigator.geolocation');
    expect(geoRequestPage()).toContain('_lat');
    expect(outOfAreaPage()).toContain('この場所からはご利用いただけません');
  });
  it('HTMLタグ: head の終わりの前と、body の始まりの後ろに入る', () => {
    const html = '<html><head><title>x</title></head><body class="a"><p>本文</p></body></html>';
    const out = injectHtml(html, { html_head: '<meta name="x">', html_body: '<noscript>n</noscript>' });
    expect(out).toContain('<title>x</title><meta name="x"></head>');
    expect(out).toContain('<body class="a"><noscript>n</noscript><p>本文</p>');
    expect(injectHtml(html, { html_head: null, html_body: null })).toBe(html);
    // `$&` などの置換記号が、そのまま入る
    expect(injectHtml(html, { html_head: "<script>var a='$&';</script>", html_body: null })).toContain("var a='$&';");
  });
  it('クエリ: 広告連携で設定したものと、広告の標準のものだけを集計に残す', () => {
    const q = collectInflowQuery({ campaign_id: 'c1', utm_source: 'hpb', gclid: 'g', secret: 'x', account: '123' }, route);
    expect(q).toEqual({ campaign_id: 'c1', utm_source: 'hpb', gclid: 'g' });
    expect(encodeInflowQuery({})).toBeNull();
    expect(parseInflowQuery(encodeInflowQuery(q))).toEqual(q);
  });
  it('LIFF から届いたクエリの検査: 壊れていたり、文字でないものは捨てる', () => {
    expect(parseInflowQuery('not json')).toBeNull();
    expect(parseInflowQuery('[1,2]')).toBeNull();
    expect(parseInflowQuery(undefined)).toBeNull();
    expect(parseInflowQuery(JSON.stringify({ ok: 'v', n: 1, 'bad key': 'x' }))).toEqual({ ok: 'v' });
    expect(parseInflowQuery('x'.repeat(9000))).toBeNull();
  });
  it('広告挿入タグのスクリプト: この流入経路へのリンクにだけ、パラメータを引き継ぐ', () => {
    const js = adInsertScript(route);
    expect(js).toContain('"AbC234"');
    expect(js).toContain('"campaign_id"');
    expect(js).toContain('utm_source');
    expect(() => new Function(js)).not.toThrow();
  });
});
