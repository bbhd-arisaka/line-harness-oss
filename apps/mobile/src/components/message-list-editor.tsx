import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../state/services';
import { pickAndUploadImage } from '../state/image-upload';
import { Button } from './ui';
import { PickModal, type PickItem } from './pick-modal';
import { TaggedText } from './tagged-text';
import {
  formTag,
  insertAtSelection,
  MAX_BROADCAST_MESSAGES,
  MAX_MESSAGE_LENGTH,
  NAME_TAG,
  newDraftMessage,
  type DraftKind,
  type DraftMessage,
} from '../lib/broadcast';
import { describeError } from '../lib/errors';
import type { FormOption } from '../lib/types';
import { MIN_TAP, useColors } from '../theme/theme';

/**
 * 一斉配信のメッセージを、最大5通まで並べて作る。上から順に届く。
 * 1通ごとに、テキスト(名前・回答フォームのリンクを入れられる)か画像(写真アプリから選ぶ)を選べ、
 * ↑↓で順番を入れ替え、削除できる。
 */
export function MessageListEditor({
  messages,
  onChange,
  disabled = false,
}: {
  messages: DraftMessage[];
  onChange: (messages: DraftMessage[]) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const [forms, setForms] = useState<FormOption[] | null>(null);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null); // フォームを選んでいる最中のメッセージの key
  const [uploading, setUploading] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 差し込んだあとのカーソル位置を、入力欄に伝える(伝えたら、すぐ手放す)
  const [forcedSelection, setForcedSelection] = useState<{ key: string; start: number; end: number } | null>(null);
  const [selections, setSelections] = useState<Record<string, { start: number; end: number }>>({});

  const needForms = useMemo(() => messages.some((m) => m.kind === 'text' && m.text.includes('{{form_url:')), [messages]);
  const loadForms = useCallback(async () => {
    if (forms) return;
    try {
      const rows = await api.listForms();
      setForms(rows.filter((f) => f.isActive !== false));
      setFormsError(null);
    } catch (e) {
      setFormsError(describeError(e, 'フォームの一覧を読み込めませんでした'));
    }
  }, [forms]);
  // 本文にフォームのタグがあるときは、枠に出す名前のために、フォーム一覧を読む
  useEffect(() => {
    if (needForms) queueMicrotask(() => void loadForms());
  }, [needForms, loadForms]);

  const formNames = useMemo(() => new Map((forms ?? []).map((f) => [f.id, f.name])), [forms]);
  const formItems: PickItem[] = useMemo(() => (forms ?? []).map((f) => ({ id: f.id, label: f.name })), [forms]);

  const patch = (key: string, change: Partial<DraftMessage>) => onChange(messages.map((m) => (m.key === key ? { ...m, ...change } : m)));
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= messages.length) return;
    const next = [...messages];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };
  const remove = (key: string) => onChange(messages.filter((m) => m.key !== key));

  function insertCode(m: DraftMessage, code: string) {
    const r = insertAtSelection(m.text, code, selections[m.key] ?? null);
    patch(m.key, { text: r.text });
    setForcedSelection({ key: m.key, start: r.cursor, end: r.cursor });
    setSelections((prev) => ({ ...prev, [m.key]: { start: r.cursor, end: r.cursor } }));
  }

  async function choosePhoto(m: DraftMessage) {
    setUploading(m.key);
    setNotice(null);
    try {
      const url = await pickAndUploadImage();
      if (url) patch(m.key, { imageUrl: url });
    } catch (e) {
      setNotice(describeError(e, '画像を送れませんでした'));
    } finally {
      setUploading(null);
    }
  }

  const KINDS: Array<{ k: DraftKind; label: string }> = [
    { k: 'text', label: 'テキスト' },
    { k: 'image', label: '画像' },
  ];

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.textMuted, fontSize: 12 }}>上から順に届きます(最大{MAX_BROADCAST_MESSAGES}通)。</Text>

      {messages.map((m, index) => (
        <View key={m.key} style={[styles.card, { borderColor: c.border, backgroundColor: c.card }]}>
          <View style={styles.head}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '800', flex: 1 }}>{index + 1}通目</Text>
            <IconButton icon="arrow-up" label={`${index + 1}通目を上へ`} disabled={disabled || index === 0} onPress={() => move(index, -1)} />
            <IconButton icon="arrow-down" label={`${index + 1}通目を下へ`} disabled={disabled || index === messages.length - 1} onPress={() => move(index, 1)} />
            <IconButton icon="trash" label={`${index + 1}通目を削除`} danger disabled={disabled || messages.length <= 1} onPress={() => remove(m.key)} />
          </View>

          <View style={styles.segmented}>
            {KINDS.map((o) => {
              const on = m.kind === o.k;
              return (
                <Pressable
                  key={o.k}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  disabled={disabled}
                  onPress={() => on || patch(m.key, { kind: o.k })}
                  style={[styles.segment, { borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primarySoft : c.card }]}
                >
                  <Text style={{ color: on ? c.primaryText : c.text, fontWeight: '700', fontSize: 14 }}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {m.kind === 'text' ? (
            <View style={{ marginTop: 10 }}>
              <TextInput
                value={m.text}
                onChangeText={(t) => {
                  setForcedSelection(null);
                  patch(m.key, { text: t });
                }}
                onSelectionChange={(e) => {
                  setSelections((prev) => ({ ...prev, [m.key]: e.nativeEvent.selection }));
                  setForcedSelection((f) => (f?.key === m.key ? null : f));
                }}
                selection={forcedSelection?.key === m.key ? { start: forcedSelection.start, end: forcedSelection.end } : undefined}
                editable={!disabled}
                placeholder="送るメッセージを入力"
                placeholderTextColor={c.textMuted}
                multiline
                maxLength={MAX_MESSAGE_LENGTH}
                style={[styles.textArea, { color: c.text, borderColor: c.border }]}
                accessibilityLabel={`${index + 1}通目のメッセージ`}
              />
              <View style={styles.insertRow}>
                <Pressable accessibilityRole="button" disabled={disabled} onPress={() => insertCode(m, NAME_TAG)} style={[styles.insertBtn, { borderColor: '#7dd3fc', backgroundColor: '#e0f2fe' }]}>
                  <Text style={{ color: '#075985', fontWeight: '700', fontSize: 13 }}>＋ 名前を入れる</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={() => {
                    setPickFor(m.key);
                    void loadForms();
                  }}
                  style={[styles.insertBtn, { borderColor: '#93c5fd', backgroundColor: '#e3f0fb' }]}
                >
                  <Text style={{ color: '#1d5f92', fontWeight: '700', fontSize: 13 }}>＋ 回答フォームを入れる</Text>
                </Pressable>
              </View>
              {m.text.includes('{{') ? (
                <View style={[styles.preview, { backgroundColor: c.background, borderColor: c.border }]}>
                  <Text style={{ color: c.textMuted, fontSize: 11, marginBottom: 4 }}>表示イメージ(送るときは、友だちの名前・フォームのリンクに変わります)</Text>
                  <TaggedText text={m.text} formNames={formNames} style={{ color: c.text, fontSize: 15, lineHeight: 22 }} />
                </View>
              ) : null}
              <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'right', marginTop: 4 }}>
                {Array.from(m.text).length.toLocaleString('ja-JP')} / {MAX_MESSAGE_LENGTH.toLocaleString('ja-JP')}
              </Text>
            </View>
          ) : (
            <View style={{ marginTop: 10, gap: 8 }}>
              {m.imageUrl ? <Image source={{ uri: m.imageUrl }} style={[styles.thumb, { backgroundColor: c.border }]} resizeMode="contain" accessibilityLabel={`${index + 1}通目の画像`} /> : null}
              {uploading === m.key ? (
                <View style={styles.uploading}>
                  <ActivityIndicator color={c.primary} />
                  <Text style={{ color: c.textSub, fontSize: 13 }}>画像を送っています…</Text>
                </View>
              ) : (
                <Button
                  title={m.imageUrl ? '写真を選び直す' : '写真を選ぶ'}
                  variant="secondary"
                  disabled={disabled || uploading !== null}
                  onPress={() => void choosePhoto(m)}
                />
              )}
              <Text style={{ color: c.textMuted, fontSize: 12 }}>写真アプリから選びます。大きい写真は、自動で小さくして送ります(JPEG)。</Text>
            </View>
          )}
        </View>
      ))}

      {notice ? <Text style={{ color: c.danger, fontSize: 14 }} accessibilityRole="alert">{notice}</Text> : null}

      {messages.length < MAX_BROADCAST_MESSAGES ? (
        <Button title={`＋ メッセージを追加(${messages.length}/${MAX_BROADCAST_MESSAGES})`} variant="secondary" disabled={disabled} onPress={() => onChange([...messages, newDraftMessage('text')])} />
      ) : (
        <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'center' }}>メッセージは{MAX_BROADCAST_MESSAGES}通までです(LINEの1回の配信の上限)</Text>
      )}

      <PickModal
        visible={pickFor !== null}
        title={forms === null && !formsError ? '回答フォームを選ぶ(読み込み中…)' : '回答フォームを選ぶ'}
        items={formItems}
        onPick={(item) => {
          const target = messages.find((m) => m.key === pickFor);
          setPickFor(null);
          if (target) insertCode(target, formTag(item.id));
        }}
        onClose={() => setPickFor(null)}
      />
      {formsError && pickFor !== null ? <Text style={{ color: c.danger, fontSize: 13 }}>{formsError}</Text> : null}
    </View>
  );
}

function IconButton({ icon, label, onPress, disabled, danger }: { icon: 'arrow-up' | 'arrow-down' | 'trash'; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={danger ? c.danger : c.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 8 },
  iconBtn: { width: MIN_TAP - 4, height: MIN_TAP - 4, alignItems: 'center', justifyContent: 'center' },
  segmented: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, minHeight: 40, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  textArea: { minHeight: 120, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, textAlignVertical: 'top' },
  insertRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  insertBtn: { minHeight: 38, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  preview: { marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10 },
  thumb: { width: '100%', height: 200, borderRadius: 10 },
  uploading: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TAP },
});
