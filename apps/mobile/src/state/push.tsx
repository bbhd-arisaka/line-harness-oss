// プッシュ通知(iOS・Android の実機のみ)。許可の確認・デバイストークン(iOS は APNs・Android は FCM)の登録・通知タップでのトーク表示。
// web では何もしない。失敗しても画面は壊さない(ログのみ)。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { api, storage } from './services';
import { useAccounts } from './session';
import { emitChatActivity } from '../lib/chat-activity';
import {
  normalizeApnsToken,
  normalizeFcmToken,
  parseNotificationTarget,
  planNavigation,
  planPermission,
  PUSH_EXPLAINED_KEY,
  type PermissionState,
} from '../lib/notifications';

export const PUSH_SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';

/** Android の通知チャンネル(サーバー services/fcm.ts の ANDROID_CHANNEL_ID と同じ ID) */
const ANDROID_CHANNEL_ID = 'messages';

/** 端末のトークンを、この OS の形にそろえる(iOS=APNs の16進・Android=FCM の登録トークン) */
function normalizeDeviceToken(data: unknown): string | null {
  return Platform.OS === 'android' ? normalizeFcmToken(data) : normalizeApnsToken(data);
}

/** サーバーに、この端末の送り先を登録する */
function sendTokenToServer(token: string): Promise<null> {
  return Platform.OS === 'android' ? api.setFcmToken(token) : api.setApnsToken(token);
}

if (PUSH_SUPPORTED) {
  if (Platform.OS === 'android') {
    // Android 8 以降は、通知チャンネルが無いと通知が出ない。許可を求める前に作っておく
    Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'お客様からのメッセージ',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
    }).catch((e) => console.warn('[push] channel', e));
  }
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

/** デバイストークン(iOS は APNs・Android は FCM)を取り、サーバーに登録する。Expo Go など取れない環境では何もしない */
async function registerCurrentToken(): Promise<boolean> {
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    const token = normalizeDeviceToken(t.data);
    if (!token) return false;
    await sendTokenToServer(token);
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
        const token = normalizeDeviceToken(t.data);
        if (token) sendTokenToServer(token).catch((e) => logFailure('update token', e));
      });
    } catch (e) {
      logFailure('addPushTokenListener', e);
    }
    return () => sub?.remove();
  }, []);

  // 通知のタップは iOS・Android のときだけ扱う(フックは web では使えないので、コンポーネントごと出し分ける)
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
      const target = targetOf(response.notification.request);
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

  // 同じチャットの通知は、iOS では同じ識別子(apns-collapse-id)になる。識別子だけで見ると、2通目のタップを「処理済み」と誤って捨てるので、通知が届いた時刻も含めて見分ける
  const handle = useCallback(
    (response: Notifications.NotificationResponse) => {
      const key = `${response.notification.request.identifier}:${response.notification.date}:${response.actionIdentifier}`;
      if (handled.current === key) return;
      handled.current = key;
      try {
        open(response);
      } catch (e) {
        logFailure('open from notification', e);
      }
    },
    [open],
  );

  // 終了中・起動直後のタップ(アカウントの準備ができてから開く)
  useEffect(() => {
    if (!ready || !lastResponse) return;
    handle(lastResponse);
  }, [ready, lastResponse, handle]);

  // 起動中のタップは、そのつど直接受け取る(「最後のタップ」の更新に頼らない)
  useEffect(() => {
    if (!ready) return;
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [ready, handle]);

  // アプリが前面のときに通知が届いたら、開いているトーク・トーク一覧にも新着を反映する(10秒ごとの確認を待たない)
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      try {
        emitChatActivity(targetOf(n.request)?.chatId ?? null);
      } catch (e) {
        logFailure('notify chat views', e);
      }
    });
    return () => sub.remove();
  }, []);

  return null;
}

/** 通知の中身は、content.data にあるはずだが、環境によっては trigger.payload の側(Android の FCM は remoteMessage.data)にだけ入っている。すべて見る */
function targetOf(req: Notifications.NotificationRequest) {
  const trigger = req.trigger as { payload?: unknown; remoteMessage?: { data?: unknown } } | null;
  return (
    parseNotificationTarget(req.content.data) ??
    parseNotificationTarget(trigger?.remoteMessage?.data) ??
    parseNotificationTarget(trigger?.payload) ??
    parseNotificationTarget((trigger?.payload as { body?: unknown } | undefined)?.body)
  );
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
