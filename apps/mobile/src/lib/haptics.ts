// 触覚フィードバック(小さな振動)。expo-haptics を使う。
// 端末のアプリ(ビルド)に expo-haptics が入っていないときは、何もしない(読み込みの失敗も、握りつぶす)。
// → アプリの更新(OTA)で先にこのコードを配っておき、次のビルドで expo-haptics が入ると、そのまま動く。
import { Platform } from 'react-native';

type Haptics = {
  impactAsync: (style: unknown) => Promise<void>;
  selectionAsync: () => Promise<void>;
  notificationAsync: (type: unknown) => Promise<void>;
  ImpactFeedbackStyle: { Light: unknown; Medium: unknown };
  NotificationFeedbackType: { Success: unknown };
};

let mod: Haptics | null | undefined;
function load(): Haptics | null {
  if (mod !== undefined) return mod;
  if (Platform.OS === 'web') {
    mod = null;
    return mod;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-haptics') as Haptics;
  } catch {
    mod = null;
  }
  return mod;
}

function run(fn: (h: Haptics) => Promise<void>): void {
  const h = load();
  if (!h) return;
  try {
    void fn(h).catch(() => undefined);
  } catch {
    // 使えない端末・設定のときは、何もしない
  }
}

/** 長押ししたとき(小さく、トン) */
export function hapticLongPress(): void {
  run((h) => h.impactAsync(h.ImpactFeedbackStyle.Light));
}

/** 選んだ・開いたとき(かすかに、コツ) */
export function hapticSelect(): void {
  run((h) => h.selectionAsync());
}

/** 実行できたとき(ピン留めなど) */
export function hapticSuccess(): void {
  run((h) => h.notificationAsync(h.NotificationFeedbackType.Success));
}
