import { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

/** 中身が現れるとき(画面を開いたとき・公式アカウントや絞り込みを切り替えて一覧が出たとき)に、すっと現れる */
export function FadeIn({ children, style, duration = 240 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; duration?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, duration]);
  return (
    <Animated.View style={[{ flex: 1, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }, style]}>{children}</Animated.View>
  );
}
