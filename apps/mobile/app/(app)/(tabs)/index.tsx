import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { AccountBar } from '../../../src/components/account-bar';
import { Avatar, EmptyView, ErrorView, LoadingView, StatusBadge } from '../../../src/components/ui';
import { api } from '../../../src/state/services';
import { useAccounts } from '../../../src/state/session';
import { formatListTime, messagePreview } from '../../../src/lib/format';
import type { ChatStatus, ChatSummary } from '../../../src/lib/types';
import { MIN_TAP, useColors } from '../../../src/theme/theme';
import { describeError } from '../../../src/lib/errors';

const PAGE_SIZE = 50;

type Filter = 'all' | ChatStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'unread', label: '未対応' },
  { key: 'in_progress', label: '対応中' },
  { key: 'resolved', label: '対応済み' },
];

const ChatRow = memo(function ChatRow({ chat, onPress }: { chat: ChatSummary; onPress: (id: string) => void }) {
  const c = useColors();
  const unread = chat.status === 'unread';
  return (
    <Pressable
      onPress={() => onPress(chat.friendId)}
      accessibilityRole="button"
      accessibilityLabel={`${chat.friendName}。${unread ? '未対応。' : ''}${messagePreview(chat)}`}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.inputBackground : c.card, borderBottomColor: c.border }]}
    >
      <View>
        <Avatar uri={chat.friendPictureUrl} name={chat.friendName} size={48} />
        {unread ? <View style={[styles.unreadDot, { backgroundColor: c.danger, borderColor: c.card }]} /> : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, { color: c.text, fontWeight: unread ? '800' : '600' }]} numberOfLines={1}>
            {chat.friendName}
          </Text>
          <Text style={{ color: unread ? c.danger : c.textMuted, fontSize: 12 }}>{formatListTime(chat.lastMessageAt)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={[styles.preview, { color: unread ? c.text : c.textMuted }]} numberOfLines={1}>
            {messagePreview(chat) || 'メッセージはまだありません'}
          </Text>
          {chat.status !== 'resolved' ? <StatusBadge status={chat.status} /> : null}
        </View>
      </View>
    </Pressable>
  );
});

export default function ChatListScreen() {
  const c = useColors();
  const router = useRouter();
  const { selected } = useAccounts();
  const accountId = selected?.id ?? null;

  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
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
      }
      if (mode === 'refresh') setRefreshing(true);
      try {
        const rows = await api.listChats({ lineAccountId: accountId, status: filter === 'all' ? undefined : filter, limit: PAGE_SIZE });
        if (id !== seq.current) return;
        setItems(rows);
        setHasMore(rows.length >= PAGE_SIZE);
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
    [accountId, filter],
  );

  // アカウント・絞り込みが変わったら最初から
  useEffect(() => {
    queueMicrotask(() => void fetchFirst('initial'));
  }, [fetchFirst]);

  // トーク画面から戻ったときに、未対応・対応中の状態と並びを最新にする
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
    const last = items[items.length - 1];
    if (!last?.lastMessageAt) return;
    moreLock.current = true;
    setLoadingMore(true);
    const id = seq.current;
    try {
      const rows = await api.listChats({
        lineAccountId: accountId,
        status: filter === 'all' ? undefined : filter,
        limit: PAGE_SIZE,
        before: { at: last.lastMessageAt, id: last.friendId },
      });
      if (id !== seq.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...rows.filter((r) => !seen.has(r.id))];
      });
      setHasMore(rows.length >= PAGE_SIZE);
    } catch {
      // 続きの取得に失敗したら、そこで止める(引っ張って更新すれば戻せる)
      setHasMore(false);
    } finally {
      moreLock.current = false;
      setLoadingMore(false);
    }
  }

  const openChat = useCallback((id: string) => router.push({ pathname: '/chat/[id]', params: { id } }), [router]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AccountBar />
      <View style={[styles.filters, { backgroundColor: c.card, borderBottomColor: c.border }]}>
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.chip, { backgroundColor: active ? c.primaryButton : c.inputBackground }]}
            >
              <Text style={{ color: active ? '#ffffff' : c.textSub, fontSize: 14, fontWeight: '700' }}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <LoadingView />
      ) : error && items.length === 0 ? (
        <ErrorView message={error} onRetry={() => void fetchFirst('initial')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => <ChatRow chat={item} onPress={openChat} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchFirst('refresh')} tintColor={c.primary} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            error ? (
              <View style={[styles.banner, { backgroundColor: c.dangerSoft }]}>
                <Text style={{ color: c.danger, fontSize: 13 }}>{error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyView
              title={filter === 'all' ? 'トークはまだありません' : `${FILTERS.find((f) => f.key === filter)?.label}のトークはありません`}
              message="下に引っ張ると更新できます"
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
  filters: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  chip: { minHeight: 36, minWidth: MIN_TAP + 8, paddingHorizontal: 12, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, marginLeft: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, gap: 8 },
  name: { flex: 1, fontSize: 16 },
  preview: { flex: 1, fontSize: 14 },
  unreadDot: { position: 'absolute', top: -1, right: -1, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  banner: { padding: 10, margin: 12, borderRadius: 10 },
});
