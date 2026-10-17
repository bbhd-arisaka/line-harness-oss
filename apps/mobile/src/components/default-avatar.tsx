import { StyleSheet, View } from 'react-native';

/**
 * プロフィール画像がない友だちの表示。普通のLINEと同じ、灰色の丸に白い人型。
 * 画像ライブラリを使わず、丸だけで描く(頭=小さい丸、肩=大きい丸を、下を丸い枠で切り取る)。
 */
export function DefaultAvatar({ size }: { size: number }) {
  const head = size * 0.34;
  const body = size * 0.74;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="プロフィール画像なし"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <View style={{ position: 'absolute', top: size * 0.2, left: (size - head) / 2, width: head, height: head, borderRadius: head / 2, backgroundColor: '#ffffff' }} />
      <View style={{ position: 'absolute', top: size * 0.62, left: (size - body) / 2, width: body, height: body, borderRadius: body / 2, backgroundColor: '#ffffff' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: '#c5cbd3', overflow: 'hidden' },
});
