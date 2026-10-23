import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/state/services';
import { useAccounts } from '../../src/state/session';
import { Avatar, EmptyView, ErrorView, LoadingView } from '../../src/components/ui';
import { HighlightedText } from '../../src/components/highlighted-text';
import { withReadableWidth } from '../../src/components/readable-width';
import { formatListTime } from '../../src/lib/format';
import { describeError } from '../../src/lib/errors';
import { snippetAround } from '../../src/lib/search-highlight';
import type { MessageSearchItem } from '../../src/lib/types';
import { useColors } from '../../src/theme/theme';

/**
 * 検索結果の「◯件のメッセージ」: 1人のトークの中で、検索語を含むメッセージの一覧。
 * 行をタップすると、そのトークを、そのメッセージの位置で開く。
 */
function MessageSearchScreen() {
  const c = useColors();
  const router = useRouter();
  const { selected } = useAccounts();
  const { friendId, q, name, pictureUrl } = useLocalSearchParams<{ friendId: string; q: string; name: string; pictureUrl?: string }>();
  const [items, setItems] = useState<MessageSearchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selected || !friendId || !q) return;
    setError(null);
    try {
      setItems((await api.searchChatMessagesOfFriend(selected.id, friendId, q)).items);
    } catch (e) {
      setError(describeError(e, '検索結果を読み込めませんでした'));
    }
  }, [selected, friendId, q]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (error) return <ErrorView message={error} onRetry={() => void load()} />;
  if (!items) return <LoadingView />;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: name ?? 'トーク' }} />
      <FlatList
        data={items}
        keyExtractor={(it) => it.messageId}
        ListHeaderComponent={
          <Text style={[styles.heading, { color: c.text }]}>{`'${q}' ${items.length}件のメッセージ`}</Text>
        }
        ListEmptyComponent={<EmptyView title="見つかりませんでした" />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: friendId, messageId: item.messageId, q } })}
            accessibilityRole="button"
            accessibilityLabel={item.content}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.inputBackground : c.card, borderBottomColor: c.border }]}
          >
            <Avatar uri={item.direction === 'outgoing' ? null : pictureUrl} name={item.direction === 'outgoing' ? '送信' : (name ?? '')} size={44} />
            <View style={styles.body}>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
                {item.direction === 'outgoing' ? '送信' : name}
              </Text>
              <HighlightedText
                text={snippetAround(item.content, q ?? '', 12, 90)}
                query={q ?? ''}
                numberOfLines={2}
                style={{ color: c.textMuted, fontSize: 14, marginTop: 2 }}
                hitStyle={{ color: '#06c755', fontWeight: '700' }}
              />
            </View>
            <Text style={{ color: c.textMuted, fontSize: 12 }}>{formatListTime(item.createdAt)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '800', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { flex: 1 },
});

export default withReadableWidth(MessageSearchScreen);
