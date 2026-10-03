import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authStore } from '../src/state/session';
import { Button } from '../src/components/ui';
import { MIN_TAP, useColors } from '../src/theme/theme';
import { describeError } from '../src/lib/errors';

export default function LoginScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      // 成功すると authStore が変わり、ルートのナビゲーションが自動でアプリ側へ切り替わる
      await authStore.login(email, password);
    } catch (e) {
      // API の error をそのまま表示(429 は「しばらく待つ」旨の文言が API から返る)
      setError(describeError(e, 'ログインできませんでした'));
      setBusy(false);
    }
  }

  const inputStyle = [styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.text }];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={[styles.logo, { backgroundColor: c.primary }]}>
          <Text style={styles.logoText}>b</Text>
        </View>
        <Text style={[styles.title, { color: c.text }]}>beyond line</Text>
        <Text style={[styles.subtitle, { color: c.textSub }]}>beyond admin のメールアドレスとパスワードでログインします</Text>

        <Text style={[styles.label, { color: c.textSub }]}>メールアドレス</Text>
        <TextInput
          style={inputStyle}
          value={email}
          onChangeText={setEmail}
          placeholder="name@example.com"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          returnKeyType="next"
          editable={!busy}
          onSubmitEditing={() => passwordRef.current?.focus()}
          accessibilityLabel="メールアドレス"
        />

        <Text style={[styles.label, { color: c.textSub }]}>パスワード</Text>
        <View>
          <TextInput
            ref={passwordRef}
            style={[...inputStyle, { paddingRight: 72 }]}
            value={password}
            onChangeText={setPassword}
            placeholder="パスワード"
            placeholderTextColor={c.textMuted}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="go"
            editable={!busy}
            onSubmitEditing={submit}
            accessibilityLabel="パスワード"
          />
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            style={styles.toggle}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
          >
            <Text style={{ color: c.primaryText, fontWeight: '700' }}>{showPassword ? '隠す' : '表示'}</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={[styles.error, { backgroundColor: c.dangerSoft }]} accessibilityRole="alert">
            <Text style={{ color: c.danger, fontSize: 14, lineHeight: 20 }}>{error}</Text>
          </View>
        ) : null}

        <Button title="ログイン" onPress={submit} loading={busy} disabled={!canSubmit} style={{ marginTop: 24 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, maxWidth: 480, width: '100%', alignSelf: 'center' },
  logo: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  logoText: { color: '#ffffff', fontSize: 44, fontWeight: '800', marginTop: -4 },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: 16 },
  subtitle: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8, marginBottom: 28 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 6, marginTop: 14 },
  input: {
    minHeight: MIN_TAP + 4,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  toggle: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 68, alignItems: 'center', justifyContent: 'center' },
  error: { marginTop: 16, padding: 12, borderRadius: 10 },
});
