import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, EmptyView, ErrorView, LoadingView, SectionTitle } from '../../src/components/ui';
import { FadeIn } from '../../src/components/fade-in';
import { withReadableWidth } from '../../src/components/readable-width';
import { api } from '../../src/state/services';
import { useAccounts } from '../../src/state/session';
import { describeError } from '../../src/lib/errors';
import { num, signed } from '../../src/lib/home';
import {
  buildMonthBars,
  buildRows,
  favoriteSummaries,
  hasFolders,
  PERIODS,
  periodMonths,
  previousTotal,
  selectForms,
  totalFor,
  type FormAnalytics,
  type GroupBy,
  type Period,
} from '../../src/lib/form-analytics';
import { MIN_TAP, useColors } from '../../src/theme/theme';

/**
 * フォーム分析。上から、期間(今月・先月・3か月・1年・全期間) → 回答数の合計(前の期間との差つき) → 月別の棒グラフ(12か月) → フォーム別(フォルダがあればフォルダ別も)の一覧。
 * 一覧の行を押すと、合計と棒グラフがそのフォーム(フォルダ)だけに絞られる。もう一度押すと全体に戻る。
 * サーバーからは「フォーム×月の回答数」だけを取り、足し合わせは端末で行う(切り替えてもサーバーを呼ばない)。
 */
function FormAnalyticsScreen() {
  const c = useColors();
  const { selected } = useAccounts();
  const accountId = selected?.id ?? null;
  const [data, setData] = useState<FormAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<Period>('thisMonth');
  const [groupBy, setGroupBy] = useState<GroupBy>('form');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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
        const next = await api.getFormAnalytics(accountId, mode === 'refresh');
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
    const forms = selectForms(data, groupBy, selectedKey);
    const months = periodMonths(data.currentMonth, period);
    return {
      rows: buildRows(data, period, groupBy),
      total: totalFor(forms, data.currentMonth, period),
      previous: previousTotal(forms, data.currentMonth, period),
      bars: buildMonthBars(forms, data.currentMonth),
      favorites: favoriteSummaries(data, period, forms),
      inPeriod: (month: string) => (months ? months.includes(month) : true),
    };
  }, [data, period, groupBy, selectedKey]);

  if (!accountId) return <ErrorView message="公式アカウントが選ばれていません" onRetry={() => undefined} />;
  if (loading && !data) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={() => void load('initial')} />;
  if (!data || !view) return null;
  if (data.forms.length === 0) return <EmptyView title="フォームの回答はまだありません" />;

  const selectedRow = selectedKey ? view.rows.find((r) => r.key === selectedKey) : undefined;
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

        <Card>
          {selectedRow ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${selectedRow.label}の絞り込みを解除`} onPress={() => setSelectedKey(null)} style={[styles.selected, { backgroundColor: c.inputBackground }]}>
              <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{selectedRow.label}</Text>
              <Ionicons name="close-circle" size={16} color={c.textMuted} />
            </Pressable>
          ) : null}
          <Text style={{ color: c.textMuted, fontSize: 12 }}>回答数</Text>
          <View style={styles.totalRow}>
            <Text style={{ color: c.text, fontSize: 36, fontWeight: '600' }}>{num(view.total)}<Text style={{ fontSize: 15, fontWeight: '400' }}>件</Text></Text>
            {diff !== null ? (
              <Text style={{ color: diff > 0 ? c.primaryText : diff < 0 ? c.danger : c.textMuted, fontSize: 14, fontWeight: '600' }}>
                {diff === 0 ? '±0' : signed(diff)}
              </Text>
            ) : null}
          </View>

          <View style={[styles.bars, { height: BAR_H + 16 }]} accessibilityLabel="月別の回答数の棒グラフ">
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
        </Card>

        <View style={styles.listHead}>
          <SectionTitle>{groupBy === 'form' ? 'フォーム別' : 'フォルダ別'}</SectionTitle>
          {hasFolders(data) ? (
            <View style={styles.chips}>
              <Chip label="フォーム" active={groupBy === 'form'} onPress={() => { setGroupBy('form'); setSelectedKey(null); }} />
              <Chip label="フォルダ" active={groupBy === 'folder'} onPress={() => { setGroupBy('folder'); setSelectedKey(null); }} />
            </View>
          ) : null}
        </View>

        <Card style={{ paddingVertical: 4 }}>
          {view.rows.map((r, i) => {
            const active = r.key === selectedKey;
            return (
              <Pressable
                key={r.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${r.label} ${r.count}件`}
                onPress={() => setSelectedKey(active ? null : r.key)}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null,
                  { backgroundColor: active ? c.inputBackground : pressed ? c.inputBackground : 'transparent' },
                ]}
              >
                <View style={styles.rowTop}>
                  <Text style={{ color: c.text, fontSize: 14, fontWeight: active ? '700' : '500', flex: 1 }} numberOfLines={2}>{r.label}</Text>
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{num(r.count)}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: c.border }]}>
                  <View style={[styles.fill, { width: `${(r.count / maxRow) * 100}%`, backgroundColor: c.primary }]} />
                </View>
              </Pressable>
            );
          })}
        </Card>

        {view.favorites.length > 0 ? (
          <>
            <View style={styles.listHead}>
              <SectionTitle>お気に入りの項目</SectionTitle>
            </View>
            {view.favorites.map((fav) => (
              <Card key={`${fav.field.formId}:${fav.field.fieldName}`} style={{ gap: 10 }}>
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{fav.field.label}</Text>
                    <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{fav.field.formName}</Text>
                  </View>
                  <Text style={{ color: c.textMuted, fontSize: 13 }}>回答 {num(fav.answered)}件</Text>
                </View>
                {fav.rows.map((r) => (
                  <View key={r.value} style={{ gap: 4 }} accessibilityLabel={`${r.value} ${r.count}件 ${r.percent}%`}>
                    <View style={styles.rowTop}>
                      <Text style={{ color: c.text, fontSize: 14, flex: 1 }} numberOfLines={2}>{r.value}</Text>
                      <Text style={{ color: c.textMuted, fontSize: 13 }}>{num(r.count)}件</Text>
                      <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', minWidth: 44, textAlign: 'right' }}>{r.percent}%</Text>
                    </View>
                    <View style={[styles.track, { backgroundColor: c.border }]}>
                      <View style={[styles.fill, { width: `${r.percent}%`, backgroundColor: c.primary }]} />
                    </View>
                  </View>
                ))}
              </Card>
            ))}
          </>
        ) : null}
      </ScrollView>
    </FadeIn>
  );
}

export default withReadableWidth(FormAnalyticsScreen);

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
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  row: { paddingHorizontal: 12, paddingVertical: 10, gap: 6, minHeight: MIN_TAP },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
