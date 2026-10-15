import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from './ui';
import { MIN_TAP, useColors } from '../theme/theme';

export interface PickItem {
  id: string;
  label: string;
  /** 補足(選択肢の例など) */
  note?: string;
}

/** 一覧から1つ選ぶ画面(検索つき)。タグ・友だち情報の項目を選ぶのに使う */
export function PickModal({
  visible,
  title,
  items,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: PickItem[];
  onPick: (item: PickItem) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? items.filter((i) => i.label.toLowerCase().includes(k)) : items;
  }, [items, q]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '700', flex: 1 }}>{title}</Text>
          <Button title="閉じる" variant="secondary" onPress={onClose} style={{ minHeight: MIN_TAP, paddingHorizontal: 12 }} />
        </View>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="さがす"
          placeholderTextColor={c.textMuted}
          autoCorrect={false}
          style={[styles.search, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
        />
        <FlatList
          data={shown}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={{ color: c.textMuted, padding: 16, textAlign: 'center' }}>見つかりません</Text>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setQ('');
                onPick(item);
              }}
              style={({ pressed }) => [styles.row, { borderBottomColor: c.border, backgroundColor: pressed ? c.primarySoft : 'transparent' }]}
            >
              <Text style={{ color: c.text, fontSize: 16 }}>{item.label}</Text>
              {item.note ? <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{item.note}</Text> : null}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { margin: 12, minHeight: MIN_TAP, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  row: { minHeight: MIN_TAP, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
