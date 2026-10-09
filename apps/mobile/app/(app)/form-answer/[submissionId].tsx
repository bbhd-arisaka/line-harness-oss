import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../../src/state/services';
import { Card, ErrorView, LoadingView } from '../../../src/components/ui';
import { withReadableWidth } from '../../../src/components/readable-width';
import { formatDateTime } from '../../../src/lib/format';
import { describeError } from '../../../src/lib/errors';
import type { FormAnswerDetail } from '../../../src/lib/types';
import { MIN_TAP, useColors } from '../../../src/theme/theme';

/** トークの「回答結果を見る」から開く、フォームの回答結果(項目名と回答の一覧) */
function FormAnswerScreen() {
  const c = useColors();
  const { submissionId, chat } = useLocalSearchParams<{ submissionId: string; chat: string }>();
  const [detail, setDetail] = useState<FormAnswerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!submissionId || !chat) {
      setError('回答が指定されていません');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getFormAnswer(chat, submissionId));
    } catch (e) {
      setError(describeError(e, '回答結果を読み込めませんでした'));
    } finally {
      setLoading(false);
    }
  }, [submissionId, chat]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (loading) return <LoadingView />;
  if (error || !detail) return <ErrorView message={error ?? '回答結果を読み込めませんでした'} onRetry={() => void load()} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={styles.content}>
      <Card>
        <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>{detail.formName}</Text>
        <Text style={{ color: c.textSub, fontSize: 13, marginTop: 6 }}>回答者: {detail.friendName}</Text>
        <Text style={{ color: c.textSub, fontSize: 13, marginTop: 2 }}>回答日時: {formatDateTime(detail.answeredAt)}</Text>
      </Card>
      <Card>
        {detail.items.length === 0 ? (
          <Text style={{ color: c.textMuted, fontSize: 14 }}>回答の項目がありません</Text>
        ) : (
          detail.items.map((it, i) => (
            <View key={`${it.label}-${i}`} style={[styles.item, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null]}>
              <Text style={{ color: c.textMuted, fontSize: 12 }}>{it.label}</Text>
              {it.isFile ? (
                <Pressable
                  onPress={() => void Linking.openURL(it.value)}
                  accessibilityRole="link"
                  accessibilityLabel={`${it.label}の添付ファイルを開く`}
                  style={{ minHeight: MIN_TAP, justifyContent: 'center' }}
                >
                  <Text style={{ color: c.primaryText, fontSize: 15, fontWeight: '600' }}>📎 添付ファイルを開く</Text>
                </Pressable>
              ) : (
                <Text selectable style={{ color: c.text, fontSize: 16, lineHeight: 23, marginTop: 2 }}>
                  {it.value}
                </Text>
              )}
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  item: { paddingVertical: 10 },
});

export default withReadableWidth(FormAnswerScreen);
