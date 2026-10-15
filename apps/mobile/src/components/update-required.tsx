import { useEffect, useSyncExternalStore } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './ui';
import { api } from '../state/services';
import { getUpdateState, markUpdateRequired, subscribeUpdateState } from '../lib/app-update';
import { useColors } from '../theme/theme';

/** 更新が必要か(サーバーに言われた時点で true。画面全体を、更新の案内に切り替える) */
export function useUpdateRequired() {
  return useSyncExternalStore(subscribeUpdateState, getUpdateState, getUpdateState);
}

/** 起動のたびに、サーバーに「このアプリは古くて、更新が必要か」を確かめる(ログイン前でも) */
export function useCheckUpdateAtLaunch() {
  useEffect(() => {
    let alive = true;
    api
      .getAppConfig()
      .then((cfg) => {
        if (alive && cfg.updateRequired) markUpdateRequired(cfg.storeUrl);
      })
      .catch(() => {
        // 確認できないときは、そのまま使えるようにする(通信の失敗で、使えなくしない)
      });
    return () => {
      alive = false;
    };
  }, []);
}

/** 強制アップデートの画面。ほかの操作はできず、App Store を開くボタンだけを出す */
export function UpdateRequiredScreen({ storeUrl }: { storeUrl: string }) {
  const c = useColors();
  return (
    <View style={[styles.wrap, { backgroundColor: c.background }]}>
      <View style={[styles.icon, { backgroundColor: c.primarySoft }]}>
        <Ionicons name="cloud-download" size={44} color={c.primary} />
      </View>
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 20 }}>アプリを更新してください</Text>
      <Text style={{ color: c.textSub, fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 12 }}>
        新しいバージョンが公開されました。{'\n'}更新すると、これまでどおり続けて使えます。
      </Text>
      <Button title="App Storeを開く" onPress={() => void Linking.openURL(storeUrl)} style={{ marginTop: 28, alignSelf: 'stretch' }} />
      <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'center', marginTop: 16 }}>
        App Storeで「beyond line」を開き、「アップデート」を押してください。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
});
