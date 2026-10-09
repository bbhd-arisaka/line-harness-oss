import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAccounts } from '../../src/state/session';
import { Avatar, Button } from '../../src/components/ui';
import { accountLabel } from '../../src/lib/accounts';
import { MIN_TAP, useColors } from '../../src/theme/theme';
import { withReadableWidth } from '../../src/components/readable-width';

/** 公式アカウントの切り替え。選択は端末に保存される(session.tsx の choose) */
function SelectAccountScreen() {
  const c = useColors();
  const acc = useAccounts();

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen
        options={{
          headerRight: acc.selected
            ? () => <Button title="閉じる" variant="secondary" onPress={acc.cancelChoosing} style={styles.closeButton} />
            : undefined,
        }}
      />
      <FlatList
        data={acc.accounts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={<Text style={[styles.lead, { color: c.textSub }]}>操作する LINE 公式アカウントを選んでください。選んだアカウントは次回も使われます。</Text>}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => {
          const active = item.id === acc.selected?.id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => acc.choose(item.id)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: c.card, borderColor: active ? c.primary : c.border, borderWidth: active ? 2 : 1, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Avatar uri={item.pictureUrl} name={accountLabel(item)} size={48} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                  {accountLabel(item)}
                </Text>
                {item.stats ? (
                  <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>友だち {item.stats.friendCount.toLocaleString('ja-JP')}人</Text>
                ) : null}
              </View>
              {active ? <Text style={{ color: c.primaryText, fontWeight: '700' }}>選択中</Text> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 14, lineHeight: 21, marginBottom: 16 },
  row: { minHeight: 72, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700' },
  closeButton: { minHeight: MIN_TAP, paddingHorizontal: 12 },
});

export default withReadableWidth(SelectAccountScreen);
