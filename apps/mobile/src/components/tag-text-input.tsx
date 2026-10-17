import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type StyleProp, type TextStyle } from 'react-native';
import { applyEdit, CHIP_PAD, displayOf, segsToText, tagLabel, tagTone, toSegs, type TagTone } from '../lib/tag-editor';
import { useColors } from '../theme/theme';

/** ボックス(タグ)の色。Web版と同じ系統: LINE名=水色、本名=緑、フォーム=青、そのほか=紫 */
export const CHIP: Record<TagTone, { fg: string; bg: string; border: string }> = {
  name: { fg: '#075985', bg: '#e0f2fe', border: '#7dd3fc' },
  realName: { fg: '#065f46', bg: '#d1fae5', border: '#6ee7b7' },
  form: { fg: '#1d5f92', bg: '#e3f0fb', border: '#93c5fd' },
  other: { fg: '#5b21b6', bg: '#ede9fe', border: '#c4b5fd' },
};

/**
 * 色付きのボックスが、文章の中に並ぶ入力欄(配信の作成・トークの入力欄で共通)。
 * 入力欄の文字は「文字+ボックスの日本語名」。ボックスの部分だけに、色(背景)を付ける。
 * 打つ・消すたびに、前の表示といまの表示の差から、ボックスを壊さずに本文へ戻す(lib/tag-editor.ts)。
 * 本文(text)は、タグコードつきの文字列。{{…}} の文字は、画面に出さない(beyondシリーズ共通の決まり)。
 */
export function TagTextInput({
  text,
  formNames,
  disabled,
  label,
  placeholder = '送るメッセージを入力',
  forcedPos,
  onChangeText,
  onSelection,
  onFocus,
  style,
  scrollEnabled = false,
}: {
  text: string;
  formNames: ReadonlyMap<string, string>;
  disabled: boolean;
  label: string;
  placeholder?: string;
  forcedPos: number | null;
  onChangeText: (text: string) => void;
  onSelection: (sel: { start: number; end: number }) => void;
  onFocus?: () => void;
  style?: StyleProp<TextStyle>;
  scrollEnabled?: boolean;
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
      onFocus={onFocus}
      selection={forcedPos !== null ? { start: forcedPos, end: forcedPos } : undefined}
      placeholder={placeholder}
      placeholderTextColor={c.textMuted}
      scrollEnabled={scrollEnabled}
      style={[styles.composer, { color: c.text, borderColor: c.border }, style]}
      accessibilityLabel={label}
    >
      <Text>
        {segs.map((s, i) =>
          s.kind === 'text' ? (
            <Text key={i}>{s.text}</Text>
          ) : (
            // ボックスの両側の空白は、色を付けない文字にする。iPhone の入力欄は、打った文字に「直前の文字の見た目」を
            // 引き継ぐので、ボックスの最後の空白に色があると、そのあとに打つ文字まで色が付いた(本番で確認)。
            // 見える文字の並びは、これまでと同じ(空白+名前+空白)。色が付くのは、名前の部分だけ
            <Text key={i}>
              <Text>{CHIP_PAD}</Text>
              <Text style={{ backgroundColor: CHIP[tagTone(s.code)].bg, color: CHIP[tagTone(s.code)].fg, fontWeight: '700' }}>{tagLabel(s.code, formNames)}</Text>
              <Text>{CHIP_PAD}</Text>
            </Text>
          ),
        )}
      </Text>
    </TextInput>
  );
}

/** 「＋ LINE名」などの、ボックスを入れるボタン。ボックスと同じ色 */
export function InsertButton({ label, tone, disabled, onPress }: { label: string; tone: TagTone; disabled: boolean; onPress: () => void }) {
  const t = CHIP[tone];
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.insertBtn, { borderColor: t.border, backgroundColor: t.bg }]}>
      <Text style={{ color: t.fg, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  composer: { minHeight: 140, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, lineHeight: 24, textAlignVertical: 'top' },
  insertBtn: { minHeight: 38, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
});
