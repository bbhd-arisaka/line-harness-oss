import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../state/services';
import { pickAndUploadImage } from '../state/image-upload';
import { Button } from './ui';
import { PickModal, type PickItem } from './pick-modal';
import {
  formTag,
  insertCodeIntoParts,
  MAX_BROADCAST_MESSAGES,
  MAX_MESSAGE_LENGTH,
  NAME_TAG,
  newDraftMessage,
  removeTagPart,
  setPartText,
  toEditorParts,
  type DraftKind,
  type DraftMessage,
  type EditorPart,
} from '../lib/broadcast';
import { describeError } from '../lib/errors';
import type { FormOption } from '../lib/types';
import { MIN_TAP, useColors } from '../theme/theme';

/** ボックス(タグ)の色。Web版と同じ系統: 名前=水色、フォーム=青、そのほか=紫 */
const CHIP = {
  name: { fg: '#075985', bg: '#e0f2fe', border: '#7dd3fc' },
  form: { fg: '#1d5f92', bg: '#e3f0fb', border: '#93c5fd' },
  other: { fg: '#5b21b6', bg: '#ede9fe', border: '#c4b5fd' },
} as const;

/**
 * 一斉配信のメッセージを、最大5通まで並べて作る。上から順に届く。
 * 1通ごとに、テキスト(名前・回答フォームを、色付きのボックスで入れられる)か画像(写真アプリから選ぶ。✕で消せる)を選べ、
 * ↑↓で順番を入れ替え、削除できる。
 *
 * 【タグは、{{…}} の文字のまま見せない】(beyondシリーズ共通の決まり)
 * 入力欄は「文字ブロック → ボックス → 文字ブロック …」の並びで、ボックスの✕で消す。
 * 保存・送信する本文は、これまでどおり、つなげたタグコードつきの文字列。
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
  // メッセージごとの、最後に触った文字ブロックとカーソル位置(ボックスを入れる位置)
  const [focus, setFocus] = useState<Record<string, { partIndex: number; selection: { start: number; end: number } }>>({});

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
  // 本文にフォームのボックスがあるときは、ボックスに出す名前のために、フォーム一覧を読む
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
    patch(m.key, { text: insertCodeIntoParts(toEditorParts(m.text), code, focus[m.key] ?? null) });
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
              <TextComposer
                parts={toEditorParts(m.text)}
                formNames={formNames}
                disabled={disabled}
                placeholderWhenEmpty={m.text === ''}
                label={`${index + 1}通目のメッセージ`}
                onChangePart={(i, t) => patch(m.key, { text: setPartText(toEditorParts(m.text), i, t) })}
                onRemoveTag={(i) => patch(m.key, { text: removeTagPart(toEditorParts(m.text), i) })}
                onFocusPart={(i, selection) => setFocus((prev) => ({ ...prev, [m.key]: { partIndex: i, selection } }))}
              />
              <View style={styles.insertRow}>
                <Pressable accessibilityRole="button" disabled={disabled} onPress={() => insertCode(m, NAME_TAG)} style={[styles.insertBtn, { borderColor: CHIP.name.border, backgroundColor: CHIP.name.bg }]}>
                  <Text style={{ color: CHIP.name.fg, fontWeight: '700', fontSize: 13 }}>＋ 名前を入れる</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={() => {
                    setPickFor(m.key);
                    void loadForms();
                  }}
                  style={[styles.insertBtn, { borderColor: CHIP.form.border, backgroundColor: CHIP.form.bg }]}
                >
                  <Text style={{ color: CHIP.form.fg, fontWeight: '700', fontSize: 13 }}>＋ 回答フォームを入れる</Text>
                </Pressable>
              </View>
              <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'right', marginTop: 4 }}>
                {Array.from(m.text).length.toLocaleString('ja-JP')} / {MAX_MESSAGE_LENGTH.toLocaleString('ja-JP')}
              </Text>
            </View>
          ) : (
            <View style={{ marginTop: 10, gap: 8 }}>
              {m.imageUrl ? (
                <View>
                  <Image source={{ uri: m.imageUrl }} style={[styles.thumb, { backgroundColor: c.border }]} resizeMode="contain" accessibilityLabel={`${index + 1}通目の画像`} />
                  {/* 画像を消す(✕)。消したあとは、また選べる */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${index + 1}通目の画像を削除`}
                    disabled={disabled || uploading !== null}
                    onPress={() => patch(m.key, { imageUrl: null })}
                    hitSlop={8}
                    style={({ pressed }) => [styles.removeX, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Ionicons name="close" size={20} color="#ffffff" />
                  </Pressable>
                </View>
              ) : null}
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

/**
 * テキスト1通の入力欄: 文字ブロック(入力できる)と、色付きのボックス(✕で消す)を、上から順に並べる。
 * ボックスは、{{…}} のコードではなく、日本語の名前で見せる(名前・フォーム：○○)。
 */
function TextComposer({
  parts,
  formNames,
  disabled,
  placeholderWhenEmpty,
  label,
  onChangePart,
  onRemoveTag,
  onFocusPart,
}: {
  parts: EditorPart[];
  formNames: ReadonlyMap<string, string>;
  disabled: boolean;
  placeholderWhenEmpty: boolean;
  label: string;
  onChangePart: (index: number, text: string) => void;
  onRemoveTag: (index: number) => void;
  onFocusPart: (index: number, selection: { start: number; end: number }) => void;
}) {
  const c = useColors();
  return (
    <View style={[styles.composer, { borderColor: c.border, backgroundColor: c.card }]}>
      {parts.map((p, i) => {
        if (p.kind === 'text') {
          return (
            <TextInput
              key={`t${i}`}
              value={p.text}
              onChangeText={(t) => onChangePart(i, t)}
              onFocus={() => onFocusPart(i, { start: p.text.length, end: p.text.length })}
              onSelectionChange={(e) => onFocusPart(i, e.nativeEvent.selection)}
              editable={!disabled}
              placeholder={placeholderWhenEmpty && i === 0 ? '送るメッセージを入力' : undefined}
              placeholderTextColor={c.textMuted}
              multiline
              style={[styles.block, { color: c.text, minHeight: i === 0 ? 96 : 40 }]}
              accessibilityLabel={`${label}(${i / 2 + 1}つ目の文字欄)`}
            />
          );
        }
        const tone = p.tag.kind === 'name' ? CHIP.name : p.tag.kind === 'form' ? CHIP.form : CHIP.other;
        const text =
          p.tag.kind === 'name' ? '名前' : p.tag.kind === 'form' ? (formNames.get(p.tag.formId) ? `フォーム：${formNames.get(p.tag.formId)}` : 'フォーム') : p.tag.code;
        return (
          <View key={`g${i}`} style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <Text style={{ color: tone.fg, fontSize: 14, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{text}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`${text}を削除`} disabled={disabled} onPress={() => onRemoveTag(i)} hitSlop={10} style={styles.chipX}>
              <Ionicons name="close" size={18} color={tone.fg} />
            </Pressable>
          </View>
        );
      })}
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
  composer: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, gap: 4 },
  block: { fontSize: 16, paddingVertical: 8, paddingHorizontal: 2, textAlignVertical: 'top' },
  chip: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingLeft: 10, paddingRight: 4, minHeight: 34 },
  chipX: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  insertRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  insertBtn: { minHeight: 38, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: 200, borderRadius: 10 },
  removeX: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  uploading: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TAP },
});
