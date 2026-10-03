import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { AccountBar } from '../../../src/components/account-bar';
import { Avatar, EmptyView, ErrorView, LoadingView } from '../../../src/components/ui';
import { api } from '../../../src/state/services';
import { useAccounts } from '../../../src/state/session';
import { useDebounced } from '../../../src/state/hooks';
import { resolveFriendName } from '../../../src/lib/format';
import type { Friend } from '../../../src/lib/types';
import { MIN_TAP, useColors } from '../../../src/theme/theme';
import { describeError } from '../../../src/lib/errors';

const PAGE_SIZE = 30;

const FriendRow = memo(function FriendRow({ friend, onPress }: { friend: Friend; onPress: (id: string) => void }) {
  const c = useColors();
  const name = resolveFriendName(friend);
  const tags = friend.tags.slice(0, 3).map((t) => t.name).join(' / ');
  return (
    <Pressable
      onPress={() => onPress(friend.id)}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.inputBackground : c.card, borderBottomColor: c.border }]}
    >
      <Avatar uri={friend.pictureUrl} name={name} size={44} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
          {name}
        </Text>
        {friend.realName?.trim() || friend.systemDisplayName?.trim() ? (
          <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
            LINE名: {friend.displayName ?? '-'}
          </Text>
        ) : null}
        {tags ? (
          <Text style={{ color: c.primaryText, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {tags}
          </Text>
        ) : null}
      </View>
      {!friend.isFollowing ? <Text style={{ color: c.textMuted, fontSize: 12 }}>ブロック中</Text> : null}
    </Pressable>
  );
});

export default function FriendsScreen() {
  const c = useColors();
  const router = useRouter();
  const { selected } = useAccounts();
  const accountId = selected?.id ?? null;

  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim(), 400);

  const [items, setItems] = useState<Friend[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const moreLock = useRef(false);

  const fetchFirst = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (!accountId) return;
      const id = ++seq.current;
      if (mode === 'initial') {
        setLoading(true);
        setItems([]);
      } else if (mode === 'refresh') {
        setRefreshing(true);
      }
      try {
        const page = await api.listFriends({ lineAccountId: accountId, search, limit: PAGE_SIZE, offset: 0 });
        if (id !== seq.current) return;
        setItems(page.items);
        setTotal(page.total);
        setHasMore(page.hasNextPage);
        setError(null);
      } catch (e) {
        if (id !== seq.current) return;
        // 画面にデータがあるときの裏の更新失敗は、表示を消さない
        if (mode !== 'silent') setError(describeError(e, '読み込めませんでした'));
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [accountId, search],
  );

  useEffect(() => {
    queueMicrotask(() => void fetchFirst('initial'));
  }, [fetchFirst]);

  // 友だち詳細で名前を直して戻ったときに、一覧の名前を最新にする
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void fetchFirst('silent');
    }, [fetchFirst]),
  );

  async function loadMore() {
    if (!accountId || !hasMore || moreLock.current || loading) return;
    moreLock.current = true;
    setLoadingMore(true);
    const id = seq.current;
    try {
      const page = await api.listFriends({ lineAccountId: accountId, search, limit: PAGE_SIZE, offset: items.length });
      if (id !== seq.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((f) => !seen.has(f.id))];
      });
      setHasMore(page.hasNextPage);
    } catch {
      setHasMore(false);
    } finally {
      moreLock.current = false;
      setLoadingMore(false);
    }
  }

  const openFriend = useCallback((id: string) => router.push({ pathname: '/friend/[id]', params: { id } }), [router]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AccountBar />
      <View style={[styles.searchWrap, { backgroundColor: c.card, borderBottomColor: c.border }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="名前で検索"
          placeholderTextColor={c.textMuted}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="友だちを検索"
          style={[styles.search, { backgroundColor: c.inputBackground, color: c.text }]}
        />
      </View>

      {loading ? (
        <LoadingView />
      ) : error && items.length === 0 ? (
        <ErrorView message={error} onRetry={() => void fetchFirst('initial')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(f) => f.id}
          renderItem={({ item }) => <FriendRow friend={item} onPress={openFriend} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchFirst('refresh')} tintColor={c.primary} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            items.length > 0 ? (
              <Text style={{ color: c.textMuted, fontSize: 12, marginHorizontal: 16, marginVertical: 8 }}>
                {search ? `「${search}」の検索結果 ` : ''}
                {total.toLocaleString('ja-JP')}人
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyView
              title={search ? '見つかりませんでした' : '友だちがいません'}
              message={search ? '名前の一部で検索できます。ひらがな・漢字は表記が違うと見つからないことがあります。' : undefined}
            />
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={c.primary} /> : null}
          contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { minHeight: MIN_TAP, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});
