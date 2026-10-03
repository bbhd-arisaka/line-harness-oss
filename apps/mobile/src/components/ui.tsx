import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { MIN_TAP, useColors } from '../theme/theme';
import { nameInitial, statusLabel } from '../lib/format';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = variant === 'primary' ? c.primaryButton : c.card;
  const fg = variant === 'primary' ? '#ffffff' : variant === 'danger' ? c.danger : c.text;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'primary' ? bg : c.border, opacity: off ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Avatar({ uri, name, size = 44 }: { uri?: string | null; name: string; size?: number }) {
  const c = useColors();
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[box, { backgroundColor: c.border }]} accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[box, styles.avatarFallback, { backgroundColor: c.primarySoft }]}>
      <Text style={{ color: c.primaryText, fontSize: size * 0.4, fontWeight: '700' }}>{nameInitial(name)}</Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const c = useColors();
  const palette =
    status === 'unread'
      ? { bg: c.dangerSoft, fg: c.danger }
      : status === 'in_progress'
        ? { bg: c.warningSoft, fg: c.warning }
        : { bg: c.primarySoft, fg: c.primaryText };
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={{ color: palette.fg, fontSize: 11, fontWeight: '700' }}>{statusLabel(status)}</Text>
    </View>
  );
}

// ── 読み込み中・エラー・空の表示(どの画面でも同じ見た目) ──

export function LoadingView({ label = '読み込み中…' }: { label?: string }) {
  const c = useColors();
  return (
    <View style={styles.center} accessibilityLabel={label}>
      <ActivityIndicator size="large" color={c.primary} />
      <Text style={[styles.centerText, { color: c.textMuted }]}>{label}</Text>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useColors();
  return (
    <View style={styles.center}>
      <Text style={[styles.centerTitle, { color: c.danger }]}>読み込めませんでした</Text>
      <Text style={[styles.centerText, { color: c.textSub }]}>{message}</Text>
      {onRetry ? <Button title="もう一度読み込む" variant="secondary" onPress={onRetry} style={{ marginTop: 16 }} /> : null}
    </View>
  );
}

export function EmptyView({ title, message, children }: { title: string; message?: string; children?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.center}>
      <Text style={[styles.centerTitle, { color: c.text }]}>{title}</Text>
      {message ? <Text style={[styles.centerText, { color: c.textSub }]}>{message}</Text> : null}
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const c = useColors();
  return <Text style={[styles.sectionTitle, { color: c.textMuted }]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>;
}

/** 確認ダイアログ。Web(画面確認用)では window.confirm */
export function confirmAsync(title: string, message: string, okLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(`${title}\n${message}`) : false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'キャンセル', style: 'cancel', onPress: () => resolve(false) },
        { text: okLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  button: {
    minHeight: MIN_TAP + 4,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centerTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  centerText: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '700', marginTop: 20, marginBottom: 8, marginLeft: 4 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 12 },
});
