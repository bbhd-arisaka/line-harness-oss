import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatStatus } from '../lib/types';
import { useColors, type Colors } from '../theme/theme';

/** 対応状況ごとの色。選ばれているものだけ、薄い色の面+色の文字+色の枠で見せる(塗りつぶさない) */
export function statusTone(c: Colors, status: ChatStatus | 'all'): { dot: string | null; text: string; soft: string; line: string } {
  if (status === 'unread') return { dot: c.danger, text: c.danger, soft: c.dangerSoft, line: c.danger };
  if (status === 'in_progress') return { dot: c.warning, text: c.warning, soft: c.warningSoft, line: c.warning };
  if (status === 'resolved') return { dot: c.primary, text: c.primaryText, soft: c.primarySoft, line: c.primary };
  return { dot: null, text: c.text, soft: c.inputBackground, line: c.textMuted };
}

/**
 * 対応状況の切り替えボタン(未対応・対応中・対応済み、トーク一覧では「すべて」も)。
 * 選ばれていないものも、小さな色の点でどれがどれか分かる。強調は、選ばれているものだけの薄い色の面。
 */
export function StatusChip({
  label,
  status,
  active,
  disabled,
  onPress,
  count,
  showDot = true,
}: {
  label: string;
  status: ChatStatus | 'all';
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** 件数(あれば、ラベルのあとに小さく) */
  count?: number | null;
  /** 色の点を出すか(幅がせまいときは false) */
  showDot?: boolean;
}) {
  const c = useColors();
  const tone = statusTone(c, status);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          // どれも同じ大きさ(枠は1・高さは38)。選ばれていないものも、薄い灰色の面で、大きさが見える
          backgroundColor: active ? tone.soft : c.inputBackground,
          borderColor: active ? tone.line : c.inputBackground,
          opacity: disabled && !active ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {tone.dot && showDot ? <View style={[styles.dot, { backgroundColor: tone.dot }]} /> : null}
      <Text style={{ color: active ? tone.text : c.textSub, fontSize: 14, fontWeight: active ? '700' : '500' }} numberOfLines={1}>
        {label}
      </Text>
      {typeof count === 'number' ? <Text style={{ color: c.textMuted, fontSize: 12 }}>{count}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6, borderRadius: 19, borderWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
