import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../state/services';
import { useDebounced } from '../state/hooks';
import { Avatar, Button } from './ui';
import { resolveFriendName } from '../lib/format';
import { describeError } from '../lib/errors';
import { MIN_TAP, useColors } from '../theme/theme';

export interface PickedFriend {
  id: string;
  name: string;
  pictureUrl: string | null;
}

/**
 * 友だちを検索して、チェックで複数選ぶ画面(テスト送信の宛先)。
 * 何も入力していないときは、前回のテスト送信で使った友だちを上に並べる。
 */
export function FriendMultiPickModal({
  visible,
  accountId,
  initial,
  max,
  onDone,
  onClose,
}: {
  visible: boolean;
  accountId: string;
  initial: PickedFriend[];
  max: number;
  onDone: (picked: PickedFriend[]) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const [q, setQ] = useState('');
  const word = useDebounced(q.trim(), 300);
  const searchMode = word.length >= 2;
  const [history, setHistory] = useState<PickedFriend[]>([]);
  const [found, setFound] = useState<PickedFriend[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 選んだ人(検索を変えても残す)
  const [picked, setPicked] = useState<Map<string, PickedFriend>>(new Map());
  const seq = useRef(0);

  // 開くたびに、選択を引き継いで、履歴を取り直す
  useEffect(() => {
    if (!visible) return;
    setPicked(new Map(initial.map((f) => [f.id, f])));
    setQ('');
    setFound([]);
    setError(null);
    let alive = true;
    api
      .listTestSendHistory(accountId)
      .then((rows) => {
        if (alive) setHistory(rows.map((r) => ({ id: r.id, name: r.displayName, pictureUrl: r.pictureUrl })));
      })
      .catch(() => {
        /* 候補が出ないだけ。検索はできる */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, accountId]);

  useEffect(() => {
    if (!visible || !searchMode) {
      setFound([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    api
      .listFriends({ lineAccountId: accountId, search: word, limit: 30 })
      .then((page) => {
        if (mine !== seq.current) return;
        setFound(
          page.items
            .filter((f) => f.isFollowing)
            .map((f) => ({ id: f.id, name: resolveFriendName(f), pictureUrl: f.pictureUrl })),
        );
      })
      .catch((e) => {
        if (mine === seq.current) setError(describeError(e, '検索できませんでした'));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [visible, searchMode, word, accountId]);

  function toggle(f: PickedFriend) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(f.id)) next.delete(f.id);
      else if (next.size < max) next.set(f.id, f);
      return next;
    });
  }

  const list = searchMode ? found : history;
  const full = picked.size >= max;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '700', flex: 1 }}>テスト送信する友だちを選ぶ</Text>
          <Button title="閉じる" variant="secondary" onPress={onClose} style={{ minHeight: MIN_TAP, paddingHorizontal: 12 }} />
        </View>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="友だちの名前で検索(2文字以上)"
          placeholderTextColor={c.textMuted}
          autoCorrect={false}
          style={[styles.search, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
          accessibilityLabel="友だちを検索"
        />
        <View style={styles.listHead}>
          <Text style={{ color: c.textSub, fontSize: 13, fontWeight: '700', flex: 1 }}>{searchMode ? '検索結果' : '前回使った友だち'}</Text>
          {loading ? <ActivityIndicator color={c.primary} /> : null}
        </View>
        {error ? <Text style={{ color: c.danger, paddingHorizontal: 16, paddingBottom: 6 }}>{error}</Text> : null}
        <FlatList
          data={list}
          keyExtractor={(f) => f.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={{ color: c.textMuted, padding: 16, textAlign: 'center' }}>
              {searchMode ? (loading ? '' : '見つかりません') : '履歴はまだありません。名前で検索してください。'}
            </Text>
          }
          renderItem={({ item }) => {
            const on = picked.has(item.id);
            const blocked = !on && full;
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: blocked }}
                disabled={blocked}
                onPress={() => toggle(item)}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: c.border, backgroundColor: pressed ? c.primarySoft : 'transparent', opacity: blocked ? 0.4 : 1 },
                ]}
              >
                <View style={[styles.box, { borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primary : c.card }]}>
                  {on ? <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>✓</Text> : null}
                </View>
                <Avatar uri={item.pictureUrl} name={item.name} size={36} />
                <Text style={{ color: c.text, fontSize: 16, flex: 1 }} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            );
          }}
        />
        <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.card }]}>
          <Text style={{ color: c.textSub, fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
            {picked.size === 0 ? `送る友だちを選んでください(最大${max}人)` : `${picked.size}人を選んでいます(最大${max}人)`}
          </Text>
          <Button title={picked.size === 0 ? '選ばずに閉じる' : `この${picked.size}人で決定`} onPress={() => onDone([...picked.values()])} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { margin: 12, minHeight: MIN_TAP, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  listHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6, minHeight: 24 },
  row: { minHeight: MIN_TAP + 8, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  footer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
