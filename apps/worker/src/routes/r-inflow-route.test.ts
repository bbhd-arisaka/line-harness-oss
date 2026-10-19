import { describe, it, expect, vi, beforeEach } from 'vitest';

// 流入経路分析で作った流入経路(actions が文字列)の、/r/:ref の動き:
// 有効期間外のページ・位置情報の確認・HTMLタグの差し込み・広告パラメータの引き継ぎ・広告挿入タグ。
// アクションが NULL の旧来の流入経路は、これまでどおり(別のテストで確認している)。

const dbMocks = {
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  getEntryRouteByRefCode: vi.fn().mockResolvedValue(null),
  getTrafficPoolBySlug: vi.fn().mockResolvedValue(null),
  getTrafficPoolById: vi.fn().mockResolvedValue(null),
  getRandomPoolAccount: vi.fn().mockResolvedValue(null),
  getPoolAccounts: vi.fn().mockResolvedValue([]),
  getLineAccountById: vi.fn().mockResolvedValue(null),
  getLineAccountByChannelId: vi.fn().mockResolvedValue(null),
  getAffiliateLinkByRefCode: vi.fn().mockResolvedValue(null),
  incrementAffiliateLinkClick: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@line-crm/db', () => dbMocks);

const worker = (await import('../index.js')).default;

const env = {
  DB: {} as D1Database,
  WORKER_URL: 'https://worker.example.com',
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
} as unknown as import('../index.js').Env['Bindings'];

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const ACCOUNT = { id: 'a1', channel_id: '2008163446', liff_id: '2008163446-AAAAAAAA' };

function get(path: string) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, { headers: { 'user-agent': MOBILE_UA }, redirect: 'manual' }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const route = (extra: Record<string, unknown> = {}) => ({
  id: 'r1',
  ref_code: 'AbC234',
  pool_id: null,
  actions: '[]',
  valid_from: null,
  valid_to: null,
  out_of_period_message: null,
  html_head: null,
  html_body: null,
  geo_lat: null,
  geo_lng: null,
  geo_radius: null,
  ad_param_map: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
  dbMocks.getAffiliateLinkByRefCode.mockResolvedValue(null);
  dbMocks.getTrafficPoolBySlug.mockResolvedValue(null);
  dbMocks.getLineAccountByChannelId.mockResolvedValue(ACCOUNT);
});

const url = '/r/AbC234?account=2008163446';

describe('/r/:ref — 流入経路分析の流入経路', () => {
  it('設定がなければ、そのままLINEを開くページ(アカウントを固定)', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route());
    const res = await get(url);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('liff.line.me/2008163446-AAAAAAAA');
    expect(html).toContain('ref=AbC234');
  });
  it('有効期間の前・後は、LINEへ進まず、メッセージを出す(設定がなければ既定)', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ valid_to: '2020-01-01T00:00' }));
    const html = await (await get(url)).text();
    expect(html).toContain('現在ご利用いただけません');
    expect(html).not.toContain('liff.line.me');

    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ valid_from: '2999-01-01T00:00', out_of_period_message: 'まだ始まっていません' }));
    const html2 = await (await get(url)).text();
    expect(html2).toContain('まだ始まっていません');
    expect(html2).not.toContain('liff.line.me');

    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ valid_from: '2020-01-01T00:00', valid_to: '2999-01-01T00:00' }));
    expect(await (await get(url)).text()).toContain('liff.line.me/2008163446-AAAAAAAA');
  });
  it('位置情報: 現在地がなければたずねるページ。範囲内なら進み、範囲外なら止める', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ geo_lat: 35.6812, geo_lng: 139.7671, geo_radius: 200 }));
    const ask = await (await get(url)).text();
    expect(ask).toContain('navigator.geolocation');
    expect(ask).not.toContain('liff.line.me');

    const inside = await (await get(`${url}&_lat=35.6813&_lng=139.7672`)).text();
    expect(inside).toContain('liff.line.me/2008163446-AAAAAAAA');
    expect(inside).not.toContain('_lat'); // 現在地はLINEへ引き継がない

    const outside = await (await get(`${url}&_lat=35.7000&_lng=139.8000`)).text();
    expect(outside).toContain('この場所からはご利用いただけません');
    expect(outside).not.toContain('liff.line.me');
  });
  it('HTMLタグが、着地ページの head / body に入る', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ html_head: '<meta name="pixel" content="1">', html_body: '<noscript>px</noscript>' }));
    const html = await (await get(url)).text();
    expect(html).toContain('<meta name="pixel" content="1"></head>');
    expect(html).toMatch(/<body[^>]*><noscript>px<\/noscript>/);
  });
  it('広告パラメータは、LIFF へ iqp として引き継ぐ(設定していないパラメータは引き継がない)', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ ad_param_map: JSON.stringify([{ param: 'campaign_id', fieldKey: 'cid' }]) }));
    const html = await (await get(`${url}&campaign_id=C-1&utm_source=hpb&other=zzz`)).text();
    const m = html.match(/iqp=([^&"']+)/);
    expect(m).not.toBeNull();
    expect(JSON.parse(decodeURIComponent(m![1]))).toEqual({ utm_source: 'hpb', campaign_id: 'C-1' });
    expect(html).not.toContain('zzz');
  });
  it('文言・配色: 設定した見出し・ボタン・色が出る。注意書き・「こちら」は消せる。既定のままなら、これまでの見た目', async () => {
    const style = JSON.stringify({ title: 'ご予約は友だち追加から', buttonText: 'LINEを開く', colors: { button: '#ff6600', pageBg: '#101010' }, showHelp: false, hintText: '開かないときは長押し' });
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ landing_style: style }));
    const html = await (await get(url)).text();
    expect(html).toContain('ご予約は友だち追加から');
    expect(html).toContain('LINEを開く');
    expect(html).toContain('background:#ff6600');
    expect(html).toContain('background:#101010');
    expect(html).toContain('開かないときは長押し');
    expect(html).not.toContain('うまく開けない方は');
    expect(html).not.toContain('友達追加して始める');
    // 文字は、HTMLとして解釈されない
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ landing_style: JSON.stringify({ title: '<b>x</b>' }) }));
    expect(await (await get(url)).text()).toContain('&lt;b&gt;x&lt;/b&gt;');
    // 既定
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route());
    const d = await (await get(url)).text();
    expect(d).toContain('友達追加して始める');
    expect(d).toContain('background:#06c755');
    expect(d).toContain('うまく開けない方は');
  });
  it('プレビュー(?preview=1): 有効期間・位置情報の確認をとばして見た目を見せる。ボタンの先に ref を付けない(押しても記録されない)', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ valid_to: '2020-01-01T00:00', geo_lat: 35, geo_lng: 139, geo_radius: 100 }));
    const html = await (await get(`${url}&preview=1`)).text();
    expect(html).toContain('liff.line.me/2008163446-AAAAAAAA');
    expect(html).not.toContain('ref=AbC234');
    // ふつうに開いたときは、止まる
    expect(await (await get(url)).text()).not.toContain('liff.line.me');
  });
  it('背景画像・透過の設定が、ページに出る', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ landing_style: JSON.stringify({ bgImageUrl: 'https://example.com/bg.jpg', cardOpacity: 60 }) }));
    const html = await (await get(url)).text();
    expect(html).toContain('url("https://example.com/bg.jpg")');
    expect(html).toContain('rgba(255,255,255,0.6)');
  });
  it('旧来の流入経路(アクションが無い)は、有効期間などの新しい判定をしない', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ actions: null, valid_to: '2020-01-01T00:00' }));
    expect(await (await get(url)).text()).toContain('liff.line.me/2008163446-AAAAAAAA');
  });
  it('広告挿入タグ: スクリプトを返す。旧来の流入経路・存在しないものは空', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(route({ ad_param_map: JSON.stringify([{ param: 'campaign_id', fieldKey: 'cid' }]) }));
    const res = await get('/r/AbC234/ad.js');
    expect(res.headers.get('Content-Type')).toContain('javascript');
    expect(await res.text()).toContain('campaign_id');
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    expect(await (await get('/r/none/ad.js')).text()).toBe('');
  });
});
