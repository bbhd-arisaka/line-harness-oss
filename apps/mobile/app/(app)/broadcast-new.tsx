import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../src/state/services';
import { useAccounts, useAuth } from '../../src/state/session';
import { Button, Card, confirmAsync, SectionTitle } from '../../src/components/ui';
import { PickModal, type PickItem } from '../../src/components/pick-modal';
import { FriendMultiPickModal, type PickedFriend } from '../../src/components/friend-multi-pick-modal';
import { withReadableWidth } from '../../src/components/readable-width';
import { accountLabel } from '../../src/lib/accounts';
import { MessageListEditor } from '../../src/components/message-list-editor';
import { buildDateOptions, buildTimeOptions, defaultSchedule, formatScheduled, isFutureEnough, toScheduledAt } from '../../src/lib/schedule';
import {
  ALL_FOLLOWING_CONDITION,
  checkMessages,
  confirmScheduleMessage,
  confirmSendMessage,
  defaultTitle,
  describeRule,
  draftSignature,
  isRuleComplete,
  MAX_RULES,
  newDraftMessage,
  newUuid,
  RULE_KIND_LABEL,
  toApiMessages,
  toSegmentConditions,
  type DraftMessage,
  type DraftRule,
  type RuleKind,
} from '../../src/lib/broadcast';
import { describeError } from '../../src/lib/errors';
import type { FriendFieldDefinition, TagItem } from '../../src/lib/types';
import { MIN_TAP, useColors } from '../../src/theme/theme';

type Picker = { ruleKind: RuleKind } | null;
type SchedulePicker = 'date' | 'time' | null;

/** テスト送信で一度に選べる人数(サーバー側の上限と同じ) */
const MAX_TEST_FRIENDS = 10;

/** 新しい一斉配信: メッセージ → 配信先(全員 / 条件で絞り込み) → 人数の確認 → テスト送信 → 送る */
function BroadcastNewScreen() {
  const c = useColors();
  const router = useRouter();
  const { selected } = useAccounts();
  const staff = useAuth().staff;
  const accountId = selected?.id ?? null;
  const accountName = selected ? accountLabel(selected) : '';
  const allowed = staff?.role === 'owner' || staff?.role === 'admin';
  const parallel = !!selected?.lstepForwardUrl;

  // 配信するメッセージ(1〜5通・上から順に届く)
  const [messages, setMessages] = useState<DraftMessage[]>(() => [newDraftMessage('text')]);
  const [narrowed, setNarrowed] = useState(false);
  const [operator, setOperator] = useState<'AND' | 'OR'>('AND');
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [tags, setTags] = useState<TagItem[] | null>(null);
  const [fields, setFields] = useState<FriendFieldDefinition[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<'count' | 'test' | 'send' | null>(null);
  // 送るタイミング: いますぐ / 予約(日本時間)
  const [when, setWhen] = useState<'now' | 'scheduled'>('now');
  const [schedule, setSchedule] = useState(() => defaultSchedule(new Date()));
  const [schedulePicker, setSchedulePicker] = useState<SchedulePicker>(null);
  const dateOptions = useMemo(() => buildDateOptions(new Date()), []);
  const timeOptions = useMemo(() => buildTimeOptions(10), []);
  const [testFriends, setTestFriends] = useState<PickedFriend[]>([]);
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // 下書きは、内容が同じなら同じキーで作る(押し間違い・通信のやり直しで、二重に作られない)
  const draft = useRef<{ key: string; signature: string; id: string | null }>({ key: newUuid(), signature: '', id: null });

  const conditions = useMemo(() => (narrowed ? toSegmentConditions(operator, rules) : null), [narrowed, operator, rules]);
  const resetCount = () => setCount(null);

  const loadPickerData = useCallback(async (ruleKind: RuleKind) => {
    try {
      if (ruleKind === 'tag_exists' || ruleKind === 'tag_not_exists') {
        if (!tags) setTags(await api.listTags());
      } else if (!fields) {
        setFields(await api.listFriendFieldDefinitions());
      }
      setNotice(null);
    } catch (e) {
      setPicker(null);
      setNotice({ ok: false, text: describeError(e, '一覧を読み込めませんでした') });
    }
  }, [tags, fields]);

  function openPicker(ruleKind: RuleKind) {
    if (rules.length >= MAX_RULES) {
      setNotice({ ok: false, text: `条件は${MAX_RULES}個までです` });
      return;
    }
    setPicker({ ruleKind });
    void loadPickerData(ruleKind);
  }

  function onPick(item: PickItem) {
    if (!picker) return;
    const base = { id: newUuid(), kind: picker.ruleKind };
    const rule: DraftRule =
      picker.ruleKind === 'tag_exists' || picker.ruleKind === 'tag_not_exists'
        ? { ...base, tagId: item.id, tagName: item.label }
        : { ...base, fieldKey: item.id, fieldLabel: item.label, value: '' };
    setRules((prev) => [...prev, rule]);
    setPicker(null);
    resetCount();
  }

  const pickItems: PickItem[] = useMemo(() => {
    if (!picker) return [];
    if (picker.ruleKind === 'tag_exists' || picker.ruleKind === 'tag_not_exists') return (tags ?? []).map((t) => ({ id: t.id, label: t.name }));
    return (fields ?? []).map((f) => ({ id: f.fieldKey, label: f.label, note: f.options.length > 0 ? `選択肢: ${f.options.slice(0, 4).join('・')}${f.options.length > 4 ? ' など' : ''}` : undefined }));
  }, [picker, tags, fields]);

  function setRuleValue(id: string, value: string) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
    resetCount();
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
    resetCount();
  }

  /** 条件のチェック。問題があれば、画面に出す文言を返す */
  function problem(): string | null {
    const m = checkMessages(messages);
    if (!m.ok) return m.reason;
    if (narrowed) {
      if (rules.some((r) => !isRuleComplete(r))) return '未入力の条件があります(友だち情報の「値」を入れるか、条件を削除してください)';
      if (!conditions) return '条件を1つ以上、設定してください(全員に送るときは「友だち全員」を選んでください)';
    }
    return null;
  }

  async function countAudience(): Promise<number | null> {
    if (!accountId) return null;
    const r = await api.countSegment(accountId, conditions ?? ALL_FOLLOWING_CONDITION);
    setCount(r.count);
    return r.count;
  }

  async function onCount() {
    const p = problem();
    if (p) return setNotice({ ok: false, text: p });
    setBusy('count');
    setNotice(null);
    try {
      await countAudience();
    } catch (e) {
      setNotice({ ok: false, text: describeError(e, '人数を数えられませんでした') });
    } finally {
      setBusy(null);
    }
  }

  async function ensureDraft(): Promise<string> {
    if (!accountId) throw new Error('公式アカウントが選ばれていません');
    const signature = draftSignature({ accountId, messages });
    if (draft.current.signature !== signature) draft.current = { key: newUuid(), signature, id: null };
    if (draft.current.id) return draft.current.id;
    const first = messages[0];
    const titleSource = first.kind === 'text' ? first.text : '画像の配信';
    const created = await api.createBroadcastDraft({ title: defaultTitle(titleSource, new Date()), messages: toApiMessages(messages), lineAccountId: accountId }, draft.current.key);
    draft.current.id = created.id;
    return created.id;
  }

  async function onTest() {
    const p = problem();
    if (p) return setNotice({ ok: false, text: p });
    if (testFriends.length === 0) {
      setFriendPickerOpen(true);
      return;
    }
    setBusy('test');
    setNotice(null);
    try {
      const id = await ensureDraft();
      const r = await api.testSendBroadcast(id, testFriends.map((f) => f.id));
      setNotice({ ok: r.failed === 0 && r.sent > 0, text: `選んだ${r.sent}人に送りました${r.failed > 0 ? `(${r.failed}人は失敗)` : ''}。LINEで確認してください。` });
    } catch (e) {
      setNotice({ ok: false, text: describeError(e, 'テスト送信できませんでした') });
    } finally {
      setBusy(null);
    }
  }

  async function onSend() {
    const p = problem();
    if (p) return setNotice({ ok: false, text: p });
    setBusy('send');
    setNotice(null);
    try {
      const n = await countAudience();
      if (n === null) return;
      if (n === 0) {
        setNotice({ ok: false, text: '対象が0人です。条件を見直してください。' });
        return;
      }
      if (when === 'scheduled') {
        const scheduledAt = toScheduledAt(schedule.dateId, schedule.timeId);
        if (!isFutureEnough(scheduledAt, new Date())) {
          setNotice({ ok: false, text: '予約の日時は、いまから3分より先にしてください' });
          return;
        }
        const okSchedule = await confirmAsync('この内容で、配信を予約しますか?', confirmScheduleMessage(accountName, n, narrowed, formatScheduled(scheduledAt), messages.length), '予約する');
        if (!okSchedule) return;
        const id = await ensureDraft();
        await api.scheduleBroadcast(id, { scheduledAt, conditions: narrowed ? conditions : null });
        router.replace({ pathname: '/broadcast/[id]', params: { id } });
        return;
      }
      const ok = await confirmAsync('この内容で、一斉配信しますか?', confirmSendMessage(accountName, n, narrowed, messages.length), '送る');
      if (!ok) return;
      const id = await ensureDraft();
      if (narrowed && conditions) await api.sendBroadcastToSegment(id, conditions);
      else await api.sendBroadcastToAll(id);
      router.replace({ pathname: '/broadcast/[id]', params: { id } });
    } catch (e) {
      setNotice({ ok: false, text: describeError(e, '送れませんでした') });
    } finally {
      setBusy(null);
    }
  }

  if (!allowed || parallel || !accountId) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: 24, justifyContent: 'center' }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>
          {!allowed ? '一斉配信は、オーナーまたは管理者だけが使えます' : parallel ? 'このアカウントでは、いま一斉配信できません' : '公式アカウントが選ばれていません'}
        </Text>
        {parallel ? (
          <Text style={{ color: c.textSub, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 }}>
            Lステップと並行運用中のため、お客様に二重で届くのを防ぐために、止めています。本番に切り替えたあと、使えるようになります。
          </Text>
        ) : null}
      </View>
    );
  }

  const busyAny = busy !== null;
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SectionTitle>送る公式アカウント</SectionTitle>
      <Card>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{accountName}</Text>
        <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>別のアカウントに送るときは、トークの画面で、アカウントを切り替えてから開いてください。</Text>
      </Card>

      <SectionTitle>メッセージ</SectionTitle>
      <MessageListEditor
        messages={messages}
        onChange={(next) => {
          setMessages(next);
          setNotice(null);
        }}
        disabled={busyAny}
      />

      <SectionTitle>送る相手</SectionTitle>
      <Card>
        <View style={styles.segmented}>
          {[
            { v: false, label: '友だち全員' },
            { v: true, label: '条件で絞り込む' },
          ].map((o) => (
            <Pressable
              key={String(o.v)}
              accessibilityRole="button"
              accessibilityState={{ selected: narrowed === o.v }}
              onPress={() => {
                setNarrowed(o.v);
                resetCount();
              }}
              style={[styles.segment, { borderColor: narrowed === o.v ? c.primary : c.border, backgroundColor: narrowed === o.v ? c.primarySoft : c.card }]}
            >
              <Text style={{ color: narrowed === o.v ? c.primaryText : c.text, fontWeight: '700' }}>{o.label}</Text>
            </Pressable>
          ))}
        </View>

        {narrowed ? (
          <View style={{ marginTop: 12 }}>
            {rules.length > 1 ? (
              <View style={[styles.segmented, { marginBottom: 10 }]}>
                {(['AND', 'OR'] as const).map((op) => (
                  <Pressable
                    key={op}
                    accessibilityRole="button"
                    accessibilityState={{ selected: operator === op }}
                    onPress={() => {
                      setOperator(op);
                      resetCount();
                    }}
                    style={[styles.segment, { borderColor: operator === op ? c.primary : c.border, backgroundColor: operator === op ? c.primarySoft : c.card }]}
                  >
                    <Text style={{ color: operator === op ? c.primaryText : c.text, fontWeight: '700', fontSize: 13 }}>{op === 'AND' ? 'すべて満たす' : 'どれかを満たす'}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {rules.map((r) => (
              <View key={r.id} style={[styles.rule, { borderColor: c.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{r.kind === 'field_equals' || r.kind === 'field_not_equals' ? `友だち情報「${r.fieldLabel}」が${r.kind === 'field_equals' ? '' : '次ではない'}` : describeRule(r)}</Text>
                  {r.kind === 'field_equals' || r.kind === 'field_not_equals' ? (
                    <TextInput
                      value={r.value ?? ''}
                      onChangeText={(t) => setRuleValue(r.id, t)}
                      placeholder="値(完全に一致するもの)"
                      placeholderTextColor={c.textMuted}
                      style={[styles.valueInput, { color: c.text, borderColor: c.border }]}
                      accessibilityLabel={`${r.fieldLabel}の値`}
                    />
                  ) : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="この条件を削除" onPress={() => removeRule(r.id)} style={styles.removeBtn}>
                  <Text style={{ color: c.danger, fontWeight: '700' }}>削除</Text>
                </Pressable>
              </View>
            ))}

            <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 8, marginBottom: 6 }}>条件を追加</Text>
            <View style={styles.addRow}>
              {(Object.keys(RULE_KIND_LABEL) as RuleKind[]).map((k) => (
                <Pressable key={k} accessibilityRole="button" onPress={() => openPicker(k)} style={[styles.addBtn, { borderColor: c.border, backgroundColor: c.card }]}>
                  <Text style={{ color: c.primaryText, fontWeight: '700', fontSize: 13 }}>＋ {RULE_KIND_LABEL[k]}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ color: c.textMuted, fontSize: 12, lineHeight: 18, marginTop: 8 }}>
              ブロック中の人には送りません。友だち情報は、複数選んだ項目(「A、B」のように保存されたもの)には、完全一致しません。
            </Text>
          </View>
        ) : null}

        <View style={[styles.countBox, { backgroundColor: c.background, borderColor: c.border }]}>
          <Text style={{ color: c.textMuted, fontSize: 12 }}>送る人数</Text>
          <Text style={{ color: c.text, fontSize: 22, fontWeight: '800', marginTop: 2 }}>{count === null ? '—' : `${count.toLocaleString('ja-JP')}人`}</Text>
          <Button title="人数を確認する" variant="secondary" loading={busy === 'count'} disabled={busyAny && busy !== 'count'} onPress={() => void onCount()} style={{ marginTop: 8 }} />
        </View>
      </Card>

      {notice ? (
        <Text style={{ color: notice.ok ? c.primaryText : c.danger, fontSize: 14, lineHeight: 20, marginTop: 4 }} accessibilityRole="alert">
          {notice.text}
        </Text>
      ) : null}

      <SectionTitle>送るタイミング</SectionTitle>
      <Card>
        <View style={styles.segmented}>
          {[
            { v: 'now' as const, label: 'いますぐ' },
            { v: 'scheduled' as const, label: '日時を指定して予約' },
          ].map((o) => (
            <Pressable
              key={o.v}
              accessibilityRole="button"
              accessibilityState={{ selected: when === o.v }}
              disabled={busyAny}
              onPress={() => setWhen(o.v)}
              style={[styles.segment, { borderColor: when === o.v ? c.primary : c.border, backgroundColor: when === o.v ? c.primarySoft : c.card }]}
            >
              <Text style={{ color: when === o.v ? c.primaryText : c.text, fontWeight: '700', fontSize: 14 }}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
        {when === 'scheduled' ? (
          <View style={{ marginTop: 12, gap: 8 }}>
            <View style={styles.segmented}>
              <Pressable accessibilityRole="button" disabled={busyAny} onPress={() => setSchedulePicker('date')} style={[styles.pickBox, { borderColor: c.border, backgroundColor: c.card }]}>
                <Text style={{ color: c.textMuted, fontSize: 11 }}>日付</Text>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{dateOptions.find((d) => d.id === schedule.dateId)?.label ?? schedule.dateId}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busyAny} onPress={() => setSchedulePicker('time')} style={[styles.pickBox, { borderColor: c.border, backgroundColor: c.card }]}>
                <Text style={{ color: c.textMuted, fontSize: 11 }}>時刻</Text>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{schedule.timeId}</Text>
              </Pressable>
            </View>
            <Text style={{ color: c.textSub, fontSize: 13, lineHeight: 19 }}>
              {formatScheduled(toScheduledAt(schedule.dateId, schedule.timeId))} に配信します(日本時間)。送る人は、その時刻の時点の対象になります。予約は、配信の画面から取り消せます。
            </Text>
          </View>
        ) : null}
      </Card>

      <SectionTitle>テスト送信</SectionTitle>
      <Card>
        <Text style={{ color: c.textMuted, fontSize: 12, lineHeight: 18 }}>
          本番の前に、選んだ友だちだけに送って確認できます(最大{MAX_TEST_FRIENDS}人)。前回使った人は、選ぶ画面の上に並びます。
        </Text>
        <Text style={{ color: testFriends.length > 0 ? c.text : c.textMuted, fontSize: 15, marginTop: 8, lineHeight: 22 }}>
          {testFriends.length > 0 ? `送る相手: ${testFriends.map((f) => f.name).join('、')}` : '送る友だちが選ばれていません'}
        </Text>
        <Button
          title={testFriends.length > 0 ? '送る友だちを選び直す' : '友だちを検索して選ぶ'}
          variant="secondary"
          disabled={busyAny}
          onPress={() => setFriendPickerOpen(true)}
          style={{ marginTop: 8 }}
        />
      </Card>

      <View style={{ gap: 10, marginTop: 8 }}>
        <Button
          title={testFriends.length > 0 ? `選んだ${testFriends.length}人にテスト送信` : 'テスト送信'}
          variant="secondary"
          loading={busy === 'test'}
          disabled={(busyAny && busy !== 'test') || testFriends.length === 0}
          onPress={() => void onTest()}
        />
        <Button title={when === 'scheduled' ? '予約する' : 'いますぐ送る'} loading={busy === 'send'} disabled={busyAny && busy !== 'send'} onPress={() => void onSend()} />
        <Text style={{ color: c.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center' }}>
          {when === 'scheduled' ? '予約する前に、内容の確認が出ます。予約は、配信の画面から取り消せます。' : '送る前に、人数の確認が出ます。送ったあとは取り消せません。'}
        </Text>
      </View>

      <FriendMultiPickModal
        visible={friendPickerOpen}
        accountId={accountId}
        initial={testFriends}
        max={MAX_TEST_FRIENDS}
        onDone={(list) => {
          setTestFriends(list);
          setFriendPickerOpen(false);
          setNotice(null);
        }}
        onClose={() => setFriendPickerOpen(false)}
      />

      <PickModal
        visible={schedulePicker === 'date'}
        title="日付を選ぶ"
        items={dateOptions.map((d) => ({ id: d.id, label: d.label }))}
        onPick={(item) => {
          setSchedule((s) => ({ ...s, dateId: item.id }));
          setSchedulePicker(null);
          setNotice(null);
        }}
        onClose={() => setSchedulePicker(null)}
      />
      <PickModal
        visible={schedulePicker === 'time'}
        title="時刻を選ぶ(日本時間)"
        items={timeOptions.map((t) => ({ id: t.id, label: t.label }))}
        onPick={(item) => {
          setSchedule((s) => ({ ...s, timeId: item.id }));
          setSchedulePicker(null);
          setNotice(null);
        }}
        onClose={() => setSchedulePicker(null)}
      />

      <PickModal
        visible={picker !== null}
        title={picker?.ruleKind === 'field_equals' || picker?.ruleKind === 'field_not_equals' ? '友だち情報の項目を選ぶ' : 'タグを選ぶ'}
        items={pickItems}
        onPick={onPick}
        onClose={() => setPicker(null)}
      />
    </ScrollView>
  );
}

export default withReadableWidth(BroadcastNewScreen);

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 40 },
  textArea: { minHeight: 140, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, textAlignVertical: 'top' },
  segmented: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, minHeight: MIN_TAP, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  rule: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8, gap: 8 },
  valueInput: { minHeight: 40, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, marginTop: 6, fontSize: 15 },
  removeBtn: { minHeight: MIN_TAP, minWidth: 52, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addBtn: { minHeight: 40, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  pickBox: { flex: 1, minHeight: MIN_TAP + 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center' },
  countBox: { marginTop: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12 },
});
