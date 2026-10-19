import { useEffect, useRef, useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const OPEN_W = 88; // 開いたときの、操作ボタンの幅

/** いま開いている行(同時に開くのは1行だけ)。一覧のスクロールを始めたときなどに、閉じる */
let openRowClose: (() => void) | null = null;
export function closeOpenSwipeRow(): void {
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
  icon: React.ComponentProps<typeof Ionicons>['name'];
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
      if (openRowClose && openRowClose !== closeSelfRef.current) openRowClose();
      openRowClose = closeSelfRef.current;
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

  // スクロールが止まった位置で、開いている/閉じているを決める(止まる位置は、スクロールの吸い付きで 0 か OPEN_W)
  const onSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const open = e.nativeEvent.contentOffset.x < OPEN_W / 2;
    if (open !== openRef.current) setOpenState(open);
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
          snapToOffsets={[0, OPEN_W]}
          snapToAlignment="start"
          contentOffset={{ x: OPEN_W, y: 0 }}
          scrollEventThrottle={32}
          keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={onSettled}
          onScrollEndDrag={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            if (x <= 1 || x >= OPEN_W - 1) onSettled(e);
          }}
        >
          <View style={{ flexDirection: 'row', width: width + OPEN_W }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => {
                closeSelfRef.current();
                onTrigger();
              }}
              style={[styles.action, { backgroundColor: color }]}
            >
              <Ionicons name={icon} size={22} color="#ffffff" />
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
