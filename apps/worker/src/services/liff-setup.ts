// LIFF アプリの自動作成(LINE の LIFF Server API)。
//
// 背景: フォーム・予約などの公開ページは、LINE の「LIFF アプリ」として開く必要がある。
// これまでは LINE Developers コンソールで LIFF を手作りして ID を貼り付けていたが、
// LINE ログインチャネルの ID とシークレットさえあれば、LIFF の作成〜エンドポイントURLの設定〜ID の取得は
// API で全部できるので、ここで自動化する。
//
// ※ LINE ログインチャネル自体の作成だけは、LINE 側に API が無いため自動化できない。

const LINE_TOKEN_URL = 'https://api.line.me/v2/oauth/accessToken';
const LIFF_APPS_URL = 'https://api.line.me/liff/v1/apps';

export interface LiffSetupInput {
  loginChannelId: string;
  loginChannelSecret: string;
  /** 公開ページの土台になる Worker のURL(例: https://beyond-line.cms-manager.jp) */
  workerUrl: string;
  /** すでにこのアカウントに割り当て済みの LIFF ID(あれば、それを優先して整える) */
  existingLiffId?: string | null;
  /** 他のアカウントが使っている LIFF ID(横取りしないため) */
  takenLiffIds?: string[];
}

export interface LiffSetupResult {
  liffId: string;
  /** 新しく作ったら true、既存を再利用したら false */
  created: boolean;
}

/** 画面にそのまま出せる、分かりやすい失敗理由。 */
export class LiffSetupError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
    this.name = 'LiffSetupError';
  }
}

interface LiffApp {
  liffId: string;
  view?: { type?: string; url?: string };
  description?: string;
}

type FetchLike = typeof fetch;

function endpointFor(workerUrl: string, liffId?: string): string {
  const base = workerUrl.replace(/\/+$/, '');
  // クライアントは ?liffId= を見て、どのアカウントのLIFFかを判別する(複数アカウント対応)
  return liffId ? `${base}/?liffId=${liffId}` : `${base}/`;
}

async function issueToken(input: LiffSetupInput, f: FetchLike): Promise<string> {
  const res = await f(LINE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: input.loginChannelId,
      client_secret: input.loginChannelSecret,
    }),
  });
  if (!res.ok) {
    throw new LiffSetupError(
      'LINEログインチャネルのIDまたはシークレットが正しくありません。LINE Developersの「チャネル基本設定」で、チャネルIDとチャネルシークレットをもう一度確認してください。',
      400,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new LiffSetupError('LINEからアクセストークンを取得できませんでした。', 502);
  return json.access_token;
}

async function listApps(token: string, f: FetchLike): Promise<LiffApp[]> {
  const res = await f(LIFF_APPS_URL, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new LiffSetupError(
      'LIFFの一覧をLINEから取得できませんでした。このチャネルが「LINEログイン」チャネルか確認してください(Messaging APIチャネルでは作れません)。',
      res.status === 403 || res.status === 401 ? 400 : 502,
    );
  }
  const json = (await res.json()) as { apps?: LiffApp[] };
  return json.apps ?? [];
}

async function setEndpoint(token: string, liffId: string, url: string, f: FetchLike): Promise<void> {
  const res = await f(`${LIFF_APPS_URL}/${liffId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ view: { type: 'full', url } }),
  });
  if (!res.ok) throw new LiffSetupError('LIFFのエンドポイントURLをLINEに設定できませんでした。', 502);
}

/**
 * このLINEログインチャネルに、beyond line 用の LIFF を用意して ID を返す(何度呼んでも安全)。
 * 1. すでに割り当て済みの LIFF があれば、それを使う
 * 2. エンドポイントが自分のURLの LIFF が既にあれば、それを使う
 * 3. 無ければ新しく作る
 * どのケースでも、エンドポイントURLは `?liffId=` 付きに整える。
 */
export async function ensureLiffApp(input: LiffSetupInput, f: FetchLike = fetch): Promise<LiffSetupResult> {
  const token = await issueToken(input, f);
  const apps = await listApps(token, f);
  const base = input.workerUrl.replace(/\/+$/, '');
  const taken = new Set(input.takenLiffIds ?? []);

  const mine =
    (input.existingLiffId ? apps.find((a) => a.liffId === input.existingLiffId) : undefined) ??
    apps.find((a) => !taken.has(a.liffId) && (a.view?.url ?? '').replace(/\/+$/, '').split('?')[0] === base);

  if (mine) {
    const want = endpointFor(input.workerUrl, mine.liffId);
    if ((mine.view?.url ?? '') !== want) await setEndpoint(token, mine.liffId, want, f);
    return { liffId: mine.liffId, created: false };
  }

  const res = await f(LIFF_APPS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      view: { type: 'full', url: endpointFor(input.workerUrl) },
      description: 'beyond line(フォーム・予約など)',
      features: { qrCode: false },
      permanentLinkPattern: 'concat',
      scope: ['profile', 'openid'],
    }),
  });
  if (!res.ok) throw new LiffSetupError('LIFFの作成にLINE側で失敗しました。しばらくしてからもう一度お試しください。', 502);
  const json = (await res.json()) as { liffId?: string };
  if (!json.liffId) throw new LiffSetupError('LIFFは作成されましたが、IDを受け取れませんでした。', 502);

  // 作成直後に、自分のIDを含むエンドポイントURLへ更新する(IDは作ってからでないと分からないため)
  await setEndpoint(token, json.liffId, endpointFor(input.workerUrl, json.liffId), f);
  return { liffId: json.liffId, created: true };
}
