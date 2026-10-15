import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../state/services';
import { pickAndUploadImage } from '../state/image-upload';
import { Button } from './ui';
import { PickModal, type PickItem } from './pick-modal';
import { formTag, MAX_BROADCAST_MESSAGES, MAX_MESSAGE_LENGTH, NAME_TAG, newDraftMessage, REAL_NAME_TAG, type DraftKind, type DraftMessage } from '../lib/broadcast';
import { appendTag, applyEdit, displayOf, insertTag, segDisplay, segsToText, tagTone, toSegs, type TagTone } from '../lib/tag-editor';
import { describeError } from '../lib/errors';
import type { FormOption } from '../lib/types';
import { MIN_TAP, useColors } from '../theme/theme';

/** ボックス(タグ)の色。Web版と同じ系統: LINE名=水色、本名=緑、フォーム=青、そのほか=紫 */
const CHIP: Record<TagTone, { fg: string; bg: string; border: string }> = {
  name: { fg: '#075985', bg: '#e0f2fe', border: '#7dd3fc' },
  realName: { fg: '#065f46', bg: '#d1fae5', border: '#6ee7b7' },
  form: { fg: '#1d5f92', bg: '#e3f0fb', border: '#93c5fd' },
  other: { fg: '#5b21b6', bg: '#ede9fe', border: '#c4b5fd' },
};

/**
 * 一斉配信のメッセージを、最大5通まで並べて作る。上から順に届く。
 * 1通ごとに、テキスト(LINE名・本名・回答フォームを、色付きのボックスで入れられる)か画像(写真アプリから選ぶ。✕で消せる)を選べ、
 * ↑↓で順番を入れ替え、削除できる。
 *
 * 【タグは、{{…}} の文字のまま見せない】(beyondシリーズ共通の決まり)
 * 入力欄の中でも、タグは、文章の中に並ぶ色付きのボックス(LINE名 など)で見せる。ボックスは、バックスペースで消せる。
 * 保存・送信する本文は、これまでどおり、タグコードつきの文字列(計算は lib/tag-editor.ts)。
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
  // メッセージごとの、入力欄のカーソル位置(表示の位置)と、ボタンで入れたあとにカーソルを置く位置
  const selections = useRef<Record<string, { start: number; end: number }>>({});
  const [forcedSelection, setForcedSelection] = useState<{ key: string; pos: number } | null>(null);

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

  /** カーソル位置に、ボックスを入れる(選択範囲があれば置き換える)。カーソルが分からないときは、最後に足す */
  function insertCode(m: DraftMessage, code: string) {
    const segs = toSegs(m.text);
    const sel = selections.current[m.key];
    const r = sel ? insertTag(segs, sel.start, sel.end, code, formNames) : appendTag(segs, code, formNames);
    patch(m.key, { text: segsToText(r.segs) });
    selections.current[m.key] = { start: r.cursor, end: r.cursor };
    setForcedSelection({ key: m.key, pos: r.cursor });
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
              <TagTextInput
                text={m.text}
                formNames={formNames}
                disabled={disabled}
                label={`${index + 1}通目のメッセージ`}
                forcedPos={forcedSelection?.key === m.key ? forcedSelection.pos : null}
                onChangeText={(t) => patch(m.key, { text: t })}
                onSelection={(sel) => {
                  selections.current[m.key] = sel;
                  setForcedSelection((f) => (f?.key === m.key ? null : f));
                }}
              />
              <View style={styles.insertRow}>
                <InsertButton label="＋ LINE名" tone="name" disabled={disabled} onPress={() => insertCode(m, NAME_TAG)} />
                <InsertButton label="＋ 本名" tone="realName" disabled={disabled} onPress={() => insertCode(m, REAL_NAME_TAG)} />
                <InsertButton
                  label="＋ 回答フォーム"
                  tone="form"
                  disabled={disabled}
                  onPress={() => {
                    setPickFor(m.key);
                    void loadForms();
                  }}
                />
              </View>
              <Text style={{ color: c.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 }}>
                ボックスは、バックスペースで消せます。本名が未登録の人には、LINE名が入ります。
              </Text>
              <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'right', marginTop: 2 }}>
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
 * 色付きのボックスが、文章の中に並ぶ入力欄。
 * 入力欄の文字は「文字+ボックスの日本語名」。ボックスの部分だけに、色(背景)を付ける。
 * 打つ・消すたびに、前の表示といまの表示の差から、ボックスを壊さずに本文へ戻す(lib/tag-editor.ts)。
 */
function TagTextInput({
  text,
  formNames,
  disabled,
  label,
  forcedPos,
  onChangeText,
  onSelection,
}: {
  text: string;
  formNames: ReadonlyMap<string, string>;
  disabled: boolean;
  label: string;
  forcedPos: number | null;
  onChangeText: (text: string) => void;
  onSelection: (sel: { start: number; end: number }) => void;
}) {
  const c = useColors();
  const segs = useMemo(() => toSegs(text), [text]);
  const shown = useMemo(() => displayOf(segs, formNames), [segs, formNames]);
  return (
    <TextInput
      multiline
      editable={!disabled}
      onChangeText={(next) => onChangeText(segsToText(applyEdit(segs, shown, next, formNames)))}
      onSelectionChange={(e) => onSelection(e.nativeEvent.selection)}
      selection={forcedPos !== null ? { start: forcedPos, end: forcedPos } : undefined}
      placeholder="送るメッセージを入力"
      placeholderTextColor={c.textMuted}
      scrollEnabled={false}
      style={[styles.composer, { color: c.text, borderColor: c.border }]}
      accessibilityLabel={label}
    >
      <Text>
        {segs.map((s, i) =>
          s.kind === 'text' ? (
            <Text key={i}>{s.text}</Text>
          ) : (
            <Text key={i} style={{ backgroundColor: CHIP[tagTone(s.code)].bg, color: CHIP[tagTone(s.code)].fg, fontWeight: '700' }}>
              {segDisplay(s, formNames)}
            </Text>
          ),
        )}
      </Text>
    </TextInput>
  );
}

function InsertButton({ label, tone, disabled, onPress }: { label: string; tone: TagTone; disabled: boolean; onPress: () => void }) {
  const t = CHIP[tone];
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.insertBtn, { borderColor: t.border, backgroundColor: t.bg }]}>
      <Text style={{ color: t.fg, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
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
  composer: { minHeight: 140, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, lineHeight: 24, textAlignVertical: 'top' },
  insertRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  insertBtn: { minHeight: 38, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: 200, borderRadius: 10 },
  removeX: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  uploading: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TAP },
});
