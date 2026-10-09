import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth, useRestoreSession } from '../src/state/session';
import { LoadingView } from '../src/components/ui';
import { contentMaxWidth } from '../src/lib/layout';
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

/** iPad など広い画面では、中身を読みやすい幅にして中央に置く(iPhone はそのまま) */
function Frame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const c = useColors();
  const max = contentMaxWidth(width);
  if (max === null) return <>{children}</>;
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
