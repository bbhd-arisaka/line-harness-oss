import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, EmptyView, ErrorView, LoadingView, SectionTitle } from '../../src/components/ui';
import { FadeIn } from '../../src/components/fade-in';
import { withReadableWidth } from '../../src/components/readable-width';
import { api } from '../../src/state/services';
import { useAccounts } from '../../src/state/session';
import { describeError } from '../../src/lib/errors';
import { num, signed } from '../../src/lib/home';
import { PERIODS, periodMonths, type Period } from '../../src/lib/form-analytics';
import {
  buildInflowBars,
  buildInflowRows,
  INFLOW_METRICS,
  inflowPreviousTotal,
  inflowTotal,
  selectInflowRoutes,
  type InflowAnalytics,
  type InflowMetric,
} from '../../src/lib/inflow-analytics';
import { MIN_TAP, useColors } from '../../src/theme/theme';

/**
 * 流入経路分析。上から、期間 → 人数/回数の切り替え → 合計(前の期間との差つき) → 月別の棒グラフ(12か月) → 経路別の一覧(割合つき)。
 * 一覧の行を押すと、合計と棒グラフがその経路だけに絞られ、「利用した人を見る」で、読み取った人と日時の一覧を開ける。もう一度押すと全体に戻る。
 * サーバーからは「経路×月の人数・回数」だけを取り、足し合わせは端末で行う(切り替えてもサーバーを呼ばない)。
 */
function InflowAnalyticsScreen() {
  const c = useColors();
  const router = useRouter();
  const { selected } = useAccounts();
  const accountId = selected?.id ?? null;
  const [data, setData] = useState<InflowAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<Period>('thisMonth');
  const [metric, setMetric] = useState<InflowMetric>('people');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!accountId) return;
      const mine = ++seq.current;
      if (mode === 'initial') {
        setLoading(true);
        setData(null);
      }
      setError(null);
      try {
        const next = await api.getInflowAnalytics(accountId, mode === 'refresh');
        if (mine !== seq.current) return;
        setData(next);
      } catch (e) {
        if (mine !== seq.current) return;
        setError(describeError(e, '読み込めませんでした'));
      } finally {
        if (mine === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [accountId],
  );

  useEffect(() => {
    queueMicrotask(() => void load('initial'));
  }, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const routes = selectInflowRoutes(data, selectedId);
    const months = periodMonths(data.currentMonth, period);
    return {
      rows: buildInflowRows(data, metric, period),
      total: inflowTotal(routes, metric, data.currentMonth, period),
      previous: inflowPreviousTotal(routes, metric, data.currentMonth, period),
      bars: buildInflowBars(routes, metric, data.currentMonth),
      inPeriod: (month: string) => (months ? months.includes(month) : true),
    };
  }, [data, period, metric, selectedId]);

  if (!accountId) return <ErrorView message="公式アカウントが選ばれていません" onRetry={() => undefined} />;
  if (loading && !data) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={() => void load('initial')} />;
  if (!data || !view) return null;
  if (data.routes.length === 0) return <EmptyView title="流入経路からの友だち追加はまだありません" />;

  const unit = INFLOW_METRICS.find((m) => m.key === metric)?.unit ?? '';
  const selectedRow = selectedId ? view.rows.find((r) => r.id === selectedId) : undefined;
  const diff = view.previous === null ? null : view.total - view.previous;
  const maxBar = Math.max(1, ...view.bars.map((b) => b.count));
  const maxRow = Math.max(1, ...view.rows.map((r) => r.count));
  const BAR_H = 96;

  return (
    <FadeIn>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load('refresh'); }} tintColor={c.primary} />}
      >
        <View style={styles.chips}>
          {PERIODS.map((p) => (
            <Chip key={p.key} label={p.label} active={period === p.key} onPress={() => setPeriod(p.key)} />
          ))}
        </View>
        <View style={styles.chips}>
          {INFLOW_METRICS.map((m) => (
            <Chip key={m.key} label={m.label} active={metric === m.key} onPress={() => setMetric(m.key)} />
          ))}
        </View>

        <Card>
          {selectedRow ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${selectedRow.label}の絞り込みを解除`} onPress={() => setSelectedId(null)} style={[styles.selected, { backgroundColor: c.inputBackground }]}>
              <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{selectedRow.label}</Text>
              <Ionicons name="close-circle" size={16} color={c.textMuted} />
            </Pressable>
          ) : null}
          <Text style={{ color: c.textMuted, fontSize: 12 }}>{metric === 'people' ? '友だちになった人' : '読み取られた回数'}</Text>
          <View style={styles.totalRow}>
            <Text style={{ color: c.text, fontSize: 36, fontWeight: '600' }}>{num(view.total)}<Text style={{ fontSize: 15, fontWeight: '400' }}>{unit}</Text></Text>
            {diff !== null ? (
              <Text style={{ color: diff > 0 ? c.primaryText : diff < 0 ? c.danger : c.textMuted, fontSize: 14, fontWeight: '600' }}>
                {diff === 0 ? '±0' : signed(diff)}
              </Text>
            ) : null}
          </View>

          <View style={[styles.bars, { height: BAR_H + 16 }]} accessibilityLabel="月別の棒グラフ">
            {view.bars.map((b) => (
              <View key={b.month} style={styles.barCol}>
                <Text style={{ color: c.textMuted, fontSize: 10, height: 14 }} numberOfLines={1}>{b.count > 0 ? String(b.count) : ''}</Text>
                <View style={{ height: BAR_H, justifyContent: 'flex-end' }}>
                  <View style={{ height: Math.max(b.count > 0 ? 3 : 1, (b.count / maxBar) * BAR_H), borderRadius: 3, backgroundColor: b.count === 0 ? c.border : view.inPeriod(b.month) ? c.primary : c.border }} />
                </View>
              </View>
            ))}
          </View>
          <View style={styles.axisRow}>
            {view.bars.map((b, i) => (
              <Text key={b.month} style={[styles.axisLabel, { color: c.textMuted }]} numberOfLines={1}>
                {i % 2 === 1 || i === view.bars.length - 1 ? String(Number(b.month.slice(5))) : ''}
              </Text>
            ))}
          </View>

          {selectedRow ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${selectedRow.label}を利用した人を見る`}
              onPress={() => router.push({ pathname: '/inflow-stats' as never, params: { id: selectedRow.id, name: selectedRow.label } })}
              style={({ pressed }) => [styles.detailButton, { backgroundColor: pressed ? c.inputBackground : c.card, borderColor: c.border }]}
            >
              <Ionicons name="people-outline" size={18} color={c.primaryText} />
              <Text style={{ color: c.text, fontSize: 14, fontWeight: '600', flex: 1 }}>利用した人を見る</Text>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </Pressable>
          ) : null}
        </Card>

        <View style={styles.listHead}>
          <SectionTitle>経路別</SectionTitle>
        </View>

        <Card style={{ paddingVertical: 4 }}>
          {view.rows.map((r, i) => {
            const active = r.id === selectedId;
            return (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${r.label} ${r.count}${unit} ${r.percent}%`}
                onPress={() => setSelectedId(active ? null : r.id)}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null,
                  { backgroundColor: active ? c.inputBackground : pressed ? c.inputBackground : 'transparent' },
                ]}
              >
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 14, fontWeight: active ? '700' : '500' }} numberOfLines={2}>{r.label}</Text>
                    {r.folder ? <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{r.folder}</Text> : null}
                  </View>
                  <Text style={{ color: c.textMuted, fontSize: 13 }}>{r.percent}%</Text>
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', minWidth: 48, textAlign: 'right' }}>{num(r.count)}{unit}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: c.border }]}>
                  <View style={[styles.fill, { width: `${(r.count / maxRow) * 100}%`, backgroundColor: c.primary }]} />
                </View>
              </Pressable>
            );
          })}
        </Card>
      </ScrollView>
    </FadeIn>
  );
}

export default withReadableWidth(InflowAnalyticsScreen);

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? c.primary : c.card, borderColor: active ? c.primary : c.border }]}
    >
      <Text style={{ color: active ? '#ffffff' : c.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: MIN_TAP - 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  selected: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, marginBottom: 8, maxWidth: '100%' },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: 14 },
  barCol: { flex: 1 },
  axisRow: { flexDirection: 'row', gap: 3, marginTop: 4 },
  axisLabel: { flex: 1, fontSize: 10, textAlign: 'center' },
  detailButton: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TAP, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, marginTop: 12 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  row: { paddingHorizontal: 12, paddingVertical: 10, gap: 6, minHeight: MIN_TAP },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
