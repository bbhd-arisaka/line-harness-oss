/**
 * 【アプリの強制アップデート】
 * 古いアプリを使えなくして、App Store の最新版への更新だけを案内する。
 *
 * 見分け方(新しい順に確かめる):
 *   1. アプリが付ける `X-App-Version`(例 1.1.2)。新しいアプリ(1.1.2 以降のJS)だけが付ける。
 *   2. 付いていなければ、iOS が自動で付ける User-Agent の中のビルド番号(例 `beyondline/13 CFNetwork/…`)。
 *      ビルド番号は、ビルドのたびに増える(EASの自動採番)ので、古いアプリ(1.0・1.1.0・1.1.1)は小さい番号になる。
 *   3. どちらも分からないとき(Expo Go・ブラウザなど)は、止めない。
 *
 * 【安全装置】App Store に、必要な版がまだ並んでいないときは止めない
 * (更新先が無いのに止めると、誰も使えなくなる)。App Store の最新版は、Apple の公開API(iTunes Lookup)で確かめる。
 * 確かめられないとき(通信失敗)も、止めない。
 */

export const APP_STORE_ID = '6820799381';
export const APP_STORE_URL = `https://apps.apple.com/jp/app/beyond-line/id${APP_STORE_ID}`;

/**
 * いま、これより古いアプリは使えなくする(App Store にこの版以上が並んでいるときだけ有効)。
 * 次に強制するときは、ここを新しい版・ビルド番号に書き換えて push する。
 *  - 1.1.2 の最初のビルドは 13(それ以前の 1〜12 は 1.0 / 1.1.0 / 1.1.1)
 */
export const APP_FORCE_UPDATE_RULE = { minVersion: '1.1.2', minBuild: 13 };

export const UPDATE_REQUIRED_MESSAGE = 'アプリが古くなりました。App Storeで「beyond line」を最新版に更新してください。';

/** "1.2.10" → [1,2,10]。読めなければ null */
export function parseVersion(v: string | null | undefined): number[] | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** a が b より古ければ負、同じなら 0、新しければ正。どちらかが読めなければ null */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export interface ClientInfo {
  version: string | null;
  build: number | null;
}

/** リクエストのヘッダーから、アプリの版とビルド番号を読む */
export function readClientInfo(headers: { get(name: string): string | null }): ClientInfo {
  const version = headers.get('x-app-version')?.trim() || null;
  let build: number | null = null;
  const h = headers.get('x-app-build')?.trim();
  if (h && /^\d{1,6}$/.test(h)) build = Number(h);
  if (build === null) {
    // 例: "beyondline/13 CFNetwork/1494.0.7 Darwin/23.4.0"
    const m = (headers.get('user-agent') ?? '').match(/\/(\d{1,6})\s+CFNetwork\//);
    if (m) build = Number(m[1]);
  }
  return { version: parseVersion(version) ? version : null, build };
}

/** 古いか。true=古い / false=足りている / null=分からない */
export function isBehind(info: ClientInfo, rule = APP_FORCE_UPDATE_RULE): boolean | null {
  if (info.version) {
    const c = compareVersions(info.version, rule.minVersion);
    if (c !== null) return c < 0;
  }
  if (info.build !== null) return info.build < rule.minBuild;
  return null;
}

// App Store に並んでいる最新の版。毎回 Apple に聞かないよう、少しの間(成功30分・失敗5分)覚えておく
let storeCache: { at: number; version: string | null } | null = null;
const STORE_TTL_OK_MS = 30 * 60_000;
const STORE_TTL_FAIL_MS = 5 * 60_000;

export function resetStoreVersionCache(): void {
  storeCache = null;
}

export async function getStoreVersion(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<string | null> {
  if (storeCache && now - storeCache.at < (storeCache.version ? STORE_TTL_OK_MS : STORE_TTL_FAIL_MS)) return storeCache.version;
  let version: string | null = null;
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 3000) : null;
    try {
      const res = await fetchImpl(`https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=jp`, { signal: ctrl?.signal });
      if (res.ok) {
        const json = (await res.json()) as { results?: Array<{ version?: string }> };
        const v = json.results?.[0]?.version;
        version = parseVersion(v) ? (v as string) : null;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    version = null;
  }
  storeCache = { at: now, version };
  return version;
}

export interface GateResult {
  /** このアプリは、更新しないと使えない */
  required: boolean;
  client: ClientInfo;
  /** App Store に並んでいる最新の版(分からなければ null) */
  storeVersion: string | null;
  minVersion: string;
}

/** このリクエストを出したアプリを、止めるか決める */
export async function evaluateUpdateGate(
  headers: { get(name: string): string | null },
  opts: { fetchImpl?: typeof fetch; rule?: typeof APP_FORCE_UPDATE_RULE } = {},
): Promise<GateResult> {
  const rule = opts.rule ?? APP_FORCE_UPDATE_RULE;
  const client = readClientInfo(headers);
  const behind = isBehind(client, rule);
  // 古くないとき・分からないときは、Apple に聞かない(無駄な通信を避ける)
  if (behind !== true) return { required: false, client, storeVersion: null, minVersion: rule.minVersion };
  const storeVersion = await getStoreVersion(opts.fetchImpl);
  const available = storeVersion !== null && (compareVersions(storeVersion, rule.minVersion) ?? -1) >= 0;
  return { required: available, client, storeVersion, minVersion: rule.minVersion };
}
