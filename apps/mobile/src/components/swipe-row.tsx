import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, type ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { hapticSelect, hapticSuccess } from '../lib/haptics';
import { useColors } from '../theme/theme';

const OPEN_W = 84; // 開いたときの、操作ボタン(丸)がおさまる幅
const BTN = 52; // 丸ボタンの直径
const START = { x: OPEN_W, y: 0 }; // 閉じた位置(行が見える位置)。毎回あたらしい値を渡さないよう、固定

/** 直前に分かった行の幅。作り直された行が、すぐ(幅が分かるのを待たずに)スライドできる状態で出るように使う */
let lastWidth = 0;

/** いま開いている行(同時に開くのは1行だけ)。一覧の縦スクロールを始めたときなどに、閉じる */
let openRowClose: (() => void) | null = null;
/** 開いている行の、画面上の範囲(ボタンの部分も含む行全体)。開いているあいだ、ほかの場所のタップを「閉じる」に使うため */
let openRect: Rect | null = null;
type Rect = { x: number; y: number; w: number; h: number };
const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
export function closeOpenSwipeRow(): void {
  openRowClose?.();
}
/**
 * 画面全体のタップの入口(onStartShouldSetResponderCapture)から呼ぶ。行が開いているとき、開いている行の「外」を
 * タップしたら、開いている行を閉じて、そのタップはほかの操作にしない(true を返す)。
 */
export function swallowTouchWhileOpen(pageX: number, pageY: number): boolean {
  if (!openRowClose) return false;
  if (!openRect || inside(openRect, pageX, pageY)) return false; // 範囲がまだ分からないうちは、何もしない
  openRowClose();
  return true;
}

/**
 * 行を右へスライドすると、左に操作ボタン(ピン留めなど)が現れる。ボタンを押すと実行して閉じる(普通のLINEと同じ)。
 *
 * 【作り】行ごとに、横向きの ScrollView(iPhone 標準のスクロール)にする。左に操作ボタン・右に行を並べ、ふだんは行が見える位置
 * (ボタンの幅ぶん右にずらした位置)に止めておく。右へスライド=左へスクロール=ボタンが現れる。
 *
 * 【開く/閉じるの決め方は、すべて iPhone 標準のスクロールに任せる】
 *  - 止まる位置は、「開いた位置」か「閉じた位置」の2か所だけ(snapToOffsets)。指を離した瞬間に、指の動いた向き(速さが 0 のときは近い方)で
 *    どちらかに決まるので、中途半端な位置では止まらない。
 *  - 自前で scrollTo して補正する、という作りにはしない(勢いのスクロールと競合して、開き途中で止まる・戻る原因になったため)。
 *  - 開いているか閉じているかは、スクロールが止まった位置から読み取るだけ(状態と見た目が食い違わない)。
 *  - プログラムから動かすのは「ボタンを押した・ほかの行を開いた・一覧を縦にスクロールした」ときの閉じる動作だけ。
 */
export function SwipeRow({
  children,
  label,
  icon,
  color,
  onTrigger,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  color: string;
  onTrigger: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const ref = useRef<ScrollView>(null);
  const wrapRef = useRef<View>(null);
  const scrollX = useRef(new Animated.Value(OPEN_W)).current; // 丸ボタンの出方(大きさ・濃さ)に使う。ネイティブ側で動く
  const [width, setWidth] = useState(lastWidth);
  const [isOpen, setIsOpen] = useState(false);
  const openRef = useRef(false);
  const closeSelfRef = useRef<() => void>(() => undefined);
  const xRef = useRef(OPEN_W); // 最後に分かった、スクロール位置
  const draggingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 状態(開/閉)と、見た目の位置がずれていたら、状態の位置にそろえる。
  // 一覧の並べ替えのアニメーション中に、閉じる動きが中断されて「開いたまま」になるのを、必ず直す
  const reconcile = (delay: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (draggingRef.current) return;
      const target = openRef.current ? 0 : OPEN_W;
      if (Math.abs(xRef.current - target) > 1) ref.current?.scrollTo({ x: target, animated: false });
    }, delay);
  };

  const setOpenState = (next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;
    setIsOpen(next);
    if (next) {
      hapticSelect(); // 開いたとき、かすかに
      if (openRowClose && openRowClose !== closeSelfRef.current) openRowClose();
      openRowClose = closeSelfRef.current;
      wrapRef.current?.measureInWindow((x, y, w, h) => {
        if (openRowClose === closeSelfRef.current) openRect = { x, y, w, h };
      });
    } else if (openRowClose === closeSelfRef.current) {
      openRowClose = null;
      openRect = null;
    }
  };
  closeSelfRef.current = () => {
    ref.current?.scrollTo({ x: OPEN_W, animated: true });
    setOpenState(false);
    reconcile(450);
  };

  // 止まった位置から、開いている/閉じているを読み取る(途中の位置のときは、何もしない。そのあとの止まる動きで決まる)
  const read = (x: number) => {
    xRef.current = x;
    if (x <= 1) setOpenState(true);
    else if (x >= OPEN_W - 1) setOpenState(false);
    else if (!draggingRef.current) reconcile(250); // 止まったのに途中の位置(中断された)
  };

  // 幅が分かったら、閉じた位置に置く
  useEffect(() => {
    if (width > 0) ref.current?.scrollTo({ x: OPEN_W, animated: false });
  }, [width]);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (openRowClose === closeSelfRef.current) {
        openRowClose = null;
        openRect = null;
      }
    },
    [],
  );

  const onScroll = useRef(
    Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
      useNativeDriver: true,
      listener: (e: { nativeEvent: { contentOffset: { x: number } } }) => {
        xRef.current = e.nativeEvent.contentOffset.x;
      },
    }),
  ).current;
  // 丸ボタンは、スライドに合わせて、小さく薄い状態から、ふわっと大きく出てくる
  const btnStyle = {
    opacity: scrollX.interpolate({ inputRange: [0, OPEN_W * 0.7, OPEN_W], outputRange: [1, 0.55, 0], extrapolate: 'clamp' as const }),
    transform: [{ scale: scrollX.interpolate({ inputRange: [0, OPEN_W], outputRange: [1, 0.35], extrapolate: 'clamp' as const }) }],
  };

  return (
    <View
      ref={wrapRef}
      style={styles.wrap}
      onLayout={(e) => {
        lastWidth = e.nativeEvent.layout.width;
        setWidth(lastWidth);
      }}
    >
      {width > 0 ? (
        <Animated.ScrollView
          ref={ref}
          horizontal
          scrollEnabled={!disabled}
          directionalLockEnabled
          bounces={false}
          alwaysBounceHorizontal={false}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToOffsets={[0, OPEN_W]}
          snapToStart
          snapToEnd
          disableIntervalMomentum
          contentOffset={START}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={onScroll}
          onScrollBeginDrag={() => {
            draggingRef.current = true;
          }}
          onScrollEndDrag={(e) => {
            draggingRef.current = false;
            read(e.nativeEvent.contentOffset.x);
          }}
          onMomentumScrollEnd={(e) => read(e.nativeEvent.contentOffset.x)}
        >
          <View style={{ flexDirection: 'row', width: width + OPEN_W }}>
            {/* ボタンの置き場。丸ボタンの外を押すと、閉じるだけ */}
            <Pressable accessibilityLabel="閉じる" onPress={() => closeSelfRef.current()} style={[styles.action, { backgroundColor: c.card }]}>
              <Animated.View style={btnStyle}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  hitSlop={6}
                  onPress={() => {
                    closeSelfRef.current();
                    hapticSuccess();
                    // 閉じる動きが終わってから実行する(並べ替えと重なると、閉じる動きが中断されるため)
                    setTimeout(onTrigger, 140);
                  }}
                  style={({ pressed }) => [styles.circle, { backgroundColor: color, opacity: pressed ? 0.85 : 1 }]}
                >
                  <MaterialCommunityIcons name={icon} size={26} color="#ffffff" />
                </Pressable>
              </Animated.View>
            </Pressable>
            <View style={{ width }}>
              {children}
              {/* 開いているときは、行を押しても開かず、閉じるだけ */}
              {isOpen ? <Pressable accessibilityLabel="閉じる" onPress={() => closeSelfRef.current()} style={StyleSheet.absoluteFill} /> : null}
            </View>
          </View>
        </Animated.ScrollView>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  action: { width: OPEN_W, alignItems: 'center', justifyContent: 'center' },
  circle: { width: BTN, height: BTN, borderRadius: BTN / 2, alignItems: 'center', justifyContent: 'center' },
});
