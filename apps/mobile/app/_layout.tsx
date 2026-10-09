import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth, useRestoreSession } from '../src/state/session';
import { LoadingView } from '../src/components/ui';
import { contentMaxWidth, isSplitLayout } from '../src/lib/layout';
import { useColors } from '../src/theme/theme';

function Navigator() {
  const auth = useAuth();
  const c = useColors();
  useRestoreSession();

  if (auth.status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <LoadingView label="起動しています…" />
      </View>
    );
  }
  const signedIn = auth.status === 'signedIn';
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

/** iPad の縦など中くらいの幅では、中身を読みやすい幅にして中央に置く(iPhone はそのまま) */
function Frame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const c = useColors();
  const max = contentMaxWidth(width);
  // 幅が十分ある iPad の横などは、画面全体を使う(トークの2列表示のため)。他の画面は、各画面が読みやすい幅にする
  if (max === null || isSplitLayout(width)) return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: c.chatBackground }}>
      <View style={{ flex: 1, width: '100%', maxWidth: max, backgroundColor: c.background, borderLeftWidth: 1, borderRightWidth: 1, borderColor: c.border }}>{children}</View>
    </View>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Frame>
        <Navigator />
      </Frame>
    </SafeAreaProvider>
  );
}
