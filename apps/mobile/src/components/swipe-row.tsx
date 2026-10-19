import { useRef } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const MAX = 92; // 開く幅
const TRIGGER = 64; // ここまで引いて離すと、実行する

/**
 * 行を右へスライドすると、左側に操作(ピン留めなど)が現れ、一定以上引いて離すと実行する(普通のLINEと同じ)。
 * 縦のスクロールは邪魔しない(横の動きが、縦より十分大きいときだけ反応する)。
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
  const triggerRef = useRef(onTrigger);
  triggerRef.current = onTrigger;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const back = () => Animated.timing(x, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => !disabledRef.current && g.dx > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderGrant: () => x.stopAnimation(),
      onPanResponderMove: (_, g) => {
        // 開く幅を超えたぶんは、重く(ゴムのように)
        const d = g.dx <= MAX ? g.dx : MAX + (g.dx - MAX) * 0.25;
        x.setValue(Math.max(0, d));
      },
      onPanResponderRelease: (_, g) => {
        back();
        if (g.dx >= TRIGGER) triggerRef.current();
      },
      onPanResponderTerminate: back,
    }),
  ).current;

  return (
    <View style={styles.wrap} {...pan.panHandlers}>
      <View style={[styles.action, { backgroundColor: color }]} pointerEvents="none">
        <Ionicons name={icon} size={20} color="#ffffff" />
        <Text style={styles.label}>{label}</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }] }}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  action: { position: 'absolute', left: 0, top: 0, bottom: 0, width: MAX + 40, paddingLeft: 14, flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 3 },
  label: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
});
