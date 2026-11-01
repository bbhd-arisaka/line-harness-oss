import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, EmptyView, ErrorView, LoadingView } from '../../src/components/ui';
import { FadeIn } from '../../src/components/fade-in';
import { withReadableWidth } from '../../src/components/readable-width';
import { api } from '../../src/state/services';
import { describeError } from '../../src/lib/errors';
import { formatDateTime } from '../../src/lib/format';
import { num } from '../../src/lib/home';
import type { InflowHit, InflowStats } from '../../src/lib/inflow-analytics';
import { MIN_TAP, useColors } from '../../src/theme/theme';

/** 流入経路の詳細: その経路を読み取った人と日時(新しい順)。人を押すと友だち詳細へ。 */
function InflowStatsScreen() {
  const c = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string; name?: string }>();
  const [head, setHead] = useState<Pick<InflowStats, 'total' | 'people'> | null>(null);
  const [rows, setRows] = useState<InflowHit[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (next: number) => {
      if (!id) return;
      const mine = ++seq.current;
      if (next === 1) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const res = await api.getInflowStats(id, next);
        if (mine !== seq.current) return;
        setHead({ total: res.total, people: res.people });
        setRows((prev) => (next === 1 ? res.rows : [...prev, ...res.rows]));
        setPage(next);
        setHasMore(next * res.pageSize < res.total);
      } catch (e) {
        if (mine !== seq.current) return;
        setError(describeError(e, '読み込めませんでした'));
      } finally {
        if (mine === seq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [id],
  );

  useEffect(() => {
    queueMicrotask(() => void load(1));
  }, [load]);

  if (loading && rows.length === 0) return <LoadingView />;
  if (error && rows.length === 0) return <ErrorView message={error} onRetry={() => void load(1)} />;
  if (rows.length === 0) return <EmptyView title="この経路を読み取った人はまだいません" />;

  return (
    <FadeIn>
      <FlatList
        style={{ flex: 1, backgroundColor: c.background }}
        data={rows}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={
          head ? (
            <View style={styles.head}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{num(head.people)}人</Text>
              <Text style={{ color: c.textMuted, fontSize: 13 }}>{num(head.total)}回</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            disabled={!item.friendId}
            accessibilityRole="button"
            accessibilityLabel={`${item.friendName} ${formatDateTime(item.at)}`}
            onPress={() => item.friendId && router.push({ pathname: '/friend/[id]', params: { id: item.friendId } })}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.inputBackground : c.card, borderBottomColor: c.border }]}
          >
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '600', flex: 1 }} numberOfLines={1}>{item.friendName}</Text>
            <Text style={{ color: c.textMuted, fontSize: 12 }}>{formatDateTime(item.at)}</Text>
            {item.friendId ? <Ionicons name="chevron-forward" size={16} color={c.textMuted} /> : null}
          </Pressable>
        )}
        ListFooterComponent={
          hasMore ? (
            <View style={{ padding: 16 }}>
              <Button title="もっと見る" variant="secondary" loading={loadingMore} onPress={() => void load(page + 1)} />
            </View>
          ) : null
        }
      />
    </FadeIn>
  );
}

export default withReadableWidth(InflowStatsScreen);

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TAP, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});
