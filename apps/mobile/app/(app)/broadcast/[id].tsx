import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../../src/state/services';
import { useInterval } from '../../../src/state/hooks';
import { Button, Card, confirmAsync, ErrorView, LoadingView, SectionTitle } from '../../../src/components/ui';
import { withReadableWidth } from '../../../src/components/readable-width';
import { broadcastStatusLabel, describeSavedConditions } from '../../../src/lib/broadcast';
import { formatDateTime } from '../../../src/lib/format';
import { describeError } from '../../../src/lib/errors';
import type { BroadcastItem } from '../../../src/lib/types';
import { useColors } from '../../../src/theme/theme';

/** 一斉配信の詳細: 本文・配信先・状態。配信中は、進み具合を自動で更新する */
function BroadcastDetailScreen() {
  const c = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<BroadcastItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (silent: boolean) => {
      if (!id) return;
      if (!silent) setLoading(true);
      try {
        setItem(await api.getBroadcast(id));
        setError(null);
      } catch (e) {
        if (!silent || !item) setError(describeError(e, '配信を読み込めませんでした'));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  useEffect(() => {
    queueMicrotask(() => void load(false));
  }, [load]);

  // 配信中は、5秒ごとに進み具合を確認する(1件分の軽い確認)
  useInterval(() => void load(true), 5000, item?.status === 'sending');

  async function remove() {
    if (!item) return;
    const ok = await confirmAsync('この配信を削除しますか?', '下書き・予約の配信だけ削除できます。', '削除');
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteBroadcast(item.id);
      router.back();
    } catch (e) {
      setError(describeError(e, '削除できませんでした'));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <LoadingView />;
  if (error || !item) return <ErrorView message={error ?? '読み込めませんでした'} onRetry={() => void load(false)} />;

  const narrowed = describeSavedConditions(item.segmentConditions);
  const percent = item.totalCount > 0 ? Math.min(100, Math.round((item.successCount / item.totalCount) * 100)) : 0;
  const deletable = item.status === 'draft' || item.status === 'scheduled';

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      <Card>
        <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{item.title}</Text>
        <Text style={{ color: item.status === 'sent' ? c.primaryText : c.warning, fontSize: 14, fontWeight: '700', marginTop: 4 }}>
          {broadcastStatusLabel(item.status)}
          {item.status === 'sending' ? '(順番に配信しています。この画面を閉じても続きます)' : ''}
        </Text>
        {item.status === 'sending' || item.status === 'sent' ? (
          <View style={{ marginTop: 10 }}>
            <View style={[styles.bar, { backgroundColor: c.border }]}>
              <View style={[styles.barFill, { width: `${percent}%`, backgroundColor: c.primary }]} />
            </View>
            <Text style={{ color: c.textSub, fontSize: 13, marginTop: 4 }}>
              {item.successCount.toLocaleString('ja-JP')} / {item.totalCount.toLocaleString('ja-JP')}人に配信
            </Text>
          </View>
        ) : null}
        {item.lastError ? <Text style={{ color: c.danger, fontSize: 13, marginTop: 8 }}>{item.lastError}</Text> : null}
      </Card>

      <SectionTitle>送る相手</SectionTitle>
      <Card>
        <Text style={{ color: c.text, fontSize: 15 }}>{narrowed ?? '友だち全員'}</Text>
        <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4 }}>
          {item.sentAt ? `配信日時: ${formatDateTime(item.sentAt)}` : `作成日時: ${formatDateTime(item.createdAt)}`}
        </Text>
      </Card>

      <SectionTitle>メッセージ</SectionTitle>
      <Card>
        <Text selectable style={{ color: c.text, fontSize: 15, lineHeight: 22 }}>
          {item.messageContent}
        </Text>
      </Card>

      {deletable ? <Button title="この配信を削除" variant="danger" loading={deleting} onPress={() => void remove()} style={{ marginTop: 8 }} /> : null}
    </ScrollView>
  );
}

export default withReadableWidth(BroadcastDetailScreen);

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 40 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
});
