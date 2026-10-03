import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP } from '../theme/theme';

/** 画像の拡大表示(簡易)。どこをタップしても、または「閉じる」で閉じる。uri が null のとき非表示 */
export function ImageViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // 別の画像を開いたら、読み込み状態を最初に戻す
  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      setFailed(false);
    });
  }, [uri]);

  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="画像を閉じる">
        {uri && !failed ? (
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setFailed(true);
              setLoading(false);
            }}
            accessibilityLabel="拡大した画像"
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {loading ? <ActivityIndicator size="large" color="#ffffff" style={StyleSheet.absoluteFill} /> : null}
        {failed ? <Text style={styles.failed}>画像を表示できませんでした</Text> : null}
        <View style={[styles.close, { top: insets.top + 8 }]} pointerEvents="none">
          <Ionicons name="close" size={26} color="#ffffff" />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  close: { position: 'absolute', right: 12, width: MIN_TAP, height: MIN_TAP, borderRadius: MIN_TAP / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  failed: { color: '#ffffff', fontSize: 15 },
});
