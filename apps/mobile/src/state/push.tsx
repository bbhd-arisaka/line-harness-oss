// プッシュ通知(iOS の実機・TestFlight のみ)。許可の確認・APNs デバイストークンの登録・通知タップでのトーク表示。
// web / Android では何もしない。失敗しても画面は壊さない(ログのみ)。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { api, storage } from './services';
import { useAccounts } from './session';
import {
  normalizeApnsToken,
  parseNotificationTarget,
  planNavigation,
  planPermission,
  PUSH_EXPLAINED_KEY,
  type PermissionState,
} from '../lib/notifications';

export const PUSH_SUPPORTED = Platform.OS === 'ios';

if (PUSH_SUPPORTED) {
  // アプリが前面のときも、バナーと通知一覧に出す(音は出す・バッジは触らない)
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function logFailure(what: string, e: unknown) {
  console.warn(`[push] ${what}`, e);
}

/** 通知の許可状態(取れなければ undetermined 扱い) */
async function readPermission(): Promise<PermissionState> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'granted';
    return p.status === 'denied' ? 'denied' : 'undetermined';
  } catch (e) {
    logFailure('getPermissionsAsync', e);
    return 'denied';
  }
}

/** APNs デバイストークンを取り、サーバーに登録する。Expo Go など取れない環境では何もしない */
async function registerCurrentToken(): Promise<boolean> {
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    const token = normalizeApnsToken(t.data);
    if (!token) return false;
    await api.setApnsToken(token);
    return true;
  } catch (e) {
    logFailure('register token', e);
    return false;
  }
}

function confirmExplain(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      '通知を受け取りますか?',
      'お客様から新しいメッセージが届いたときに、このスマートフォンへお知らせします。次の画面で「許可」を選んでください。\n(設定アプリからいつでも変更できます)',
      [
        { text: 'あとで', style: 'cancel', onPress: () => resolve(false) },
        { text: '次へ', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * 許可を確認し、許可されていればトークンを登録する。
 * @param interactive 設定画面からの手動実行。説明済み・拒否済みでも案内を出す
 * @returns 登録できたか
 */
async function setupPush(interactive: boolean): Promise<'registered' | 'denied' | 'skipped' | 'failed'> {
  const status = await readPermission();
  let explained = false;
  try {
    explained = (await storage.get(PUSH_EXPLAINED_KEY)) === '1';
  } catch {
    explained = false;
  }

  let plan = planPermission({ status, explained });
  // 手動(設定画面)なら、未確認のときは説明を出し直す
  if (interactive && plan === 'skip' && status === 'undetermined') plan = 'explain';

  if (plan === 'explain') {
    const ok = await confirmExplain();
    try {
      await storage.set(PUSH_EXPLAINED_KEY, '1');
    } catch {
      // 保存できなくても続ける(次回また聞くだけ)
    }
    if (!ok) return 'skipped';
    try {
      const res = await Notifications.requestPermissionsAsync();
      if (!res.granted) return 'denied';
    } catch (e) {
      logFailure('requestPermissionsAsync', e);
      return 'failed';
    }
    plan = 'register';
  }
  if (plan === 'register') return (await registerCurrentToken()) ? 'registered' : 'failed';
  return status === 'denied' ? 'denied' : 'skipped';
}

/** ログイン後の画面(公式アカウント取得済み)に置く。画面は出さない。 */
export function PushSetup() {
  const acc = useAccounts();
  const ready = acc.status === 'ready' && acc.selected !== null && !acc.choosing;

  // ── 許可の確認・トークンの登録(ログイン後に1回) ──
  const started = useRef(false);
  useEffect(() => {
    if (!PUSH_SUPPORTED || acc.status !== 'ready' || started.current) return;
    started.current = true;
    void setupPush(false).catch((e) => logFailure('setup', e));
  }, [acc.status]);

  // トークンが更新されたら登録し直す
  useEffect(() => {
    if (!PUSH_SUPPORTED) return;
    let sub: { remove: () => void } | null = null;
    try {
      sub = Notifications.addPushTokenListener((t) => {
        const token = normalizeApnsToken(t.data);
        if (token) api.setApnsToken(token).catch((e) => logFailure('update token', e));
      });
    } catch (e) {
      logFailure('addPushTokenListener', e);
    }
    return () => sub?.remove();
  }, []);

  // 通知のタップは iOS のときだけ扱う(フックは web では使えないので、コンポーネントごと出し分ける)
  return PUSH_SUPPORTED ? <NotificationTaps ready={ready} /> : null;
}

/** 通知のタップ(起動中・バックグラウンド・アプリ終了中のどれでも)で、該当のトークを開く */
function NotificationTaps({ ready }: { ready: boolean }) {
  const router = useRouter();
  const acc = useAccounts();
  const lastResponse = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  const accRef = useRef(acc);
  useEffect(() => {
    accRef.current = acc;
  });

  const open = useCallback(
    (response: Notifications.NotificationResponse) => {
      const target = parseNotificationTarget(response.notification.request.content.data);
      const cur = accRef.current;
      const plan = planNavigation(
        target,
        cur.selected?.id ?? null,
        cur.accounts.map((a) => a.id),
      );
      if (plan.kind === 'ignore') return;
      if (plan.switchAccountId) cur.choose(plan.switchAccountId);
      router.push({ pathname: '/chat/[id]', params: { id: plan.chatId } });
    },
    [router],
  );

  useEffect(() => {
    if (!ready || !lastResponse) return;
    const key = `${lastResponse.notification.request.identifier}:${lastResponse.actionIdentifier}`;
    if (handled.current === key) return;
    handled.current = key;
    try {
      open(lastResponse);
    } catch (e) {
      logFailure('open from notification', e);
    }
  }, [ready, lastResponse, open]);

  return null;
}

/** 設定画面用: いまの通知の状態と、有効にする操作 */
export function usePushStatus() {
  const [state, setState] = useState<PermissionState | 'unsupported' | 'loading'>(PUSH_SUPPORTED ? 'loading' : 'unsupported');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!PUSH_SUPPORTED) return;
    setState(await readPermission());
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      await setupPush(true);
    } catch (e) {
      logFailure('enable', e);
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [refresh]);

  return { state, busy, enable, refresh };
}
