import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { hapticLongPress } from '../../../src/lib/haptics';
import { AccountBar } from '../../../src/components/account-bar';
import { Avatar, EmptyView, ErrorView, LoadingView, StatusBadge } from '../../../src/components/ui';
import { api } from '../../../src/state/services';
import { useAccounts } from '../../../src/state/session';
import { formatListTime, messagePreview } from '../../../src/lib/format';
import type { ChatStatus, ChatSummary, MessageSearchHit } from '../../../src/lib/types';
import { MIN_TAP, useColors } from '../../../src/theme/theme';
import { describeError } from '../../../src/lib/errors';
import { isSplitLayout, LIST_PANE_WIDTH } from '../../../src/lib/layout';
import { ChatView } from '../../../src/components/chat-view';
import { useDebounced, useInterval } from '../../../src/state/hooks';
import { useUnread } from '../../../src/state/unread';
import { mergeFreshPage } from '../../../src/lib/chat-list-merge';
import { ACTIVITY_RETRY_MS, subscribeChatActivity } from '../../../src/lib/chat-activity';
import { parseChatFilter } from '../../../src/lib/home';
import { StatusChip } from '../../../src/components/status-chip';
import { SwipeRow, closeOpenSwipeRow, swallowTouchWhileOpen } from '../../../src/components/swipe-row';
import { FadeIn } from '../../../src/components/fade-in';
import { animateLayout } from '../../../src/lib/motion';

const PAGE_SIZE = 50;
/** トーク内容の検索は、2文字以上から(サーバー側も同じ) */
const MESSAGE_SEARCH_MIN = 2;

type Filter = 'all' | ChatStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'unread', label: '未対応' },
  { key: 'in_progress', label: '対応中' },
  { key: 'resolved', label: '対応済み' },
];

const ChatRow = memo(function ChatRow({ chat, onPress, onLongPress, selected }: { chat: ChatSummary; onPress: (id: string) => void; onLongPress?: (chat: ChatSummary) => void; selected?: boolean }) {
  const c = useColors();
  const unread = chat.status === 'unread';
  return (
    <Pressable
      onPress={() => onPress(chat.friendId)}
      onLongPress={onLongPress ? () => { hapticLongPress(); onLongPress(chat); } : undefined}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityLabel={`${chat.pinned ? 'ピン留め。' : ''}${chat.friendName}。${unread ? '未対応。' : ''}${messagePreview(chat)}`}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed || selected ? c.inputBackground : c.card, borderBottomColor: c.border }]}
    >
      <View>
        <Avatar uri={chat.friendPictureUrl} name={chat.friendName} size={48} />
        {unread ? <View style={[styles.unreadDot, { backgroundColor: c.danger, borderColor: c.card }]} /> : null}
        {/* ピン留め: プロフィール画像の右下に、青い丸+白いピン(普通のLINEと同じ) */}
        {chat.pinned ? (
          <View style={[styles.pinBadge, { borderColor: c.card }]} accessibilityLabel="ピン留め">
            <MaterialCommunityIcons name="pin" size={14} color="#ffffff" />
          </View>
        ) : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, { color: c.text, fontWeight: unread ? '800' : '600' }]} numberOfLines={1}>
            {chat.friendName}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: unread ? c.danger : c.textMuted, fontSize: 12 }}>{formatListTime(chat.lastMessageAt)}</Text>
          </View>
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

/** トーク内容の検索結果の1行: 名前・該当メッセージの一部・日付 */
const MessageHitRow = memo(function MessageHitRow({ hit, onPress }: { hit: MessageSearchHit; onPress: (id: string) => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => onPress(hit.friendId)}
      accessibilityRole="button"
      accessibilityLabel={`${hit.name}。${hit.snippet}`}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.inputBackground : c.card, borderBottomColor: c.border }]}
    >
      <Avatar uri={hit.pictureUrl} name={hit.name} size={48} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, { color: c.text, fontWeight: '600' }]} numberOfLines={1}>
            {hit.name}
          </Text>
          <Text style={{ color: c.textMuted, fontSize: 12 }}>
            {formatListTime(hit.createdAt)}
            {hit.hits > 1 ? ` ・ ${hit.hits}件` : ''}
          </Text>
        </View>
        <Text style={[styles.preview, { color: c.textMuted, marginTop: 3 }]} numberOfLines={2}>
          {hit.direction === 'outgoing' ? '送信: ' : ''}
          {hit.snippet}
        </Text>
      </View>
    </Pressable>
  );
});

/**
 * トークの一覧。
 * - 通常: 行をタップすると、トーク画面を開く
 * - 2列表示の左側(onOpen を渡す): 行をタップすると、右側のチャットを切り替える。選択中の行は色が付く
 */
function ChatList({ onOpen, selectedId, reloadSignal = 0 }: { onOpen?: (id: string) => void; selectedId?: string | null; reloadSignal?: number }) {
  const c = useColors();
  const router = useRouter();
  const { selected } = useAccounts();
  const accountId = selected?.id ?? null;
  const { refresh: refreshUnread } = useUnread();

  const [filter, setFilter] = useState<Filter>('all');
  // ホームの「現在の対応状況」・お知らせから来たときは、その状態に絞って開く(押すたびに t が変わる)
  const params = useLocalSearchParams<{ filter?: string; t?: string }>();
  useEffect(() => {
    const f = parseChatFilter(params.filter);
    if (f) setFilter(f);
  }, [params.filter, params.t]);
  // 名前の検索(LINE名・本名のどちらでも)。入力が止まって0.4秒後に、サーバーで探す
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim(), 400);
  const [items, setItems] = useState<ChatSummary[]>([]);
  // トーク内容の検索(名前の検索と同じ入力欄)。名前の結果の下に「トークの内容」として出す
  const [msgHits, setMsgHits] = useState<MessageSearchHit[]>([]);
  const [msgSearching, setMsgSearching] = useState(false);
  // ピン留めしたトーク(一覧の上に出す。ふつうの一覧とは別に、小さな問い合わせで取る)
  const [pinnedItems, setPinnedItems] = useState<ChatSummary[]>([]);
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
        const [rows, pins] = await Promise.all([
          api.listChats({ lineAccountId: accountId, status: filter === 'all' ? undefined : filter, search, limit: PAGE_SIZE, pinned: 'exclude' }),
          // ピン留めが取れなくても、ふつうの一覧は見られる
          api.listChats({ lineAccountId: accountId, status: filter === 'all' ? undefined : filter, search, pinned: 'only' }).catch(() => null),
        ]);
        if (id !== seq.current) return;
        // 並びが変わる更新(新着で上へ・ピン留めの出入り)は、なめらかに動かす。最初の読み込みは、一覧が現れる動きにまかせる
        if (mode !== 'initial') animateLayout();
        if (pins) setPinnedItems(pins.map((p) => ({ ...p, pinned: true })));
        if (mode === 'silent') {
          // 裏の更新: 「続きを読み込む」で出した古い行は消さない
          setItems((prev) => mergeFreshPage(prev, rows, PAGE_SIZE));
          if (rows.length < PAGE_SIZE) setHasMore(false);
        } else {
          setItems(rows);
          setHasMore(rows.length >= PAGE_SIZE);
        }
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
    [accountId, filter, search],
  );

  // 検索語がメッセージの本文に含まれる友だちも探す(入力が止まったあと・2文字以上)
  useEffect(() => {
    if (!accountId || search.length < MESSAGE_SEARCH_MIN) {
      setMsgHits([]);
      setMsgSearching(false);
      return;
    }
    let cancelled = false;
    setMsgSearching(true);
    api
      .searchChatMessages(accountId, search)
      .then((res) => {
        if (!cancelled) setMsgHits(res.items);
      })
      .catch(() => {
        // 名前の検索は使えるので、内容の検索が失敗しても何も出さない
        if (!cancelled) setMsgHits([]);
      })
      .finally(() => {
        if (!cancelled) setMsgSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, search]);

  // アカウント・絞り込み・検索が変わったら最初から
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
      refreshUnread(); // 下バーの数字(トーク画面で対応状態を変えたかもしれない)
    }, [fetchFirst, refreshUnread]),
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
        search,
        limit: PAGE_SIZE,
        before: { at: last.lastMessageAt, id: last.friendId },
        pinned: 'exclude',
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

  /** ピン留め・解除。先に、行を動かして(なめらかに)から、サーバーに送る。失敗したら取り直す */
  const togglePinChat = useCallback(
    async (chat: ChatSummary) => {
      const next = !chat.pinned;
      animateLayout();
      if (next) {
        setItems((prev) => prev.filter((i) => i.id !== chat.id));
        setPinnedItems((prev) => [{ ...chat, pinned: true }, ...prev.filter((i) => i.id !== chat.id)]);
      } else {
        setPinnedItems((prev) => prev.filter((i) => i.id !== chat.id));
        setItems((prev) => [...prev.filter((i) => i.id !== chat.id), { ...chat, pinned: false }].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')));
      }
      try {
        await api.pinChat(chat.friendId, next);
      } catch (e) {
        setError(describeError(e, 'ピン留めを変更できませんでした'));
        void fetchFirst('silent');
      }
    },
    [fetchFirst],
  );

  /** 行を長押し: ピン留めする・外す */
  const onLongPressChat = useCallback(
    (chat: ChatSummary) => {
      const label = chat.pinned ? 'ピン留めを外す' : 'ピン留めする';
      const run = () => togglePinChat(chat);
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions({ options: [label, 'キャンセル'], cancelButtonIndex: 1 }, (i) => {
          if (i === 0) void run();
        });
      } else {
        Alert.alert('', undefined, [{ text: label, onPress: () => void run() }, { text: 'キャンセル', style: 'cancel' }]);
      }
    },
    [togglePinChat],
  );

  const openChat = useCallback(
    (id: string) => (onOpen ? onOpen(id) : router.push({ pathname: '/chat/[id]', params: { id } })),
    [router, onOpen],
  );

  // 2列表示では、右側で状態を変えたり送信したときに、一覧も最新にする。開いている間は定期的にも更新する
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    void fetchFirst('silent');
  }, [reloadSignal, fetchFirst]);
  // 一覧は、開いている間は20秒ごとに「新着の有無」だけを確認し(1行しか読まない)、変わっていたときだけ取り直す
  // (一覧の取得は1回で数万行を読むので、定期的に丸ごと取り直さない)。iPhoneの1列表示でも、新着が並びに反映される
  const lastPulse = useRef<string | null>(null);
  useInterval(
    () => {
      void (async () => {
        try {
          const p = await api.getChatPulse();
          if (lastPulse.current !== null && p.latest !== lastPulse.current) void fetchFirst('silent');
          if (p.latest) lastPulse.current = p.latest;
        } catch {
          // 確認に失敗したときは、次の確認まで待つ
        }
      })();
    },
    20_000,
    !loading,
  );
  // 通知が届いたら、待たずにすぐ最新にする
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | null = null;
    const off = subscribeChatActivity(() => {
      void fetchFirst('silent');
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => void fetchFirst('silent'), ACTIVITY_RETRY_MS);
    });
    return () => {
      off();
      if (retry) clearTimeout(retry);
    };
  }, [fetchFirst]);

  return (
    <View
      style={{ flex: 1, backgroundColor: c.background }}
      // 行が開いているとき、ほかの場所(開いている行の外)をタップしたら、閉じるだけにする
      onStartShouldSetResponderCapture={(e) => swallowTouchWhileOpen(e.nativeEvent.pageX, e.nativeEvent.pageY)}
    >
      <AccountBar />
      <View style={[styles.searchWrap, { backgroundColor: c.card }]}>
        <View style={[styles.searchBox, { backgroundColor: c.inputBackground }]}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="名前・トークの内容で検索"
            placeholderTextColor={c.textMuted}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="トークを検索"
            style={[styles.searchInput, { color: c.text }]}
          />
        </View>
      </View>
      <View style={[styles.filters, { backgroundColor: c.card, borderBottomColor: c.border }]}>
        {FILTERS.map((f) => (
          <StatusChip key={f.key} label={f.label} status={f.key} active={f.key === filter} showDot={false} onPress={() => setFilter(f.key)} />
        ))}
      </View>

      {loading ? (
        <LoadingView />
      ) : error && items.length === 0 && pinnedItems.length === 0 ? (
        <ErrorView message={error} onRetry={() => void fetchFirst('initial')} />
      ) : (
        <FadeIn>
        <FlatList
          data={[...pinnedItems, ...items]}
          keyExtractor={(it) => it.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScrollBeginDrag={closeOpenSwipeRow}
          renderItem={({ item }) => (
            <SwipeRow key={item.pinned ? 'pinned' : 'normal'} label={item.pinned ? 'ピン留め解除' : 'ピン留め'} icon={item.pinned ? 'pin-off' : 'pin'} color="#4f6bed" onTrigger={() => void togglePinChat(item)}>
              <ChatRow chat={item} onPress={openChat} onLongPress={onLongPressChat} selected={item.friendId === selectedId} />
            </SwipeRow>
          )}
          extraData={selectedId}
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
            search && (msgHits.length > 0 || msgSearching) ? null : (
            <EmptyView
              title={search ? '見つかりませんでした' : filter === 'all' ? 'トークはまだありません' : `${FILTERS.find((f) => f.key === filter)?.label}のトークはありません`}
            />
            )
          }
          ListFooterComponent={
            <>
              {loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={c.primary} /> : null}
              {msgHits.length > 0 ? (
                <View>
                  <Text style={[styles.sectionLabel, { color: c.textMuted, backgroundColor: c.inputBackground }]}>トークの内容</Text>
                  {msgHits.map((h) => (
                    <MessageHitRow key={h.friendId} hit={h} onPress={openChat} />
                  ))}
                </View>
              ) : null}
            </>
          }
          contentContainerStyle={items.length === 0 && pinnedItems.length === 0 && msgHits.length === 0 ? { flexGrow: 1 } : undefined}
        />
        </FadeIn>
      )}
    </View>
  );
}

/** トークの入口。幅が広い(iPad の横など)ときは「左に一覧・右にチャット」の2列 */
export default function ChatListScreen() {
  const { width } = useWindowDimensions();
  const c = useColors();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);
  const onChanged = useCallback(() => setReloadSignal((n) => n + 1), []);
  if (!isSplitLayout(width)) return <ChatList />;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.background }}>
      <View style={{ width: LIST_PANE_WIDTH, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border }}>
        <ChatList onOpen={setSelectedId} selectedId={selectedId} reloadSignal={reloadSignal} />
      </View>
      <View style={{ flex: 1, backgroundColor: c.chatBackground }}>
        {selectedId ? (
          <ChatView key={selectedId} id={selectedId} embedded onChanged={onChanged} />
        ) : (
          <EmptyView title="トークを選んでください" message="左の一覧から選ぶと、ここに表示されます" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 12, paddingTop: 8 },
  searchBox: { minHeight: 40, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 40, fontSize: 16 },
  filters: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, marginLeft: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, gap: 8 },
  name: { flex: 1, fontSize: 16 },
  preview: { flex: 1, fontSize: 14 },
  unreadDot: { position: 'absolute', top: -1, right: -1, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  pinBadge: { position: 'absolute', right: -4, bottom: -4, width: 24, height: 24, borderRadius: 12, borderWidth: 2, backgroundColor: '#4f6bed', alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 12, fontWeight: '600' },
  banner: { padding: 10, margin: 12, borderRadius: 10 },
});
