import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { useColors } from '../theme/theme';

/** 前回の確認から、これだけ(ミリ秒)たたないと、アプリに戻っても確認しない */
const MIN_CHECK_GAP_MS = 60_000;

/**
 * アプリを開いた時と、ほかのアプリから戻った時に、更新(OTA)を確かめる。
 * あれば、ポップアップを出して操作できない状態にし、ダウンロードして、自動で再起動する。
 * 確認やダウンロードに失敗したときは、何も出さずにそのまま使えるようにする(通信の失敗で止めない)。
 */
export function AutoUpdate() {
  const c = useColors();
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'restarting'>('idle');
  const busy = useRef(false);
  const lastCheck = useRef(0);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    async function check() {
      if (busy.current || Date.now() - lastCheck.current < MIN_CHECK_GAP_MS) return;
      busy.current = true;
      lastCheck.current = Date.now();
      try {
        const res = await Updates.checkForUpdateAsync();
        if (!res.isAvailable) return;
        setPhase('downloading');
        await Updates.fetchUpdateAsync();
        setPhase('restarting');
        await Updates.reloadAsync();
      } catch {
        setPhase('idle');
      } finally {
        busy.current = false;
      }
    }

    void check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, []);

  return (
    <Modal visible={phase !== 'idle'} transparent animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View style={[styles.box, { backgroundColor: c.card }]}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', marginTop: 14 }}>
            {phase === 'restarting' ? '再起動しています' : '更新をダウンロードしています'}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  box: { paddingVertical: 28, paddingHorizontal: 32, borderRadius: 16, alignItems: 'center', minWidth: 240 },
});
