/**
 * アプリ(iPhone)からの一斉配信の安全装置。
 * 一斉配信は、お客様全員に一度に届き、取り消せない操作なので、アプリからは次を満たすときだけ許す。
 * - オーナー・管理者だけ(「スタッフ」の役割には許さない)
 * - 公式アカウントを指定している(未指定の配信は、アプリからは作れない)
 * - そのスタッフが見られる公式アカウントである
 * Web 版・API キーでの利用(従来どおり)には、この制限をかけない。
 */
export interface AppBroadcastCheck {
  /** アプリのトークンでの呼び出しか */
  viaApp: boolean;
  role: string | undefined;
  /** 見られる公式アカウント。null = 制限なし */
  allowedAccountIds: string[] | null | undefined;
  accountId: string | null | undefined;
}

export function appBroadcastDenied(c: AppBroadcastCheck): string | null {
  if (!c.viaApp) return null;
  if (c.role !== 'owner' && c.role !== 'admin') {
    return '一斉配信は、オーナーまたは管理者だけが使えます。';
  }
  if (!c.accountId) return '公式アカウントを指定してください。';
  if (c.allowedAccountIds && !c.allowedAccountIds.includes(c.accountId)) {
    return 'このアカウントを操作する権限がありません。';
  }
  return null;
}

/** Lステップと並行運用中の公式アカウントからは、一斉配信しない(二重配信を防ぐ) */
export const PARALLEL_BROADCAST_BLOCKED_MESSAGE =
  'このアカウントは、Lステップと並行運用中のため、beyond line からは一斉配信できません(お客様に二重で届くのを防ぐため)。本番に切り替えたあと、使えるようになります。';

export function isParallelAccount(account: { lstep_forward_url?: string | null } | null | undefined): boolean {
  return !!account?.lstep_forward_url;
}
