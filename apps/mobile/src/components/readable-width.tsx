import type { ComponentType } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { contentMaxWidth, isSplitLayout } from '../lib/layout';
import { useColors } from '../theme/theme';

/**
 * 広い画面(iPad の横など)で、画面の中身を読みやすい幅にして中央に置く。
 * (iPhone・iPad の縦では、全体の枠(Frame)が同じことをしているので、ここでは何もしない)
 * 画面全体の幅を使うのは、トークの2列表示だけ。
 */
export function withReadableWidth<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function Wrapped(props: P) {
    const { width } = useWindowDimensions();
    const c = useColors();
    const max = contentMaxWidth(width);
    if (max === null || !isSplitLayout(width)) return <Screen {...props} />;
    return (
      <View style={{ flex: 1, alignItems: 'center', backgroundColor: c.chatBackground }}>
        <View style={{ flex: 1, width: '100%', maxWidth: max, backgroundColor: c.background, borderLeftWidth: 1, borderRightWidth: 1, borderColor: c.border }}>
          <Screen {...props} />
        </View>
      </View>
    );
  }
  Wrapped.displayName = `ReadableWidth(${Screen.displayName || Screen.name || 'Screen'})`;
  return Wrapped;
}
