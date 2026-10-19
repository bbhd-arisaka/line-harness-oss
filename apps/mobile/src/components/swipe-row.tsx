import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { hapticSelect, hapticSuccess } from '../lib/haptics';

const OPEN_W = 88; // 開いたときの、操作ボタンの幅
const CLOSED_OFFSET = { x: OPEN_W, y: 0 }; // 毎回あたらしい値を渡すと、再描画のたびに位置が戻ることがあるため、固定

/** いま開いている行(同時に開くのは1行だけ)。一覧のスクロールを始めたときなどに、閉じる */
let openRowClose: (() => void) | null = null;
let openedAt = 0;
export function closeOpenSwipeRow(): void {
  // 開いた直後(指を離して間もない)は閉じない。斜めにスライドしたとき、一覧の縦スクロールの開始で、開いた行が勝手に閉じるのを防ぐ
  if (Date.now() - openedAt < 700) return;
  openRowClose?.();
}

/**
 * 行を右へスライドすると、左に操作ボタン(ピン留めなど)が現れる。ボタンを押すと実行して閉じる(普通のLINEと同じ)。
 *
 * 【作り】行ごとに、横向きの ScrollView(iPhone 標準のスクロール)にする。左に操作ボタン・右に行を並べ、ふだんは行が見える位置
 * (ボタンの幅ぶん右にずらした位置)に止めておく。右へスライド=左へスクロール=ボタンが現れる。
 * 縦と横の振り分け・指への追従・勢い・止まる位置(開く/閉じる)は、すべて iPhone 標準のスクロールの動きで、JS の計算に頼らない
 * (自前のジェスチャーだと、一覧の縦スクロールと同時に動いてしまい、引っかかるため)。
 *  - 開いているとき: 行を押す・ほかの行を開く・一覧を縦にスクロールすると、閉じる
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
  const ref = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const openRef = useRef(false);
  const closeSelfRef = useRef<() => void>(() => undefined);

  const setOpenState = (next: boolean) => {
    openRef.current = next;
    setIsOpen(next);
    if (next) {
      hapticSelect(); // 開いたとき、かすかに
      if (openRowClose && openRowClose !== closeSelfRef.current) openRowClose();
      openRowClose = closeSelfRef.current;
      openedAt = Date.now();
    } else if (openRowClose === closeSelfRef.current) {
      openRowClose = null;
    }
  };
  closeSelfRef.current = () => {
    ref.current?.scrollTo({ x: OPEN_W, animated: true });
    setOpenState(false);
  };

  // 幅が分かったら、閉じた位置(行が見える位置)に置く
  useEffect(() => {
    if (width > 0) ref.current?.scrollTo({ x: OPEN_W, animated: false });
  }, [width]);
  useEffect(
    () => () => {
      if (openRowClose === closeSelfRef.current) openRowClose = null;
    },
    [],
  );

  // 指を離したときに、開く/閉じるを、はっきり決める。
  // 標準の吸い付き(近い方へ)だと、半分近くまで開けないと閉じてしまい、「開けない」と感じるため、少し動かしただけで開くようにする
  //  - 閉じているとき: 24pt 以上ひらく、または右へはらう(速度)と、開く
  //  - 開いているとき: 28pt 以上とじる、または左へはらうと、閉じる
  const settle = (x: number, vx: number) => {
    const reveal = OPEN_W - x; // どれだけ開いたか(0=閉じ・OPEN_W=全開)
    const wantOpen = openRef.current ? !(reveal < OPEN_W - 28 || vx > 0.25) : reveal >= 16 || vx < -0.2;
    ref.current?.scrollTo({ x: wantOpen ? 0 : OPEN_W, animated: true });
    if (wantOpen !== openRef.current) setOpenState(wantOpen);
  };
  // 勢いのスクロールが終わったとき、中途半端な位置(開き途中)で止まっていたら、いまの状態の位置にそろえる。
  // 「開いたのに戻る」「閉じたつもりが半開き」を防ぐ最後の安全網
  const align = (x: number) => {
    const target = openRef.current ? 0 : OPEN_W;
    if (Math.abs(x - target) > 1) ref.current?.scrollTo({ x: target, animated: true });
  };

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <ScrollView
          ref={ref}
          horizontal
          scrollEnabled={!disabled}
          directionalLockEnabled
          bounces={false}
          alwaysBounceHorizontal={false}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          contentOffset={CLOSED_OFFSET}
          scrollEventThrottle={32}
          keyboardShouldPersistTaps="handled"
          onScrollEndDrag={(e) => settle(e.nativeEvent.contentOffset.x, e.nativeEvent.velocity?.x ?? 0)}
          onMomentumScrollEnd={(e) => align(e.nativeEvent.contentOffset.x)}
        >
          <View style={{ flexDirection: 'row', width: width + OPEN_W }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => {
                closeSelfRef.current();
                hapticSuccess();
                onTrigger();
              }}
              style={[styles.action, { backgroundColor: color }]}
            >
              <MaterialCommunityIcons name={icon} size={24} color="#ffffff" />
              <Text style={styles.label}>{label}</Text>
            </Pressable>
            <View style={{ width }}>
              {children}
              {/* 開いているときは、行を押しても開かず、閉じるだけ */}
              {isOpen ? <Pressable accessibilityLabel="閉じる" onPress={() => closeSelfRef.current()} style={StyleSheet.absoluteFill} /> : null}
            </View>
          </View>
        </ScrollView>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  action: { width: OPEN_W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
});
