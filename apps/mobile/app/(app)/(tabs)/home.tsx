import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AccountBar } from '../../../src/components/account-bar';
import { Avatar, Card, ErrorView, LoadingView, SectionTitle } from '../../../src/components/ui';
import { FadeIn } from '../../../src/components/fade-in';
import { withReadableWidth } from '../../../src/components/readable-width';
import { api } from '../../../src/state/services';
import { useAccounts, useAuth } from '../../../src/state/session';
import { alertRoute, barRatios, minutesLabel, monthDay, num, signed, splitAlerts, waitLabel, type ChatFilterParam, type HomeAlert, type HomeSummary, type WaitingChat } from '../../../src/lib/home';
import { formatListTime } from '../../../src/lib/format';
import { describeError } from '../../../src/lib/errors';
import { MIN_TAP, useColors } from '../../../src/theme/theme';

/**
 * ホーム(現場向け)。上から、急ぎのお知らせ → 返信待ちのお客様(待たせている時間が長い順・押すとトークへ) → 対応中・対応済み →
 * 今日の動き → 新しいフォームの回答 → ショートカット。友だち数・送信可能数・推移・流入経路などの「数字」は、いちばん下に畳んである。
 * 業種は問わない(サロンに限らない)ので、言葉は「お客様」「返信」「回答」を使う。
 * 取りに行くのは、開いたとき・アカウントを変えたとき・引っぱって更新したとき・1分以上たって戻ってきたときだけ(定期的には取らない)。
 */
function HomeScreen() {
  const c = useColors();
  const router = useRouter();
  const { selected } = useAccounts();
  const accountId = selected?.id ?? null;
  const staff = useAuth().staff;
  const canBroadcast = staff?.role === 'owner' || staff?.role === 'admin';
  const [showNumbers, setShowNumbers] = useState(false);
  const [data, setData] = useState<HomeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadedAt = useRef(0);
  const seq = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (!accountId) return;
      const mine = ++seq.current;
      if (mode === 'initial') {
        setLoading(true);
        setData(null);
      }
      if (mode !== 'silent') setError(null);
      try {
        const next = await api.getHome(accountId, mode === 'refresh');
        if (mine !== seq.current) return;
        setData(next);
        loadedAt.current = Date.now();
      } catch (e) {
        if (mine !== seq.current) return;
        if (mode !== 'silent') setError(describeError(e, '読み込めませんでした'));
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

  // 他の画面から戻ったとき、1分以上たっていれば取り直す
  useFocusEffect(
    useCallback(() => {
      if (loadedAt.current > 0 && Date.now() - loadedAt.current > 60_000) void load('silent');
    }, [load]),
  );

  const openChats = (filter: ChatFilterParam) => router.navigate({ pathname: '/', params: { filter, t: String(Date.now()) } });
  const openAlert = (a: HomeAlert) => {
    const r = alertRoute(a);
    if (!r) return;
    if (r.kind === 'chats') openChats(r.filter);
    // タブの画面。型の一覧に、まだ載っていない(自動生成のため)ので、文字として渡す
    else router.navigate((r.name === 'broadcasts' ? '/broadcasts' : '/friends') as never);
  };

  if (!accountId) return <ErrorView message="公式アカウントが選ばれていません" onRetry={() => undefined} />;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AccountBar />
      {loading && !data ? (
        <LoadingView />
      ) : error && !data ? (
        <ErrorView message={error} onRetry={() => void load('initial')} />
      ) : data ? (
        <FadeIn key={data.accountId}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load('refresh'); }} tintColor={c.primary} />}
        >
          {splitAlerts(data.alerts).field.length > 0 ? <AlertsCard alerts={splitAlerts(data.alerts).field} onOpen={openAlert} /> : null}

          <WaitingCard
            count={data.chatStatus.unread}
            waiting={data.waiting ?? []}
            nowMs={Date.now()}
            onOpen={(id) => router.push({ pathname: '/chat/[id]', params: { id } })}
            onAll={() => openChats('unread')}
          />

          <View style={styles.tiles}>
            <StatusTile label="対応中" value={data.chatStatus.in_progress} dot={c.warning} onPress={() => openChats('in_progress')} />
            <StatusTile label="対応済み" value={data.chatStatus.resolved} dot={c.primary} onPress={() => openChats('resolved')} />
          </View>

          {data.today ? (
            <>
              <SectionTitle>今日</SectionTitle>
              <View style={styles.grid}>
                <Stat title="お客様からの受信" value={`${num(data.today.received)}件`} />
                <Stat title="こちらからの返信" value={`${num(data.today.replied)}件`} />
                <Stat title="新しいお客様(友だち追加)" value={`${num(data.today.added)}人`} />
                <Stat title="フォームの回答" value={`${num(data.today.formAnswers)}件`} />
              </View>
            </>
          ) : null}

          {data.recentForms && data.recentForms.length > 0 ? (
            <>
              <SectionTitle>新しいフォームの回答</SectionTitle>
              <Card style={{ paddingVertical: 4 }}>
                {data.recentForms.map((f, i) => (
                  <Pressable
                    key={f.submissionId}
                    accessibilityRole="button"
                    accessibilityLabel={`${f.friendName}さんの${f.formName}の回答を開く`}
                    onPress={() => router.push({ pathname: '/form-answer/[submissionId]', params: { submissionId: f.submissionId, chat: f.friendId } })}
                    style={({ pressed }) => [styles.listRow, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{f.friendName}</Text>
                      <Text style={{ color: c.textSub, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{f.formName}</Text>
                    </View>
                    <Text style={{ color: c.textMuted, fontSize: 12 }}>{formatListTime(f.answeredAt)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
                  </Pressable>
                ))}
              </Card>
            </>
          ) : null}

          <View style={styles.shortcuts}>
            <Shortcut icon="qr-code-outline" label="友だち追加QR" onPress={() => router.push('/friend-add')} />
            <Shortcut icon="search-outline" label="お客様を探す" onPress={() => router.navigate('/friends' as never)} />
            {canBroadcast ? <Shortcut icon="megaphone-outline" label="新しい配信" onPress={() => router.push('/broadcast-new')} /> : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="フォーム分析を開く"
            onPress={() => router.push('/form-analytics' as never)}
            style={({ pressed }) => [styles.numbersToggle, { backgroundColor: pressed ? c.inputBackground : c.card, borderColor: c.border }]}
          >
            <Ionicons name="bar-chart-outline" size={20} color={c.primaryText} />
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '600', flex: 1 }}>フォーム分析</Text>
            <Text style={{ color: c.textMuted, fontSize: 12 }}>{`今月 ${num(data.ops.formAnswersThisMonth)}件`}</Text>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showNumbers }}
            onPress={() => setShowNumbers((v) => !v)}
            style={({ pressed }) => [styles.numbersToggle, { backgroundColor: pressed ? c.inputBackground : c.card, borderColor: c.border }]}
          >
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '600', flex: 1 }}>数字を見る</Text>
            <Text style={{ color: c.textMuted, fontSize: 12 }}>友だち数・送信可能数・推移</Text>
            <Ionicons name={showNumbers ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
          </Pressable>

          {showNumbers ? (
            <>
              {splitAlerts(data.alerts).other.length > 0 ? <AlertsCard alerts={splitAlerts(data.alerts).other} onOpen={openAlert} /> : null}

              <SectionTitle>友だち数</SectionTitle>
              <Card>
                <View style={styles.twoCols}>
                  <View style={styles.bigCol}>
                    <Text style={[styles.label, { color: c.textMuted }]}>有効友だち数</Text>
                    <Text style={[styles.big, { color: c.text }]}>{num(data.friends.active)}<Text style={styles.unit}>人</Text></Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: c.border }]} />
                  <View style={styles.bigCol}>
                    <Text style={[styles.label, { color: c.textMuted }]}>ブロック数</Text>
                    <Text style={[styles.big, { color: c.text }]}>{num(data.friends.blocked)}<Text style={styles.unit}>人</Text></Text>
                  </View>
                </View>
                <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'center', marginTop: 8 }}>
                  友だち総数 {num(data.friends.total)}{data.ops.blockRatePct !== null ? `　ブロック率 ${data.ops.blockRatePct}%` : ''}
                </Text>
              </Card>

              <SectionTitle>{`${Number(data.generatedAt.slice(5, 7))}月の送信可能数`}</SectionTitle>
              <QuotaCard quota={data.quota} />

              <SectionTitle>友だち数の推移(14日)</SectionTitle>
              <Card>
                <TrendBars rows={data.trend} />
                <TrendTable rows={[...data.trend].reverse().slice(0, 7)} />
              </Card>

              <SectionTitle>今月の指標</SectionTitle>
              <View style={styles.grid}>
                <Stat title="返信までの平均時間(7日)" value={data.ops.avgFirstReplyMinutes !== null ? minutesLabel(data.ops.avgFirstReplyMinutes) : '—'} />
                <Stat title="受信メッセージ" value={`${num(data.ops.receivedThisMonth)}件`} />
                <Stat title="フォーム回答" value={`${num(data.ops.formAnswersThisMonth)}件`} />
                <Stat title="新しい友だち" value={`${num(data.ops.addedThisMonth)}人`} />
                <Stat title="ブロック" value={`${num(data.ops.blockedThisMonth)}人`} />
                <Stat title="送信数" value={`${num(data.sentThisMonth)}通`} />
              </View>

              {data.routes.length > 0 ? (
                <>
                  <SectionTitle>流入経路(今月の新しい友だち)</SectionTitle>
                  <Card>
                    {data.routes.map((r, i) => {
                      const max = Math.max(1, ...data.routes.map((x) => x.count));
                      return (
                        <View key={r.key} style={{ marginTop: i === 0 ? 0 : 10 }}>
                          <View style={styles.routeTop}>
                            <Text style={{ color: c.text, fontSize: 14, flex: 1 }} numberOfLines={1}>{r.label}</Text>
                            <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>{num(r.count)}</Text>
                          </View>
                          <View style={[styles.track, { backgroundColor: c.border }]}>
                            <View style={[styles.fill, { width: `${(r.count / max) * 100}%`, backgroundColor: c.primary }]} />
                          </View>
                        </View>
                      );
                    })}
                  </Card>
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
        </FadeIn>
      ) : null}
    </View>
  );
}

export default withReadableWidth(HomeScreen);

/** 返信待ち: 件数と、待たせている時間が長い順のお客様(押すとそのトークへ) */
function WaitingCard({ count, waiting, nowMs, onOpen, onAll }: { count: number; waiting: WaitingChat[]; nowMs: number; onOpen: (friendId: string) => void; onAll: () => void }) {
  const c = useColors();
  if (count === 0) {
    return (
      <View style={[styles.okRow, { backgroundColor: c.inputBackground }]}>
        <Ionicons name="checkmark-circle" size={22} color={c.primary} />
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>返信待ちのお客様はいません</Text>
      </View>
    );
  }
  const levelColor = { ok: c.textSub, warn: c.warning, late: c.danger } as const;
  const rest = Math.max(0, count - waiting.length);
  return (
    <Card style={{ paddingVertical: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`返信待ち ${count}人。トーク一覧を開く`} onPress={onAll} style={styles.waitHead}>
        <View style={[styles.dot, { backgroundColor: c.danger }]} />
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', flex: 1 }}>返信待ち</Text>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>{num(count)}<Text style={{ fontSize: 13, fontWeight: '400' }}>人</Text></Text>
      </Pressable>
      {waiting.map((w) => {
        const wait = waitLabel(w.since, nowMs);
        return (
          <Pressable
            key={w.friendId}
            accessibilityRole="button"
            accessibilityLabel={`${w.name}さん ${wait.text}。トークを開く`}
            onPress={() => onOpen(w.friendId)}
            style={({ pressed }) => [styles.listRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, opacity: pressed ? 0.6 : 1 }]}
          >
            <Avatar uri={w.pictureUrl} name={w.name} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{w.name}</Text>
              {w.preview ? <Text style={{ color: c.textSub, fontSize: 13, marginTop: 1 }} numberOfLines={1}>{w.preview}</Text> : null}
            </View>
            <Text style={{ color: levelColor[wait.level], fontSize: 13, fontWeight: wait.level === 'ok' ? '400' : '700' }}>{wait.text}</Text>
          </Pressable>
        );
      })}
      {rest > 0 ? (
        <Pressable onPress={onAll} accessibilityRole="button" style={[styles.listRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, justifyContent: 'center' }]}>
          <Text style={{ color: c.primaryText, fontSize: 14, fontWeight: '600' }}>ほか{num(rest)}人を見る</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function Shortcut({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.shortcut, { backgroundColor: pressed ? c.inputBackground : c.card, borderColor: c.border }]}
    >
      <Ionicons name={icon} size={24} color={c.primaryText} />
      <Text style={{ color: c.text, fontSize: 12, fontWeight: '600', marginTop: 4, textAlign: 'center' }} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

/** 押せる部品は、ボタンの見た目(白地・細い枠・右の「›」)。色は小さな点だけで、控えめにする */
function StatusTile({ label, value, dot, onPress }: { label: string; value: number; dot: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}人。トーク一覧を開く`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? c.inputBackground : c.card, borderColor: c.border }]}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.tileLabel}>
          <View style={[styles.dot, { backgroundColor: dot }]} />
          <Text style={{ color: c.textSub, fontSize: 12 }}>{label}</Text>
        </View>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '600', marginTop: 2 }}>{num(value)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
    </Pressable>
  );
}

function AlertsCard({ alerts, onOpen }: { alerts: HomeAlert[]; onOpen: (a: HomeAlert) => void }) {
  const c = useColors();
  if (alerts.length === 0) {
    return (
      <View style={[styles.okRow, { backgroundColor: c.inputBackground }]}>
        <Ionicons name="checkmark-circle" size={20} color={c.primary} />
        <Text style={{ color: c.textSub, fontSize: 14 }}>お知らせはありません</Text>
      </View>
    );
  }
  const dotColor = { critical: c.danger, warning: c.warning, info: c.textMuted } as const;
  return (
    <View style={{ gap: 8 }}>
      {alerts.map((a) => {
        const tappable = alertRoute(a) !== null;
        // 押せるお知らせは、ボタンの見た目(白地・枠・右の「›」)。押せないものは、枠のない平らな行
        return (
          <Pressable
            key={a.id}
            disabled={!tappable}
            accessibilityRole={tappable ? 'button' : 'text'}
            onPress={() => onOpen(a)}
            style={({ pressed }) => [
              styles.alert,
              tappable ? { backgroundColor: pressed ? c.inputBackground : c.card, borderColor: c.border, borderWidth: 1 } : { backgroundColor: c.inputBackground },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: dotColor[a.severity] }]} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 14, fontWeight: '500' }}>{a.title}</Text>
              {a.detail ? <Text style={{ color: c.textSub, fontSize: 12, marginTop: 1 }}>{a.detail}</Text> : null}
            </View>
            {tappable ? <Ionicons name="chevron-forward" size={16} color={c.textMuted} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function QuotaCard({ quota }: { quota: HomeSummary['quota'] }) {
  const c = useColors();
  if (quota === null) {
    return (
      <Card>
        <Text style={{ color: c.danger, fontSize: 14 }}>取得できませんでした。引っぱって更新してください</Text>
      </Card>
    );
  }
  if (quota.type === 'none') {
    return (
      <Card>
        <Text style={[styles.big, { color: c.text, textAlign: 'center' }]}>∞</Text>
        <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'center' }}>上限なし{quota.consumption !== null ? ` ・ 今月 ${num(quota.consumption)}通` : ''}</Text>
      </Card>
    );
  }
  const ratio = quota.limit && quota.consumption !== null ? Math.min(1, quota.consumption / quota.limit) : 0;
  return (
    <Card>
      <Text style={[styles.label, { color: c.textMuted }]}>残り</Text>
      <Text style={[styles.big, { color: quota.remaining === 0 ? c.danger : c.text }]}>{quota.remaining !== null ? num(quota.remaining) : '—'}<Text style={styles.unit}>通</Text></Text>
      {quota.limit ? (
        <>
          <View style={[styles.track, { backgroundColor: c.border, marginTop: 8 }]}>
            <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: c.primary }]} />
          </View>
          <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4 }}>消費 {num(quota.consumption ?? 0)} / 上限 {num(quota.limit)}</Text>
        </>
      ) : null}
    </Card>
  );
}

/** 登録(上・緑)とブロック(下・赤)の棒グラフ。日付は、最初・まんなか・最後だけ */
function TrendBars({ rows }: { rows: HomeSummary['trend'] }) {
  const c = useColors();
  const ratios = barRatios(rows);
  const HALF = 44;
  return (
    <View>
      <View style={[styles.bars, { height: HALF * 2 }]} accessibilityLabel="友だち数の推移の棒グラフ(上が登録、下がブロック)">
        <View style={[styles.axis, { top: HALF, backgroundColor: c.border }]} />
        {rows.map((r, i) => (
          <View key={r.date} style={styles.barCol}>
            <View style={{ height: HALF, justifyContent: 'flex-end' }}>
              <View style={{ height: Math.max(ratios[i].up > 0 ? 2 : 0, ratios[i].up * HALF), backgroundColor: c.primary, borderRadius: 2 }} />
            </View>
            <View style={{ height: HALF }}>
              <View style={{ height: Math.max(ratios[i].down > 0 ? 2 : 0, ratios[i].down * HALF), backgroundColor: c.danger, borderRadius: 2 }} />
            </View>
          </View>
        ))}
      </View>
      <View style={styles.barLabels}>
        <Text style={{ color: c.textMuted, fontSize: 11 }}>{monthDay(rows[0].date)}</Text>
        <Text style={{ color: c.textMuted, fontSize: 11 }}>{monthDay(rows[Math.floor(rows.length / 2)].date)}</Text>
        <Text style={{ color: c.textMuted, fontSize: 11 }}>{monthDay(rows[rows.length - 1].date)}</Text>
      </View>
      <View style={styles.legend}>
        <Legend color={c.primary} label="登録" />
        <Legend color={c.danger} label="ブロック" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ color: c.textMuted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function TrendTable({ rows }: { rows: HomeSummary['trend'] }) {
  const c = useColors();
  const cols = { date: 1.1, delta: 0.9, add: 0.9, blk: 0.9, act: 1.2 };
  const Cell = ({ w, children, bold, color, left }: { w: number; children: string; bold?: boolean; color?: string; left?: boolean }) => (
    <Text style={{ flex: w, textAlign: left ? 'left' : 'right', color: color ?? c.text, fontSize: 13, fontWeight: bold ? '700' : '400', fontVariant: ['tabular-nums'] }}>{children}</Text>
  );
  return (
    <View style={{ marginTop: 12 }}>
      <View style={[styles.tr, { borderBottomColor: c.border }]}>
        <Cell w={cols.date} left color={c.textMuted}>日付</Cell>
        <Cell w={cols.delta} color={c.textMuted}>前日比</Cell>
        <Cell w={cols.add} color={c.textMuted}>登録</Cell>
        <Cell w={cols.blk} color={c.textMuted}>ブロック</Cell>
        <Cell w={cols.act} color={c.textMuted}>有効友だち</Cell>
      </View>
      {rows.map((r) => (
        <View key={r.date} style={[styles.tr, { borderBottomColor: c.border }]}>
          <Cell w={cols.date} left>{monthDay(r.date)}</Cell>
          <Cell w={cols.delta} color={r.delta > 0 ? c.primaryText : r.delta < 0 ? c.danger : c.textMuted}>{signed(r.delta)}</Cell>
          <Cell w={cols.add}>{num(r.added)}</Cell>
          <Cell w={cols.blk}>{num(r.blocked)}</Cell>
          <Cell w={cols.act} bold>{num(r.active)}</Cell>
        </View>
      ))}
    </View>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={{ color: c.textMuted, fontSize: 11 }} numberOfLines={2}>{title}</Text>
      <Text style={{ color: c.text, fontSize: 18, fontWeight: '600', marginTop: 4 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 8 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, minHeight: MIN_TAP + 12, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12, paddingRight: 8, paddingVertical: 10 },
  tileLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  twoCols: { flexDirection: 'row', alignItems: 'center' },
  bigCol: { flex: 1, alignItems: 'center' },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  label: { fontSize: 12 },
  big: { fontSize: 30, fontWeight: '600', marginTop: 2 },
  unit: { fontSize: 14, fontWeight: '400' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  bars: { flexDirection: 'row', alignItems: 'flex-start', gap: 3 },
  axis: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  barCol: { flex: 1 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  legend: { flexDirection: 'row', gap: 12, marginTop: 6 },
  tr: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48.5%', borderWidth: 1, borderRadius: 12, padding: 12 },
  routeTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  waitHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TAP, paddingHorizontal: 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TAP + 8, paddingHorizontal: 12, paddingVertical: 8 },
  shortcuts: { flexDirection: 'row', gap: 8, marginTop: 8 },
  shortcut: { flex: 1, minHeight: 72, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 10 },
  numbersToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TAP, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, marginTop: 12 },
});
