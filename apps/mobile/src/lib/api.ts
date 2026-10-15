import type {
  ApiEnvelope,
  BroadcastItem,
  BroadcastProgress,
  ChatDetail,
  ChatStatus,
  ChatSummary,
  FormAnswerDetail,
  FriendAddInfo,
  FriendDetail,
  FriendFieldDefinition,
  FriendPage,
  FriendProfileInput,
  FriendRichMenu,
  LineAccount,
  LoginResult,
  PushSettings,
  TagItem,
  UpdatedChat,
  FormOption,
} from './types';
import type { ApiMessage, SegmentCondition } from './broadcast';
import { NETWORK_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE, toJapaneseError, UNAUTHORIZED_MESSAGE } from './errors';

/** 本番 API。EXPO_PUBLIC_API_URL で上書きできる。 */
export const DEFAULT_API_URL = 'https://beyond-line.cms-manager.jp';

/** API がエラーを返した(または通信できなかった)ときの例外。status=0 は通信失敗。 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  /** 保存済みのトークン(無ければ null) */
  getToken: () => string | null;
  /** 認証済みの呼び出しが 401 になったとき(ログイン画面へ戻す) */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
  /** 通信のタイムアウト(ミリ秒)。既定 20 秒 */
  timeoutMs?: number;
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** false のとき Authorization を付けず、401 でも onUnauthorized を呼ばない(ログイン用) */
  auth?: boolean;
  /** 追加のヘッダー(Idempotency-Key など) */
  headers?: Record<string, string>;
}

export function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 20000;

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth !== false;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.headers) Object.assign(headers, opts.headers);
    if (auth) {
      const token = options.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}${buildQuery(opts.query)}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller?.signal,
      });
    } catch (e) {
      // タイムアウト(AbortController による中断)と、それ以外の通信失敗を分ける
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new ApiError(aborted ? TIMEOUT_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE, 0);
    } finally {
      if (timer) clearTimeout(timer);
    }

    let json: ApiEnvelope<T> | null = null;
    try {
      json = (await res.json()) as ApiEnvelope<T>;
    } catch {
      json = null;
    }

    if (res.status === 401 && auth) {
      options.onUnauthorized?.();
      throw new ApiError(json?.error ? toJapaneseError(json.error, 401) : UNAUTHORIZED_MESSAGE, 401);
    }
    if (!res.ok || !json || json.success === false) {
      // API の error は英語のことがあるので日本語にする(日本語ならそのまま)
      throw new ApiError(toJapaneseError(json?.error, res.status), res.status);
    }
    return json.data as T;
  }

  return {
    baseUrl,

    // ── 認証 ──
    login: (email: string, password: string, deviceName: string) =>
      request<LoginResult>('POST', '/api/app/login', { body: { email, password, deviceName }, auth: false }),
    logout: () => request<null>('POST', '/api/app/logout'),
    /** アカウント削除の申請(App Store の要件)。申請するとサーバー側で全端末のログインが取り消される */
    requestAccountDeletion: () => request<null>('POST', '/api/app/account-deletion'),
    /** プッシュ通知の送り先(APNs デバイストークン)を登録。null で解除。 */
    setApnsToken: (apnsToken: string | null) => request<null>('PUT', '/api/app/device', { body: { apnsToken } }),
    /** この端末の通知設定: 止めている公式アカウント・止めている通知の種類(設定はアプリの中だけで完結する) */
    getPushSettings: (accountId?: string) => request<PushSettings>('GET', `/api/app/push-settings${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`),
    /** 送った項目だけを更新する。accountId を付けると、その公式アカウントだけの設定(accountMuted・mutedKinds)を更新する */
    setPushSettings: (change: { mutedAccountIds?: string[]; mutedKinds?: string[]; accountId?: string; accountMuted?: boolean }) => request<PushSettings>('PUT', '/api/app/push-settings', { body: change }),

    /**
     * 新着の有無だけの軽い確認(最新のメッセージの時刻を返す。1行しか読まない)。トーク・一覧の定期確認に使う。
     * unread を付けると、その公式アカウントの「未対応」のトーク数(unreadCount)も返す(下バーの数字用。少し重いので、必要なときだけ)。
     */
    getChatPulse: (opts?: { lineAccountId?: string; unread?: boolean }) =>
      request<{ latest: string | null; unreadCount?: number }>('GET', '/api/chats/pulse', {
        query: { lineAccountId: opts?.lineAccountId, unread: opts?.unread ? 1 : undefined },
      }),

    // ── 公式アカウント ──
    listLineAccounts: () => request<LineAccount[]>('GET', '/api/line-accounts'),
    /** 友だち追加用の URL と QR コード(画像で保存・URL のコピー用) */
    getFriendAdd: (accountId: string) => request<FriendAddInfo>('GET', `/api/line-accounts/${accountId}/friend-add`),

    // ── トーク ──
    listChats: (params: {
      lineAccountId: string;
      status?: ChatStatus;
      limit?: number;
      /** 続きの取得: 最後の行の lastMessageAt と id(friendId) */
      before?: { at: string; id: string };
    }) =>
      request<ChatSummary[]>('GET', '/api/chats', {
        query: {
          lineAccountId: params.lineAccountId,
          status: params.status,
          limit: params.limit,
          beforeAt: params.before?.at,
          beforeId: params.before?.id,
        },
      }),
    getChat: (id: string) => request<ChatDetail>('GET', `/api/chats/${encodeURIComponent(id)}`),
    /** トークの「回答結果を見る」カードから開く、フォームの回答結果 */
    getFormAnswer: (chatId: string, submissionId: string) =>
      request<FormAnswerDetail>('GET', `/api/chats/${encodeURIComponent(chatId)}/form-answers/${encodeURIComponent(submissionId)}`),
    sendChatText: (id: string, content: string) =>
      request<{ sent: boolean; messageId: string }>('POST', `/api/chats/${encodeURIComponent(id)}/send`, {
        body: { messageType: 'text', content },
      }),

    /** 対応状態の変更(未対応/対応中/対応済み)。id は friendId(chats.id でも可) */
    updateChatStatus: (id: string, status: ChatStatus) =>
      request<UpdatedChat>('PUT', `/api/chats/${encodeURIComponent(id)}`, { body: { status } }),

    // ── 一斉配信(オーナー・管理者だけ。サーバーが確認する) ──
    listBroadcasts: (lineAccountId: string) => request<BroadcastItem[]>('GET', '/api/broadcasts', { query: { lineAccountId } }),
    getBroadcast: (id: string) => request<BroadcastItem>('GET', `/api/broadcasts/${encodeURIComponent(id)}`),
    getBroadcastProgress: (id: string) => request<BroadcastProgress>('GET', `/api/broadcasts/${encodeURIComponent(id)}/progress`),
    /** 下書きを作る(送らない)。messages は1〜5通(順番がそのまま配信順)。key は UUID: 同じキーで同じ内容なら、二重に作られない */
    createBroadcastDraft: (body: { title: string; messages: ApiMessage[]; lineAccountId: string }, key: string) =>
      request<BroadcastItem>('POST', '/api/broadcasts', {
        body: { title: body.title, messages: body.messages, targetType: 'all', lineAccountId: body.lineAccountId },
        headers: { 'Idempotency-Key': key },
      }),
    /** 配信に入れられるフォームの一覧(回答フォームのリンクを本文に入れるため)。id=タグコードに使う・name=表示名 */
    listForms: () => request<FormOption[]>('GET', '/api/forms'),
    /** 画像をアップロードして、配信に使えるURLを得る(JPEG/PNG・base64) */
    uploadImage: (base64: string, mimeType: string, filename?: string) =>
      request<{ url: string; key: string }>('POST', '/api/images', { body: { data: base64, mimeType, filename } }),
    /** 下書きを、いますぐ友だち全員に送る */
    sendBroadcastToAll: (id: string) => request<BroadcastItem>('POST', `/api/broadcasts/${encodeURIComponent(id)}/send`),
    /** 下書きを、条件で絞り込んだ友だちに送る(順番に配信される) */
    sendBroadcastToSegment: (id: string, conditions: SegmentCondition) =>
      request<BroadcastItem>('POST', `/api/broadcasts/${encodeURIComponent(id)}/send-segment`, { body: { conditions } }),
    /** 選んだ友だちにテスト送信する(下書きだけ。最大10人) */
    testSendBroadcast: (id: string, friendIds: string[]) =>
      request<{ sent: number; failed: number }>('POST', `/api/broadcasts/${encodeURIComponent(id)}/test-send`, { body: { friendIds } }),
    /** テスト送信の候補: 前回のテスト送信で使った友だち(新しい順)→登録済みのテスト送信先 */
    listTestSendHistory: (accountId: string) =>
      request<Array<{ id: string; displayName: string; pictureUrl: string | null; recent: boolean }>>('GET', '/api/account-settings/test-recipients', {
        query: { accountId, history: 1 },
      }),
    deleteBroadcast: (id: string) => request<null>('DELETE', `/api/broadcasts/${encodeURIComponent(id)}`),
    /** 条件に合う、友だち中の人数(accountId は必須) */
    countSegment: (accountId: string, conditions: SegmentCondition) =>
      request<{ count: number }>('POST', '/api/segments/count', { body: { conditions, accountId, followingOnly: true } }),
    listTags: () => request<TagItem[]>('GET', '/api/tags'),

    // ── 友だち ──
    listFriends: (params: { lineAccountId: string; search?: string; limit?: number; offset?: number }) =>
      request<FriendPage>('GET', '/api/friends', {
        query: {
          lineAccountId: params.lineAccountId,
          search: params.search?.trim() || undefined,
          limit: params.limit ?? 30,
          offset: params.offset ?? 0,
        },
      }),
    getFriend: (id: string) => request<FriendDetail>('GET', `/api/friends/${encodeURIComponent(id)}`),
    /** 本名・システム表示名・個別メモの更新(空にするときは null)。更新後の友だちが返る */
    updateFriendProfile: (id: string, profile: FriendProfileInput) =>
      request<FriendDetail>('PUT', `/api/friends/${encodeURIComponent(id)}/profile`, { body: profile }),
    getFriendRichMenu: (id: string) =>
      request<FriendRichMenu>('GET', `/api/friends/${encodeURIComponent(id)}/rich-menu`),
    listFriendFieldDefinitions: () =>
      request<FriendFieldDefinition[]>('GET', '/api/friend-fields/definitions'),

    /** リッチメニュー画像(認証なしで取得できる proxy)。<Image source={{uri}}> で使う */
    richMenuImageUrl: (richMenuId: string, accountId: string) =>
      `${baseUrl}/api/rich-menu-groups/external/${richMenuId}/image?accountId=${encodeURIComponent(accountId)}`,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
