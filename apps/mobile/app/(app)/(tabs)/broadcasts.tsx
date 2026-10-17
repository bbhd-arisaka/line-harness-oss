import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AccountBar } from '../../../src/components/account-bar';
import { Button, EmptyView, ErrorView, LoadingView } from '../../../src/components/ui';
import { api } from '../../../src/state/services';
import { useAccounts, useAuth } from '../../../src/state/session';
import { describeSavedConditions, broadcastStatusLabel, messageSummary } from '../../../src/lib/broadcast';
import { formatScheduled } from '../../../src/lib/schedule';
import { formatListTime } from '../../../src/lib/format';
import { describeError } from '../../../src/lib/errors';
import type { BroadcastItem } from '../../../src/lib/types';
import { MIN_TAP, useColors } from '../../../src/theme/theme';

/** 一斉配信: 配信の履歴と、「新しい配信」への入口。オーナー・管理者だけが使える(サーバーでも確認している) */
export default function BroadcastsScreen() {
  const c = useColors();
  const router = useRouter();
  const { selected } = useAccounts();
  const staff = useAuth().staff;
  const accountId = selected?.id ?? null;
  const allowed = staff?.role === 'owner' || staff?.role === 'admin';

  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (!accountId || !allowed) {
        setLoading(false);
        return;
      }
      const id = ++seq.current;
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const rows = await api.listBroadcasts(accountId);
        if (id !== seq.current) return;
        setItems(rows);
        setError(null);
      } catch (e) {
        if (id !== seq.current) return;
        if (mode !== 'silent') setError(describeError(e, '配信の履歴を読み込めませんでした'));
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [accountId, allowed],
  );

  useEffect(() => {
    queueMicrotask(() => void load('initial'));
  }, [load]);

  // 配信を作ったあとなどに戻ったとき、履歴を最新にする
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void load('silent');
    }, [load]),
  );

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <AccountBar />
        <EmptyView title="一斉配信は、オーナーまたは管理者だけが使えます" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AccountBar />
      <View style={styles.top}>
        <Button title="新しい配信を作る" onPress={() => router.push('/broadcast-new')} />
      </View>
      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorView message={error} onRetry={() => void load('initial')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : { padding: 12, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />}
          ListEmptyComponent={<EmptyView title="まだ配信がありません" message="「新しい配信を作る」から、友だち全員、または条件で絞り込んだ友だちに、メッセージを送れます。" />}
          renderItem={({ item }) => {
            const narrowed = describeSavedConditions(item.segmentConditions);
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/broadcast/[id]', params: { id: item.id } })}
                style={({ pressed }) => [styles.row, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={{ color: c.textSub, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                    {messageSummary({ type: item.messageType, content: item.messageContent })}
                    {(item.messageCount ?? 1) > 1 ? `  (全${item.messageCount}通)` : ''}
                  </Text>
                  <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4 }}>
                    {broadcastStatusLabel(item.status)}
                    {item.status === 'scheduled' && item.scheduledAt ? `(${formatScheduled(item.scheduledAt)})` : ''}
                    {item.status === 'sent' || item.status === 'sending' ? ` ・ ${item.successCount.toLocaleString('ja-JP')}/${item.totalCount.toLocaleString('ja-JP')}人` : ''}
                    {narrowed ? ` ・ ${narrowed}` : ''}
                    {` ・ ${formatListTime(item.sentAt ?? item.createdAt)}`}
                  </Text>
                  {item.lastError ? <Text style={{ color: c.danger, fontSize: 12, marginTop: 2 }}>{item.lastError}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  row: { minHeight: MIN_TAP, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
