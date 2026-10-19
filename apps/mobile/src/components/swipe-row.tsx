import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const OPEN_W = 88; // 開いたときの、操作ボタンの幅

/** いま開いている行(同時に開くのは1行だけ)。一覧のスクロールを始めたときなどに、閉じる */
let openRowClose: (() => void) | null = null;
export function closeOpenSwipeRow(): void {
  openRowClose?.();
}

/**
 * 行を右へスライドすると、左に操作ボタン(ピン留めなど)が現れる。ボタンを押すと実行して閉じる(普通のLINEと同じ)。
 *  - 半分より開けて離す/勢いよくはらうと、開いたままになる。足りなければ、閉じる
 *  - 開いているとき: 行を押す・左へ戻す・ほかの行を開く・一覧をスクロールすると、閉じる
 *  - 縦のスクロールは邪魔しない(横の動きが、縦より十分大きいときだけ反応する)
 * 動きは JS のアニメーション(ネイティブ駆動にしない): ネイティブ駆動のあとに setValue すると、値が固まることがあるため
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
  const x = useRef(new Animated.Value(0)).current;
  const isOpenRef = useRef(false);
  const startRef = useRef(0);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(onTrigger);
  triggerRef.current = onTrigger;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const closeSelfRef = useRef<() => void>(() => undefined);
  const settle = useCallback(
    (toOpen: boolean, velocity = 0) => {
      isOpenRef.current = toOpen;
      setIsOpen(toOpen);
      // ばねのように、すっと収まる(指を離したときの勢いを引き継ぐ)
      Animated.spring(x, { toValue: toOpen ? OPEN_W : 0, velocity, speed: 24, bounciness: 3, useNativeDriver: false }).start();
      if (toOpen) {
        if (openRowClose && openRowClose !== closeSelfRef.current) openRowClose();
        openRowClose = closeSelfRef.current;
      } else if (openRowClose === closeSelfRef.current) {
        openRowClose = null;
      }
    },
    [x],
  );
  closeSelfRef.current = () => settle(false);

  useEffect(
    () => () => {
      if (openRowClose === closeSelfRef.current) openRowClose = null;
    },
    [],
  );

  const pan = useRef(
    PanResponder.create({
      // 右へ(閉じているとき)・開いているときは、左へも
      // 反応しやすく: 少し動かして、縦より横が大きければ、すぐ追いかける
      onMoveShouldSetPanResponder: (_, g) =>
        !disabledRef.current && Math.abs(g.dx) > 5 && Math.abs(g.dx) > Math.abs(g.dy) * 1.15 && (g.dx > 0 || isOpenRef.current),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        x.stopAnimation((v) => {
          startRef.current = v;
        });
      },
      onPanResponderMove: (_, g) => {
        const v = startRef.current + g.dx;
        // 開く幅を超えたぶんは、重く(ゴムのように)
        x.setValue(v < 0 ? 0 : v > OPEN_W ? OPEN_W + (v - OPEN_W) * 0.2 : v);
      },
      onPanResponderRelease: (_, g) => {
        const v = startRef.current + g.dx;
        // 3分の1ほど開けるか、右へはらうと、開く。左へはらう・足りなければ閉じる
        settle(v + g.vx * 100 > OPEN_W * 0.35, g.vx);
      },
      onPanResponderTerminate: () => settle(isOpenRef.current),
    }),
  ).current;

  return (
    <View style={styles.wrap} {...pan.panHandlers}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          settle(false);
          triggerRef.current();
        }}
        style={[styles.action, { backgroundColor: color }]}
      >
        <Ionicons name={icon} size={22} color="#ffffff" />
        <Text style={styles.label}>{label}</Text>
      </Pressable>
      <Animated.View style={{ transform: [{ translateX: x }] }}>
        {children}
        {/* 開いているときは、行を押しても開かず、閉じるだけ */}
        {isOpen ? <Pressable accessibilityLabel="閉じる" onPress={() => settle(false)} style={StyleSheet.absoluteFill} /> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  action: { position: 'absolute', left: 0, top: 0, bottom: 0, width: OPEN_W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
});
