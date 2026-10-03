import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth, useRestoreSession } from '../src/state/session';
import { LoadingView } from '../src/components/ui';
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

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Navigator />
    </SafeAreaProvider>
  );
}
