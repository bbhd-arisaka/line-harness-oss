import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { authStore, useAccounts, useAuth } from '../../../src/state/session';
import { Button, Card, confirmAsync, SectionTitle } from '../../../src/components/ui';
import { accountLabel } from '../../../src/lib/accounts';
import { MIN_TAP, useColors } from '../../../src/theme/theme';

const ROLE_LABEL: Record<string, string> = { owner: 'オーナー', admin: '管理者', staff: 'スタッフ' };

function Row({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.infoRow}>
      <Text style={{ color: c.textMuted, fontSize: 13, width: 84 }}>{label}</Text>
      <Text selectable style={{ color: c.text, fontSize: 15, flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const c = useColors();
  const auth = useAuth();
  const acc = useAccounts();
  const staff = auth.staff;
  const version = Constants.expoConfig?.version ?? '-';

  async function logout() {
    const ok = await confirmAsync('ログアウトしますか?', 'このスマートフォンのログインを終了します。', 'ログアウト');
    if (ok) await authStore.logout();
  }

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      <SectionTitle>ログイン中のユーザー</SectionTitle>
      <Card>
        <Row label="名前" value={staff?.name ?? '-'} />
        <Row label="メール" value={staff?.email ?? '-'} />
        <Row label="役割" value={staff ? (ROLE_LABEL[staff.role] ?? staff.role) : '-'} />
      </Card>

      <SectionTitle>公式アカウント</SectionTitle>
      <Pressable
        onPress={acc.startChoosing}
        accessibilityRole="button"
        accessibilityLabel="公式アカウントを切り替える"
        style={({ pressed }) => [styles.link, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.textMuted, fontSize: 12 }}>いま見ているアカウント</Text>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>
            {acc.selected ? accountLabel(acc.selected) : '未選択'}
          </Text>
        </View>
        <Text style={{ color: c.primaryText, fontWeight: '700', marginRight: 4 }}>切り替え</Text>
        <Ionicons name="chevron-forward" size={18} color={c.primaryText} />
      </Pressable>

      <SectionTitle>アプリ</SectionTitle>
      <Card>
        <Row label="バージョン" value={version} />
      </Card>

      <Button title="ログアウト" variant="danger" onPress={logout} style={{ marginTop: 28 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  link: {
    minHeight: MIN_TAP + 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
