// プッシュ通知まわりの判断ロジック。React Native / expo-notifications に依存しない純粋な関数だけ。
// (実際の許可ダイアログ・トークン取得・画面遷移は src/state/push.tsx)

/** 「通知が必要な理由」の説明を出したかどうかの保存キー(初回のみ許可を求めるため) */
export const PUSH_EXPLAINED_KEY = 'beyondline.push.explained';

/** サーバー(PUT /api/app/device)が受け付ける形と同じ: 16進文字列 32〜200 文字 */
const APNS_TOKEN = /^[0-9a-fA-F]{32,200}$/;

/**
 * getDevicePushTokenAsync() の data を、APNs デバイストークン(16進文字列)にそろえる。
 * 文字列でない・形が違うときは null(Android の FCM トークンなど、登録してはいけないもの)。
 */
export function normalizeApnsToken(data: unknown): string | null {
  if (typeof data !== 'string') return null;
  const token = data.trim();
  return APNS_TOKEN.test(token) ? token : null;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export type PermissionPlan =
  /** すでに許可されている: そのままトークンを登録する */
  | 'register'
  /** まだ聞いていない: 理由を説明してから許可を求める */
  | 'explain'
  /** 何もしない(拒否済み、または説明を出し済みで許可されなかった) */
  | 'skip';

/** 通知の許可状態と「説明を出したか」から、次にやることを決める */
export function planPermission(input: { status: PermissionState; explained: boolean }): PermissionPlan {
  if (input.status === 'granted') return 'register';
  if (input.status === 'undetermined' && !input.explained) return 'explain';
  return 'skip';
}

/** 通知をタップしたときに開く先(通知のカスタムキー chatId / accountId) */
export interface NotificationTarget {
  chatId: string;
  /** 通知を送った公式アカウント。無ければ現在のアカウントのまま開く */
  accountId: string | null;
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * 通知の data(request.content.data)から開き先を取り出す。
 * トーク画面は友だちIDで開くので、サーバーが付ける friendId を優先する(chatId は、まだトークの行が無い友だちだと null になる)。
 * どちらも無ければ null(何もしない)。
 */
export function parseNotificationTarget(data: unknown): NotificationTarget | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const chatId = nonEmptyString(obj.friendId) ?? nonEmptyString(obj.chatId);
  if (!chatId) return null;
  return { chatId, accountId: nonEmptyString(obj.accountId) };
}

export type NavigationPlan =
  | { kind: 'open'; chatId: string; /** 切り替えが必要なときだけ、切り替え先のアカウント */ switchAccountId: string | null }
  /** 開けない(見られない公式アカウントの通知など) */
  | { kind: 'ignore'; reason: 'no-target' | 'account-not-allowed' };

/**
 * 開き先と、いまのアカウント・見られるアカウントの一覧から、遷移の計画を作る。
 * アカウントが違えば切り替えてから開く。見られないアカウントなら開かない(情報を見せない)。
 */
export function planNavigation(
  target: NotificationTarget | null,
  currentAccountId: string | null,
  allowedAccountIds: string[],
): NavigationPlan {
  if (!target) return { kind: 'ignore', reason: 'no-target' };
  if (target.accountId && target.accountId !== currentAccountId) {
    if (!allowedAccountIds.includes(target.accountId)) return { kind: 'ignore', reason: 'account-not-allowed' };
    return { kind: 'open', chatId: target.chatId, switchAccountId: target.accountId };
  }
  return { kind: 'open', chatId: target.chatId, switchAccountId: null };
}
