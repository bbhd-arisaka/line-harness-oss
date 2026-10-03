import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../../src/state/services';
import { useLoader } from '../../../src/state/hooks';
import { Avatar, Button, Card, ErrorView, LoadingView, SectionTitle } from '../../../src/components/ui';
import { buildInfoRows, describeRichMenu, formatDateTime, resolveFriendName } from '../../../src/lib/format';
import type { Tag } from '../../../src/lib/types';
import { useColors } from '../../../src/theme/theme';

function tagColor(color: string | undefined, fallback: string): string {
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <Text style={{ color: c.textMuted, fontSize: 12 }}>{label}</Text>
      <Text selectable style={{ color: value ? c.text : c.textMuted, fontSize: 15, marginTop: 2 }}>
        {value || '未設定'}
      </Text>
    </View>
  );
}

function TagChip({ tag }: { tag: Tag }) {
  const c = useColors();
  const color = tagColor(tag.color, c.primary);
  return (
    <View style={[styles.tag, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
      <View style={[styles.tagDot, { backgroundColor: color }]} />
      <Text style={{ color: c.text, fontSize: 13 }}>{tag.name}</Text>
    </View>
  );
}

export default function FriendDetailScreen() {
  const c = useColors();
  const router = useRouter();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const [menuImageFailed, setMenuImageFailed] = useState(false);

  const friend = useLoader(() => api.getFriend(id), [id]);
  // 友だち情報欄の定義・リッチメニューは、取れなくても詳細そのものは見せる(個別に状態を持つ)
  const defs = useLoader(() => api.listFriendFieldDefinitions(), []);
  const menu = useLoader(() => api.getFriendRichMenu(id), [id]);

  const f = friend.data;
  const infoRows = useMemo(() => (f ? buildInfoRows(f.metadata, defs.data ?? []) : []), [f, defs.data]);
  const menuView = menu.data ? describeRichMenu(menu.data) : null;
  const menuImage = menu.data?.id && menu.data.accountId && !menuImageFailed ? api.richMenuImageUrl(menu.data.id, menu.data.accountId) : null;

  async function refreshAll() {
    setMenuImageFailed(false);
    await Promise.all([friend.refresh(), defs.refresh(), menu.refresh()]);
  }

  if (friend.loading) return <LoadingView />;
  if (friend.error && !f) return <ErrorView message={friend.error} onRetry={() => void friend.reload()} />;
  if (!f) return null;

  const name = resolveFriendName(f);
  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={friend.refreshing} onRefresh={() => void refreshAll()} tintColor={c.primary} />}
    >
      <Stack.Screen options={{ title: name }} />

      <View style={styles.header}>
        <Avatar uri={f.pictureUrl} name={name} size={80} />
        <Text style={[styles.title, { color: c.text }]}>{name}</Text>
        {f.statusMessage ? <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 4, textAlign: 'center' }}>{f.statusMessage}</Text> : null}
        {!f.isFollowing ? <Text style={{ color: c.danger, fontSize: 13, marginTop: 6, fontWeight: '700' }}>ブロック中(メッセージは届きません)</Text> : null}
      </View>

      {from !== 'chat' ? (
        <Button title="トークを開く" onPress={() => router.push({ pathname: '/chat/[id]', params: { id: f.id } })} style={{ marginTop: 16 }} />
      ) : null}

      <SectionTitle>名前</SectionTitle>
      <Card>
        <Field label="本名" value={f.realName?.trim()} />
        <Field label="システム表示名" value={f.systemDisplayName?.trim()} />
        <Field label="LINE名" value={f.displayName} />
      </Card>

      <SectionTitle>メモ</SectionTitle>
      <Card>
        <Text selectable style={{ color: f.memo?.trim() ? c.text : c.textMuted, fontSize: 15, lineHeight: 22 }}>
          {f.memo?.trim() || 'メモはありません'}
        </Text>
      </Card>

      <SectionTitle>タグ</SectionTitle>
      <Card>
        {f.tags.length > 0 ? (
          <View style={styles.tags}>
            {f.tags.map((t) => (
              <TagChip key={t.id} tag={t} />
            ))}
          </View>
        ) : (
          <Text style={{ color: c.textMuted, fontSize: 15 }}>タグはありません</Text>
        )}
      </Card>

      <SectionTitle>友だち情報</SectionTitle>
      <Card>
        {defs.loading ? (
          <ActivityIndicator color={c.primary} />
        ) : defs.error ? (
          <View>
            <Text style={{ color: c.danger, fontSize: 13 }}>{defs.error}</Text>
            <Button title="再取得" variant="secondary" onPress={() => void defs.reload()} style={{ marginTop: 10 }} />
          </View>
        ) : infoRows.length > 0 ? (
          infoRows.map((r) => <Field key={r.key} label={r.label} value={r.value} />)
        ) : (
          <Text style={{ color: c.textMuted, fontSize: 15 }}>入力されている項目はありません</Text>
        )}
      </Card>

      <SectionTitle>いま設定されているリッチメニュー</SectionTitle>
      <Card>
        {menu.loading ? (
          <Text style={{ color: c.textMuted, fontSize: 14 }}>読み込み中…</Text>
        ) : menu.error || !menuView ? (
          <View>
            <Text style={{ color: c.danger, fontSize: 13 }}>取得に失敗しました{menu.error ? `(${menu.error})` : ''}</Text>
            <Button title="再取得" variant="secondary" onPress={() => void menu.reload()} style={{ marginTop: 10 }} />
          </View>
        ) : menuView.state === 'none' ? (
          <Text style={{ color: c.textMuted, fontSize: 15 }}>{menuView.title}</Text>
        ) : (
          <View>
            <View style={styles.menuTitleRow}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }}>{menuView.title}</Text>
              <View style={[styles.badge, { backgroundColor: menuView.badge === '個別に設定' ? c.primarySoft : c.inputBackground }]}>
                <Text style={{ color: menuView.badge === '個別に設定' ? c.primaryText : c.textMuted, fontSize: 11, fontWeight: '700' }}>{menuView.badge}</Text>
              </View>
            </View>
            {menuView.details.map((d) => (
              <Text key={d} style={{ color: c.textMuted, fontSize: 13, marginTop: 4 }}>
                {d}
              </Text>
            ))}
            {menuImage ? (
              <Image
                source={{ uri: menuImage }}
                style={[styles.menuImage, { borderColor: c.border }]}
                resizeMode="contain"
                onError={() => setMenuImageFailed(true)}
                accessibilityLabel="リッチメニューの画像"
                accessibilityIgnoresInvertColors
              />
            ) : null}
          </View>
        )}
      </Card>

      <SectionTitle>その他</SectionTitle>
      <Card>
        <Field label="友だち追加日" value={formatDateTime(f.createdAt)} />
        <Field label="流入経路(ref)" value={f.refCode} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  header: { alignItems: 'center', paddingTop: 8 },
  title: { fontSize: 22, fontWeight: '800', marginTop: 12, textAlign: 'center' },
  field: { paddingVertical: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  tagDot: { width: 8, height: 8, borderRadius: 4 },
  menuTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  menuImage: { width: '100%', height: 160, marginTop: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
});
