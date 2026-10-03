// エラー文言の日本語化。React Native に依存しない純粋な関数。
// API の error は英語(例: "Internal server error")のことがあるので、利用者に分かる日本語にする。
// 日本語の error(ログイン・アカウント権限など、API が日本語で返すもの)はそのまま出す。

export const NETWORK_ERROR_MESSAGE = '通信できませんでした。電波の良い場所でもう一度お試しください';
export const TIMEOUT_ERROR_MESSAGE = '通信に時間がかかりすぎました。電波の良い場所でもう一度お試しください';
export const SERVER_ERROR_MESSAGE = 'サーバーでエラーが発生しました。しばらくしてからもう一度お試しください';
export const UNAUTHORIZED_MESSAGE = 'ログインの有効期限が切れました。もう一度ログインしてください';
export const FORBIDDEN_MESSAGE = 'この操作をする権限がありません。管理者に確認してください';
export const NOT_FOUND_MESSAGE = '対象が見つかりませんでした。削除されたか、見られない可能性があります';
export const TOO_MANY_REQUESTS_MESSAGE = '操作が多すぎます。しばらく待ってからもう一度お試しください';
export const BAD_REQUEST_MESSAGE = '入力内容が正しくありません。確認してもう一度お試しください';
export const UNKNOWN_ERROR_MESSAGE = '予期しないエラーが発生しました。もう一度お試しください';

const JAPANESE = /[぀-ヿ㐀-鿿]/;

/** 通信失敗を表す英語のメッセージ(fetch の実装ごとに文言が違う) */
const NETWORK_PATTERNS =
  /network request failed|failed to fetch|load failed|network connection was lost|networkerror|internet connection appears to be offline|not connected to the internet/i;
/** タイムアウト(AbortController による中断を含む) */
const TIMEOUT_PATTERNS = /timeout|timed out|aborted|aborterror/i;

const NO_ACCOUNT = '公式アカウントが選ばれていません。アカウントを選び直してください';

/** 完全一致(小文字化・前後の空白除去後)で変換するもの */
const EXACT: Record<string, string> = {
  'line account credentials are unavailable': 'この公式アカウントは LINE と接続できないため送信できません。管理者に連絡してください',
  'internal server error': SERVER_ERROR_MESSAGE,
  internal_error: SERVER_ERROR_MESSAGE,
  update_failed: SERVER_ERROR_MESSAGE,
  unauthorized: UNAUTHORIZED_MESSAGE,
  forbidden: FORBIDDEN_MESSAGE,
  'csrf token mismatch': FORBIDDEN_MESSAGE,
  'not found': NOT_FOUND_MESSAGE,
  not_found: NOT_FOUND_MESSAGE,
  'chat not found': 'トークが見つかりませんでした',
  'friend not found': '友だちが見つかりませんでした',
  friend_not_found: '友だちが見つかりませんでした',
  'line account not found': '公式アカウントが見つかりませんでした',
  'user not found': 'ユーザーが見つかりませんでした',
  'staff member not found': 'スタッフが見つかりませんでした',
  staff_not_found_in_account: 'このアカウントでは操作できません。管理者に確認してください',
  'content is required': 'メッセージを入力してください',
  'unsupported message type': 'この種類のメッセージは送信できません',
  'too many requests. please try again later.': TOO_MANY_REQUESTS_MESSAGE,
  'invalid json body': BAD_REQUEST_MESSAGE,
  invalid_body: BAD_REQUEST_MESSAGE,
  missing_params: BAD_REQUEST_MESSAGE,
  missing_account_id: NO_ACCOUNT,
  'accountid required': NO_ACCOUNT,
  'accountid query param required': NO_ACCOUNT,
  'file too large': 'ファイルが大きすぎます',
};

/**
 * API の error(や通信エラーの文言)を、利用者向けの日本語にする。
 * @param message API の error、または例外の message
 * @param status HTTP ステータス(通信失敗は 0、不明なら省略)。英語で意味が分からないときの目安に使う
 */
export function toJapaneseError(message: string | null | undefined, status?: number): string {
  const raw = (message ?? '').trim();
  if (raw && JAPANESE.test(raw)) return raw;

  if (raw) {
    if (NETWORK_PATTERNS.test(raw)) return NETWORK_ERROR_MESSAGE;
    if (TIMEOUT_PATTERNS.test(raw)) return TIMEOUT_ERROR_MESSAGE;
    const exact = EXACT[raw.toLowerCase()];
    if (exact) return exact;
    // LINE への送信失敗("LINE API error: 429 - {...}" など)。詳細は英語・JSON なので出さない
    if (/^line api error/i.test(raw)) return 'LINE への送信に失敗しました。しばらくしてからもう一度お試しください';
    // "Failed to ..." などの内部エラー
    if (/^failed to /i.test(raw)) return SERVER_ERROR_MESSAGE;
    if (/not found$/i.test(raw)) return NOT_FOUND_MESSAGE;
  }

  switch (status) {
    case 0:
      return NETWORK_ERROR_MESSAGE;
    case 400:
    case 422:
      return BAD_REQUEST_MESSAGE;
    case 401:
      return UNAUTHORIZED_MESSAGE;
    case 403:
      return FORBIDDEN_MESSAGE;
    case 404:
      return NOT_FOUND_MESSAGE;
    case 429:
      return TOO_MANY_REQUESTS_MESSAGE;
    default:
      break;
  }
  if (typeof status === 'number' && status >= 500) return SERVER_ERROR_MESSAGE;
  return UNKNOWN_ERROR_MESSAGE;
}

/** catch した例外を、画面に出す日本語にする。ApiError は status も見る。分からないときは fallback */
export function describeError(e: unknown, fallback = UNKNOWN_ERROR_MESSAGE): string {
  if (e instanceof Error) {
    const status = (e as { status?: unknown }).status;
    const message = toJapaneseError(e.message, typeof status === 'number' ? status : undefined);
    return message === UNKNOWN_ERROR_MESSAGE ? fallback : message;
  }
  if (typeof e === 'string') {
    const message = toJapaneseError(e);
    return message === UNKNOWN_ERROR_MESSAGE ? fallback : message;
  }
  return fallback;
}
