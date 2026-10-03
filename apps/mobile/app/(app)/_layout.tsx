import { Stack } from 'expo-router';
import { View } from 'react-native';
import { AccountProvider, authStore, useAccounts } from '../../src/state/session';
import { Button, EmptyView, ErrorView, LoadingView } from '../../src/components/ui';
import { NO_ACCOUNTS_MESSAGE } from '../../src/lib/accounts';
import { PushSetup } from '../../src/state/push';
import { useColors } from '../../src/theme/theme';

/** ログイン後の入口: 公式アカウントの一覧を取り、0件・エラー・選択待ちを振り分ける */
function Gate() {
  const c = useColors();
  const acc = useAccounts();

  if (acc.status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <LoadingView label="アカウントを読み込み中…" />
      </View>
    );
  }
  if (acc.status === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ErrorView message={acc.errorMessage ?? ''} onRetry={acc.reload} />
        <View style={{ padding: 24 }}>
          <Button title="ログアウト" variant="secondary" onPress={() => void authStore.logout()} />
        </View>
      </View>
    );
  }
  // 許可前の新規ユーザー: API が空の一覧を返す
  if (acc.accounts.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <EmptyView title="アカウントがありません" message={NO_ACCOUNTS_MESSAGE}>
          <Button title="もう一度確認する" onPress={acc.reload} style={{ marginTop: 24, alignSelf: 'stretch' }} />
          <Button title="ログアウト" variant="secondary" onPress={() => void authStore.logout()} style={{ marginTop: 12, alignSelf: 'stretch' }} />
        </EmptyView>
      </View>
    );
  }

  const ready = acc.selected !== null && !acc.choosing;
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: c.background },
        headerStyle: { backgroundColor: c.card },
        headerTintColor: c.text,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'トーク' }} />
        <Stack.Screen name="friend/[id]" options={{ title: '友だち詳細' }} />
      </Stack.Protected>
      <Stack.Protected guard={acc.choosing}>
        <Stack.Screen name="select-account" options={{ title: 'アカウントを選ぶ', headerBackVisible: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function AppLayout() {
  return (
    <AccountProvider>
      <PushSetup />
      <Gate />
    </AccountProvider>
  );
}
