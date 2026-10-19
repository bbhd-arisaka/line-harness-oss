import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/state/services';
import { useAccounts } from '../../src/state/session';
import { Button, Card, ErrorView, LoadingView, SectionTitle, confirmAsync } from '../../src/components/ui';
import { PickModal, type PickItem } from '../../src/components/pick-modal';
import { withReadableWidth } from '../../src/components/readable-width';
import { describeError } from '../../src/lib/errors';
import {
  emptyInput,
  formatPeriod,
  joinPeriod,
  otherActions,
  splitPeriod,
  tagAddIds,
  toInput,
  withTagAddIds,
  type InflowFolder,
  type InflowRouteInput,
  type LandingStyle,
} from '../../src/lib/inflow';
import { buildDateOptions, buildTimeOptions } from '../../src/lib/schedule';
import { setSelectedInflow } from '../../src/state/inflow-selection';
import { setLandingDraft, getLandingDraft } from '../../src/state/inflow-draft';
import { MIN_TAP, useColors } from '../../src/theme/theme';

const NONE = '__none__';
const NEW_FOLDER = '__new_folder__';
type Picker = 'folder' | 'scenario' | 'tag' | 'fromDate' | 'fromTime' | 'toDate' | 'toTime' | null;

function Segmented<T extends string>({ value, options, disabled, onChange }: { value: T; options: Array<{ v: T; label: string }>; disabled?: boolean; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable
          key={o.v}
          accessibilityRole="button"
          accessibilityState={{ selected: value === o.v, disabled }}
          disabled={disabled}
          onPress={() => onChange(o.v)}
          style={[styles.segment, { borderColor: value === o.v ? c.primary : c.border, backgroundColor: value === o.v ? c.primarySoft : c.card, opacity: disabled ? 0.5 : 1 }]}
        >
          <Text style={{ color: value === o.v ? c.primaryText : c.text, fontWeight: '700', fontSize: 14, textAlign: 'center' }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PickBox({ label, value, placeholder, onPress, disabled }: { label: string; value: string; placeholder?: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.pickBox, { borderColor: c.border, backgroundColor: c.card, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={{ color: c.textMuted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: value ? c.text : c.textMuted, fontSize: 16, fontWeight: value ? '700' : '400' }} numberOfLines={1}>
        {value || placeholder || '選ぶ'}
      </Text>
    </Pressable>
  );
}

/** 流入経路の登録・編集(Web の流入経路分析と同じ項目のうち、よく使うもの)。Web で設定した広告連携・HTMLタグ・位置情報・ほかのアクションは、そのまま残る */
function InflowEditScreen() {
  const c = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { selected } = useAccounts();
  const accountId = selected?.id ?? '';
  const isEdit = !!id;

  const [input, setInput] = useState<InflowRouteInput>(() => emptyInput(accountId));
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [folders, setFolders] = useState<InflowFolder[]>([]);
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  // 友だち追加ページのデザイン(別画面で編集して、戻ったときに受け取る)
  const designOpened = useRef(false);
  const [initialUrl, setInitialUrl] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (designOpened.current) setInput((prev) => ({ ...prev, landingStyle: getLandingDraft() }));
    }, []),
  );
  // フォルダを、その場で作る
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoadError(null);
    try {
      const [f, s, t, r] = await Promise.all([
        api.listInflowFolders(accountId).catch(() => ({ folders: [] as InflowFolder[], unfiledCount: 0 })),
        api.listScenarios(accountId).catch(() => []),
        api.listTags().catch(() => []),
        id ? api.getInflowRoute(id) : Promise.resolve(null),
      ]);
      setFolders(f.folders);
      setScenarios(s.map((x) => ({ id: x.id, name: x.name })));
      setTags(t.map((x) => ({ id: x.id, name: x.name })));
      if (r) {
        setInput(toInput(r, accountId));
        setInitialUrl(r.url);
        setTagIds(tagAddIds(r.actions));
      }
    } catch (e) {
      setLoadError(describeError(e, '読み込めませんでした'));
    } finally {
      setLoading(false);
    }
  }, [accountId, id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const from = splitPeriod(input.validFrom);
  const to = splitPeriod(input.validTo);
  const hasActions = tagIds.length > 0 || !!input.scenarioId || otherActions(input.actions).length > 0;
  const hasPeriod = !!(input.validFrom || input.validTo);
  const set = (patch: Partial<InflowRouteInput>) => setInput((prev) => ({ ...prev, ...patch }));
  const setPeriod = (side: 'validFrom' | 'validTo', dateId: string | null, timeId: string | null) => {
    if (!dateId && !timeId) return set({ [side]: null });
    set({ [side]: joinPeriod(dateId, timeId ?? (side === 'validFrom' ? '00:00' : '23:50')) });
  };

  const dateItems = useMemo<PickItem[]>(() => {
    const base = buildDateOptions(new Date(), 365).map((o) => ({ id: o.id, label: o.label }));
    return [{ id: NONE, label: 'なし' }, ...base];
  }, []);
  const timeItems = useMemo<PickItem[]>(() => [{ id: NONE, label: 'なし' }, ...buildTimeOptions(10).map((o) => ({ id: o.id, label: o.label }))], []);
  const dateWith = (current: string | null): PickItem[] => (current && !dateItems.some((d) => d.id === current) ? [{ id: current, label: current }, ...dateItems] : dateItems);

  async function save() {
    setError(null);
    if (!input.name.trim()) {
      setError('流入経路名を入力してください');
      return;
    }
    setSaving(true);
    try {
      const body: InflowRouteInput = {
        ...input,
        lineAccountId: accountId,
        name: input.name.trim(),
        qrText: input.qrText?.trim() || null,
        actions: withTagAddIds(input.actions, tagIds),
        ignoreFriendAddSettings: hasActions && input.ignoreFriendAddSettings,
        outOfPeriodMessage: hasPeriod ? input.outOfPeriodMessage : null,
      };
      const saved = id ? await api.updateInflowRoute(id, body) : await api.createInflowRoute(body);
      setSelectedInflow(saved.id);
      router.back();
    } catch (e) {
      setError(describeError(e, '保存できませんでした'));
    } finally {
      setSaving(false);
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    setFolderError(null);
    try {
      const f = await api.createInflowFolder(accountId, name);
      setFolders((prev) => [...prev, { id: f.id, name: f.name, count: 0 }]);
      set({ folderId: f.id });
      setNewFolderOpen(false);
      setNewFolderName('');
    } catch (e) {
      setFolderError(describeError(e, 'フォルダを作れませんでした'));
    } finally {
      setCreatingFolder(false);
    }
  }

  async function remove() {
    if (!id) return;
    const ok = await confirmAsync('この流入経路を削除しますか?', `「${input.name}」のURLは使えなくなります。`, '削除');
    if (!ok) return;
    setSaving(true);
    try {
      await api.deleteInflowRoute(id);
      setSelectedInflow(null);
      router.back();
    } catch (e) {
      setError(describeError(e, '削除できませんでした'));
      setSaving(false);
    }
  }

  if (loading) return <LoadingView />;
  if (loadError) return <ErrorView message={loadError} onRetry={() => void load()} />;
  if (!accountId) return <ErrorView message="公式アカウントが選ばれていません" />;

  const folderName = folders.find((f) => f.id === input.folderId)?.name ?? '未分類';
  const scenarioName = scenarios.find((s) => s.id === input.scenarioId)?.name ?? '';
  const otherCount = otherActions(input.actions).length;
  const landing: LandingStyle = input.landingStyle ?? {};

  return (
    <>
      <Stack.Screen options={{ title: isEdit ? '流入経路の編集' : '新しい流入経路' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={[styles.label, { color: c.textMuted }]}>流入経路名</Text>
          <TextInput
            value={input.name}
            onChangeText={(v) => set({ name: v })}
            maxLength={255}
            accessibilityLabel="流入経路名"
            style={[styles.input, { backgroundColor: c.inputBackground, color: c.text }]}
          />
          <View style={{ height: 12 }} />
          <PickBox label="フォルダ" value={folderName} onPress={() => setPicker('folder')} />
          <View style={{ height: 12 }} />
          <Text style={[styles.label, { color: c.textMuted }]}>QRコード表示用テキスト({Array.from(input.qrText ?? '').length}/10)</Text>
          <TextInput
            value={input.qrText ?? ''}
            onChangeText={(v) => set({ qrText: v ? Array.from(v).slice(0, 10).join('') : null })}
            accessibilityLabel="QRコード表示用テキスト"
            style={[styles.input, { backgroundColor: c.inputBackground, color: c.text }]}
          />
        </Card>

        <SectionTitle>有効期間</SectionTitle>
        <Card>
          <View style={styles.row2}>
            <PickBox label="開始 日付" value={from.dateId ? formatPeriod(input.validFrom).split(' ')[0] : ''} placeholder="なし" onPress={() => setPicker('fromDate')} />
            <PickBox label="開始 時刻" value={from.timeId ?? ''} placeholder="なし" onPress={() => setPicker('fromTime')} />
          </View>
          <View style={[styles.row2, { marginTop: 10 }]}>
            <PickBox label="終了 日付" value={to.dateId ? formatPeriod(input.validTo).split(' ')[0] : ''} placeholder="なし" onPress={() => setPicker('toDate')} />
            <PickBox label="終了 時刻" value={to.timeId ?? ''} placeholder="なし" onPress={() => setPicker('toTime')} />
          </View>
          {hasPeriod ? (
            <>
              <Text style={[styles.label, { color: c.textMuted, marginTop: 12 }]}>有効期間外メッセージ</Text>
              <TextInput
                value={input.outOfPeriodMessage ?? ''}
                onChangeText={(v) => set({ outOfPeriodMessage: v || null })}
                maxLength={500}
                multiline
                placeholder="現在ご利用いただけません"
                placeholderTextColor={c.textMuted}
                accessibilityLabel="有効期間外メッセージ"
                style={[styles.input, styles.multiline, { backgroundColor: c.inputBackground, color: c.text }]}
              />
            </>
          ) : null}
        </Card>

        <SectionTitle>アクション設定</SectionTitle>
        <Card>
          <PickBox label="シナリオ" value={scenarioName} placeholder="なし" onPress={() => setPicker('scenario')} />
          <Text style={[styles.label, { color: c.textMuted, marginTop: 14 }]}>追加するタグ</Text>
          <View style={styles.tagWrap}>
            {tagIds.map((tid) => (
              <View key={tid} style={[styles.tagChip, { backgroundColor: c.primarySoft, borderColor: c.primary }]}>
                <Text style={{ color: c.primaryText, fontSize: 14, fontWeight: '700' }}>{tags.find((t) => t.id === tid)?.name ?? 'タグ'}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="このタグを外す" hitSlop={8} onPress={() => setTagIds((prev) => prev.filter((x) => x !== tid))}>
                  <Ionicons name="close" size={16} color={c.primaryText} />
                </Pressable>
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={() => setPicker('tag')} style={[styles.tagChip, { borderColor: c.border, backgroundColor: c.card }]}>
              <Text style={{ color: c.primaryText, fontSize: 14, fontWeight: '700' }}>＋ タグ</Text>
            </Pressable>
          </View>
          {otherCount > 0 ? <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 12 }}>ほかのアクション {otherCount}件</Text> : null}
        </Card>

        <SectionTitle>友だち追加時設定のアクション</SectionTitle>
        <Segmented
          value={input.ignoreFriendAddSettings && hasActions ? 'ignore' : 'keep'}
          disabled={!hasActions}
          options={[
            { v: 'keep', label: '無視しない' },
            { v: 'ignore', label: '無視する' },
          ]}
          onChange={(v) => set({ ignoreFriendAddSettings: v === 'ignore' })}
        />

        <SectionTitle>アクションの実行</SectionTitle>
        <Segmented
          value={input.actionMode}
          disabled={isEdit}
          options={[
            { v: 'first', label: '初回の友だち追加時のみ' },
            { v: 'always', label: 'いつでも' },
          ]}
          onChange={(v) => set({ actionMode: v })}
        />

        <SectionTitle>友だち追加ページ</SectionTitle>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="友だち追加ページのデザインを編集する"
          onPress={() => {
            setLandingDraft(landing);
            designOpened.current = true;
            router.push({ pathname: '/inflow-landing', params: initialUrl ? { url: initialUrl } : {} });
          }}
          style={({ pressed }) => [styles.designRow, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', flex: 1 }}>ページのデザイン</Text>
          <Text style={{ color: c.textMuted, fontSize: 13 }}>{Object.keys(landing).length > 0 ? '設定あり' : '標準'}</Text>
          <Ionicons name="chevron-forward" size={18} color={c.primaryText} />
        </Pressable>

        {error ? (
          <Text style={{ color: c.danger, fontSize: 14, lineHeight: 20, marginTop: 12 }} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button title={isEdit ? '保存' : '登録'} loading={saving} onPress={() => void save()} style={{ marginTop: 16 }} />
        {isEdit ? <Button title="削除" variant="danger" disabled={saving} onPress={() => void remove()} style={{ marginTop: 10 }} /> : null}
      </ScrollView>

      <PickModal
        visible={picker === 'folder'}
        title="フォルダ"
        items={[{ id: NEW_FOLDER, label: '＋ 新しいフォルダ' }, { id: NONE, label: '未分類' }, ...folders.map((f) => ({ id: f.id, label: f.name }))]}
        onPick={(item) => {
          setPicker(null);
          if (item.id === NEW_FOLDER) {
            setNewFolderName('');
            setFolderError(null);
            // 選ぶ画面が閉じ終わってから開く(iPhone では、2つの画面が同時に切り替わると開かないことがある)
            setTimeout(() => setNewFolderOpen(true), 350);
            return;
          }
          set({ folderId: item.id === NONE ? null : item.id });
        }}
        onClose={() => setPicker(null)}
      />
      <Modal visible={newFolderOpen} transparent animationType="fade" onRequestClose={() => setNewFolderOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBack}>
          <View style={[styles.modalCard, { backgroundColor: c.card }]}>
            <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>新しいフォルダ</Text>
            <TextInput
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
              maxLength={100}
              placeholder="フォルダ名"
              placeholderTextColor={c.textMuted}
              accessibilityLabel="フォルダ名"
              returnKeyType="done"
              onSubmitEditing={() => void createFolder()}
              style={[styles.input, { backgroundColor: c.inputBackground, color: c.text, marginTop: 12 }]}
            />
            {folderError ? <Text style={{ color: c.danger, fontSize: 14, marginTop: 8 }} accessibilityRole="alert">{folderError}</Text> : null}
            <View style={styles.modalButtons}>
              <Button title="キャンセル" variant="secondary" disabled={creatingFolder} onPress={() => setNewFolderOpen(false)} style={{ flex: 1 }} />
              <Button title="作る" loading={creatingFolder} disabled={!newFolderName.trim()} onPress={() => void createFolder()} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <PickModal
        visible={picker === 'scenario'}
        title="シナリオ"
        items={[{ id: NONE, label: 'なし' }, ...scenarios.map((s) => ({ id: s.id, label: s.name }))]}
        onPick={(item) => {
          set({ scenarioId: item.id === NONE ? null : item.id });
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <PickModal
        visible={picker === 'tag'}
        title="追加するタグ"
        items={tags.filter((t) => !tagIds.includes(t.id)).map((t) => ({ id: t.id, label: t.name }))}
        onPick={(item) => {
          setTagIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <PickModal
        visible={picker === 'fromDate'}
        title="開始の日付"
        items={dateWith(from.dateId)}
        onPick={(item) => {
          setPeriod('validFrom', item.id === NONE ? null : item.id, item.id === NONE ? null : from.timeId);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <PickModal
        visible={picker === 'fromTime'}
        title="開始の時刻"
        items={timeItems}
        onPick={(item) => {
          setPeriod('validFrom', item.id === NONE ? null : (from.dateId ?? buildDateOptions(new Date(), 1)[0].id), item.id === NONE ? null : item.id);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <PickModal
        visible={picker === 'toDate'}
        title="終了の日付"
        items={dateWith(to.dateId)}
        onPick={(item) => {
          setPeriod('validTo', item.id === NONE ? null : item.id, item.id === NONE ? null : to.timeId);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <PickModal
        visible={picker === 'toTime'}
        title="終了の時刻"
        items={timeItems}
        onPick={(item) => {
          setPeriod('validTo', item.id === NONE ? null : (to.dateId ?? buildDateOptions(new Date(), 1)[0].id), item.id === NONE ? null : item.id);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </>
  );
}

export default withReadableWidth(InflowEditScreen);

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 40 },
  label: { fontSize: 12, marginBottom: 4 },
  input: { minHeight: MIN_TAP, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  multiline: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' },
  pickBox: { flex: 1, minHeight: MIN_TAP + 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center' },
  row2: { flexDirection: 'row', gap: 10 },
  segmented: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, minHeight: MIN_TAP, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, justifyContent: 'center' },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 16, padding: 20 },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  designRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12 },
});
