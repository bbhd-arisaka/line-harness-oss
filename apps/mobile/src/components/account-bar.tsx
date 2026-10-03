import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAccounts } from '../state/session';
import { accountLabel } from '../lib/accounts';
import { MIN_TAP, useColors } from '../theme/theme';

/** 一覧の上に出す「いま見ている公式アカウント」。複数あるときはタップで切り替え */
export function AccountBar() {
  const c = useColors();
  const acc = useAccounts();
  if (!acc.selected) return null;
  const canSwitch = acc.accounts.length > 1;
  return (
    <Pressable
      disabled={!canSwitch}
      onPress={acc.startChoosing}
      accessibilityRole={canSwitch ? 'button' : 'text'}
      accessibilityLabel={`公式アカウント ${accountLabel(acc.selected)}${canSwitch ? '。タップで切り替え' : ''}`}
      style={[styles.bar, { backgroundColor: c.card, borderBottomColor: c.border }]}
    >
      <View style={[styles.dot, { backgroundColor: c.primary }]} />
      <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
        {accountLabel(acc.selected)}
      </Text>
      {canSwitch ? (
        <>
          <Text style={{ color: c.primaryText, fontSize: 13, fontWeight: '700' }}>切り替え</Text>
          <Ionicons name="chevron-forward" size={16} color={c.primaryText} />
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: MIN_TAP,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  name: { flex: 1, fontSize: 14, fontWeight: '700' },
});
