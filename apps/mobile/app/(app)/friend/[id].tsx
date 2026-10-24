import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../src/state/services';
import { useLoader } from '../../../src/state/hooks';
import { Avatar, Button, Card, ErrorView, LoadingView, SectionTitle } from '../../../src/components/ui';
import { MessageText } from '../../../src/components/message-text';
import { endActiveSelection } from '../../../src/state/text-selection';
import { PickModal } from '../../../src/components/pick-modal';
import type { InflowRoute } from '../../../src/lib/inflow';
import { describeRichMenu, formatDateTime, resolveFriendName } from '../../../src/lib/format';
import { buildInfoGroups } from '../../../src/lib/friend-fields';
import { describeError } from '../../../src/lib/errors';
import { charLength, draftFromFriend, NAME_MAX_LENGTH, planProfileUpdate, type ProfileDraft } from '../../../src/lib/profile';
import type { Tag } from '../../../src/lib/types';
import { MIN_TAP, useColors } from '../../../src/theme/theme';
import { withReadableWidth } from '../../../src/components/readable-width';
import { fs } from '../../../src/theme/scale';

function tagColor(color: string | undefined, fallback: string): string {
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <Text style={{ color: c.textMuted, fontSize: fs(12) }}>{label}</Text>
      <MessageText text={value || '未設定'} style={{ color: value ? c.text : c.textMuted, fontSize: fs(15), marginTop: 2 }} />
    </View>
  );
}

function EditField({
  label,
  hint,
  value,
  onChangeText,
  editable,
  multiline = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (v: string) => void;
  editable: boolean;
  multiline?: boolean;
}) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <View style={styles.editLabelRow}>
        <Text style={{ color: c.textMuted, fontSize: fs(12) }}>{label}</Text>
        {hint ? <Text style={{ color: c.textMuted, fontSize: fs(12) }}>{hint}</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        multiline={multiline}
        accessibilityLabel={label}
        placeholder="未設定"
        placeholderTextColor={c.textMuted}
        autoCorrect={false}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { backgroundColor: c.inputBackground, color: c.text, opacity: editable ? 1 : 0.6 },
        ]}
      />
    </View>
  );
}

function TagChip({ tag }: { tag: Tag }) {
  const c = useColors();
  const color = tagColor(tag.color, c.primary);
  return (
    <View style={[styles.tag, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
      <View style={[styles.tagDot, { backgroundColor: color }]} />
      <Text style={{ color: c.text, fontSize: fs(13) }}>{tag.name}</Text>
    </View>
  );
}

function FriendDetailScreen() {
  const c = useColors();
  const router = useRouter();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const [menuImageFailed, setMenuImageFailed] = useState(false);
  // 本名・システム表示名・個別メモの編集
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  // 流入経路(つけ外し)。編集を始めたときに、この友だちの公式アカウントの流入経路を読み込む
  const [routeDraft, setRouteDraft] = useState<string | null>(null);
  const [routes, setRoutes] = useState<InflowRoute[]>([]);
  const [routePicker, setRoutePicker] = useState(false);

  const friend = useLoader(() => api.getFriend(id), [id]);
  // 友だち情報欄の定義・リッチメニューは、取れなくても詳細そのものは見せる(個別に状態を持つ)
  const defs = useLoader(() => api.listFriendFieldDefinitions(), []);
  const folders = useLoader(() => api.listFriendFieldFolders(), []);
  const menu = useLoader(() => api.getFriendRichMenu(id), [id]);

  const f = friend.data;
  const infoGroups = useMemo(() => (f ? buildInfoGroups(f.metadata, defs.data ?? [], folders.data ?? []) : []), [f, defs.data, folders.data]);
  // 友だち情報の編集画面から戻ったとき、値を取り直す(最初の表示では取り直さない)
  // (refresh は描画のたびに新しい関数になるので、そのまま依存にすると、取り直すたびにまた取り直す無限ループになる。最新のものを ref で持つ)
  const focused = useRef(false);
  const refreshRef = useRef(friend.refresh);
  useEffect(() => {
    refreshRef.current = friend.refresh;
  });
  useFocusEffect(
    useCallback(() => {
      if (focused.current) void refreshRef.current();
      focused.current = true;
    }, []),
  );
  const menuView = menu.data ? describeRichMenu(menu.data) : null;
  const menuImage = menu.data?.id && menu.data.accountId && !menuImageFailed ? api.richMenuImageUrl(menu.data.id, menu.data.accountId) : null;

  async function saveProfile() {
    if (!f || !draft || saving) return;
    const plan = planProfileUpdate(f, draft);
    if (!plan.ok) {
      setSaveError(plan.error);
      return;
    }
    const routeChanged = routeDraft !== (f.inflowRoute?.id ?? null);
    if (!plan.changed && !routeChanged) {
      setDraft(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (plan.changed) {
        const updated = await api.updateFriendProfile(f.id, plan.input);
        // 返ってきた最新の友だちで画面を置き換える(名前の表示も変わる)
        friend.setData({ ...updated, inflowRoute: f.inflowRoute });
      }
      if (routeChanged) {
        await api.setFriendInflowRoute(f.id, routeDraft);
        await friend.refresh();
      }
      setDraft(null);
      setSavedNotice(true);
    } catch (e) {
      // 入力は消さない。理由を出して、もう一度保存できるようにする
      setSaveError(describeError(e, '保存できませんでした'));
    } finally {
      setSaving(false);
    }
  }

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
      // 範囲選択中に、ほかの場所をタップ・スクロールし始めたら、選択をやめる
      onStartShouldSetResponderCapture={(e) => {
        endActiveSelection((e.nativeEvent as { target?: unknown }).target as number | undefined);
        return false;
      }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      refreshControl={<RefreshControl refreshing={friend.refreshing} onRefresh={() => void refreshAll()} tintColor={c.primary} />}
    >
      <Stack.Screen
        options={{
          title: name,
          headerRight: () =>
            draft ? null : (
              <Pressable
                onPress={() => {
                  setSaveError(null);
                  setSavedNotice(false);
                  setDraft(draftFromFriend(f));
                  setRouteDraft(f.inflowRoute?.id ?? null);
                  if (f.lineAccountId) {
                    api
                      .listInflowRoutes(f.lineAccountId)
                      .then((r) => setRoutes(r.items.filter((x) => !x.legacy)))
                      .catch(() => setRoutes([]));
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="名前とメモを編集する"
                style={styles.headerButton}
              >
                <Text style={{ color: c.primaryText, fontSize: fs(16), fontWeight: '700' }}>編集</Text>
              </Pressable>
            ),
        }}
      />

      <View style={styles.header}>
        <Avatar uri={f.pictureUrl} name={name} size={80} />
        <Text style={[styles.title, { color: c.text }]}>{name}</Text>
        {f.statusMessage ? <Text style={{ color: c.textMuted, fontSize: fs(13), marginTop: 4, textAlign: 'center' }}>{f.statusMessage}</Text> : null}
        {!f.isFollowing ? <Text style={{ color: c.danger, fontSize: fs(13), marginTop: 6, fontWeight: '700' }}>ブロック中(メッセージは届きません)</Text> : null}
      </View>

      {from !== 'chat' ? (
        <Button title="トークを開く" onPress={() => router.push({ pathname: '/chat/[id]', params: { id: f.id } })} style={{ marginTop: 16 }} />
      ) : null}

      {savedNotice && !draft ? (
        <View style={[styles.notice, { backgroundColor: c.primarySoft }]} accessibilityRole="alert">
          <Text style={{ color: c.primaryText, fontSize: fs(13), fontWeight: '700' }}>保存しました</Text>
        </View>
      ) : null}

      {draft ? (
        <>
          <SectionTitle>名前</SectionTitle>
          <Card>
            <EditField
              label="本名"
              hint={`${charLength(draft.realName.trim())}/${NAME_MAX_LENGTH}文字`}
              value={draft.realName}
              onChangeText={(v) => setDraft({ ...draft, realName: v })}
              editable={!saving}
            />
            <Field label="LINE名(変更できません)" value={f.displayName} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="流入経路を選ぶ"
              onPress={() => setRoutePicker(true)}
              style={[styles.field, { minHeight: MIN_TAP }]}
            >
              <Text style={{ color: c.textMuted, fontSize: fs(12) }}>流入経路</Text>
              <Text style={{ color: routeDraft ? c.text : c.textMuted, fontSize: fs(15), marginTop: 2, fontWeight: '600' }}>
                {routes.find((r) => r.id === routeDraft)?.name ?? (routeDraft ? (f.inflowRoute?.name ?? '選択中') : 'なし')}
              </Text>
            </Pressable>
          </Card>
          <PickModal
            visible={routePicker}
            title="流入経路"
            items={[{ id: '__none__', label: 'なし' }, ...(f.inflowRoute && !routes.some((r) => r.id === f.inflowRoute!.id) ? [{ id: f.inflowRoute.id, label: f.inflowRoute.name }] : []), ...routes.map((r) => ({ id: r.id, label: r.name }))]}
            onPick={(item) => {
              setRouteDraft(item.id === '__none__' ? null : item.id);
              setRoutePicker(false);
            }}
            onClose={() => setRoutePicker(false)}
          />

          <SectionTitle>メモ</SectionTitle>
          <Card>
            <EditField
              label="個別メモ"
              value={draft.memo}
              onChangeText={(v) => setDraft({ ...draft, memo: v })}
              editable={!saving}
              multiline
            />
          </Card>

          {saveError ? (
            <View style={[styles.notice, { backgroundColor: c.dangerSoft }]} accessibilityRole="alert">
              <Text style={{ color: c.danger, fontSize: fs(13), lineHeight: fs(19) }}>{saveError}</Text>
            </View>
          ) : null}
          <Button title="保存する" onPress={() => void saveProfile()} loading={saving} style={{ marginTop: 16 }} />
          <Button
            title="キャンセル"
            variant="secondary"
            disabled={saving}
            onPress={() => {
              setDraft(null);
              setSaveError(null);
            }}
            style={{ marginTop: 10 }}
          />
        </>
      ) : (
        <>
          <SectionTitle>名前</SectionTitle>
          <Card>
            <Field label="本名" value={f.realName?.trim()} />
            <Field label="LINE名" value={f.displayName} />
          </Card>

          <SectionTitle>メモ</SectionTitle>
          <Card>
            <MessageText text={f.memo?.trim() || 'メモはありません'} style={{ color: f.memo?.trim() ? c.text : c.textMuted, fontSize: fs(15), lineHeight: fs(22) }} />
          </Card>
        </>
      )}

      <SectionTitle>タグ</SectionTitle>
      <Card>
        {f.tags.length > 0 ? (
          <View style={styles.tags}>
            {f.tags.map((t) => (
              <TagChip key={t.id} tag={t} />
            ))}
          </View>
        ) : (
          <Text style={{ color: c.textMuted, fontSize: fs(15) }}>タグはありません</Text>
        )}
      </Card>

      <SectionTitle>友だち情報</SectionTitle>
      {defs.loading || folders.loading ? (
        <Card>
          <ActivityIndicator color={c.primary} />
        </Card>
      ) : defs.error ? (
        <Card>
          <Text style={{ color: c.danger, fontSize: fs(13) }}>{defs.error}</Text>
          <Button title="再取得" variant="secondary" onPress={() => { void defs.reload(); void folders.reload(); }} style={{ marginTop: 10 }} />
        </Card>
      ) : infoGroups.length > 0 ? (
        infoGroups.map((g) => (
          <View key={g.id}>
            <Text style={{ color: c.textMuted, fontSize: fs(13), fontWeight: '700', marginTop: 12, marginBottom: 6, marginLeft: 4 }}>{g.name}</Text>
            <Card style={{ paddingVertical: 4 }}>
              {g.items.map((it, i) => (
                <Pressable
                  key={it.key}
                  disabled={!it.editable}
                  onPress={() => router.push({ pathname: '/friend-field', params: { friendId: f.id, key: it.key } })}
                  accessibilityRole={it.editable ? 'button' : 'text'}
                  accessibilityLabel={`${it.label}${it.editable ? 'を編集' : ''}`}
                  style={({ pressed }) => [
                    styles.infoRow,
                    i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.textMuted, fontSize: fs(12) }}>{it.label}</Text>
                    <MessageText text={it.value || '未入力'} style={{ color: it.value ? c.text : c.textMuted, fontSize: fs(15), marginTop: 2 }} />
                  </View>
                  {it.editable ? <Ionicons name="chevron-forward" size={fs(18)} color={c.textMuted} /> : null}
                </Pressable>
              ))}
            </Card>
          </View>
        ))
      ) : (
        <Card>
          <Text style={{ color: c.textMuted, fontSize: fs(15) }}>友だち情報の項目がありません</Text>
        </Card>
      )}

      <SectionTitle>いま設定されているリッチメニュー</SectionTitle>
      <Card>
        {menu.loading ? (
          <Text style={{ color: c.textMuted, fontSize: fs(14) }}>読み込み中…</Text>
        ) : menu.error || !menuView ? (
          <View>
            <Text style={{ color: c.danger, fontSize: fs(13) }}>取得に失敗しました{menu.error ? `(${menu.error})` : ''}</Text>
            <Button title="再取得" variant="secondary" onPress={() => void menu.reload()} style={{ marginTop: 10 }} />
          </View>
        ) : menuView.state === 'none' ? (
          <Text style={{ color: c.textMuted, fontSize: fs(15) }}>{menuView.title}</Text>
        ) : (
          <View>
            <View style={styles.menuTitleRow}>
              <Text style={{ color: c.text, fontSize: fs(15), fontWeight: '700', flexShrink: 1 }}>{menuView.title}</Text>
              <View style={[styles.badge, { backgroundColor: menuView.badge === '個別に設定' ? c.primarySoft : c.inputBackground }]}>
                <Text style={{ color: menuView.badge === '個別に設定' ? c.primaryText : c.textMuted, fontSize: fs(11), fontWeight: '700' }}>{menuView.badge}</Text>
              </View>
            </View>
            {menuView.details.map((d) => (
              <Text key={d} style={{ color: c.textMuted, fontSize: fs(13), marginTop: 4 }}>
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
        <Field label="流入経路" value={f.inflowRoute?.name ?? null} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  header: { alignItems: 'center', paddingTop: 8 },
  title: { fontSize: fs(22), fontWeight: '800', marginTop: 12, textAlign: 'center' },
  field: { paddingVertical: 6 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 },
  headerButton: { minWidth: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  notice: { marginTop: 16, padding: 12, borderRadius: 10 },
  editLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  input: { minHeight: MIN_TAP, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: fs(16) },
  inputMultiline: { minHeight: 120, textAlignVertical: 'top' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  tagDot: { width: 8, height: 8, borderRadius: 4 },
  menuTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  menuImage: { width: '100%', height: 160, marginTop: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
});

export default withReadableWidth(FriendDetailScreen);
