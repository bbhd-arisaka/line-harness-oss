import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CHIP } from './tag-text-input';
import type { TagTone } from '../lib/tag-editor';
import { useColors } from '../theme/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * トークの入力欄の左の「＋」を押すと出る、選択のパネル(普通のLINEの「＋」と同じ作り)。
 * 入力欄の上に道具を並べると、画面が重くなるので、ふだんは何も並べず、ここに集めた。
 * 上の段: テンプレート。下の段: 入力欄に入れるボックス(LINE名・本名・回答フォーム)。
 * 写真は、LINEと同じく、入力欄の左の写真アイコンから直接選ぶ。
 */
export function ChatAttachPanel({
  disabled,
  onTemplate,
  onInsert,
}: {
  disabled: boolean;
  onTemplate: () => void;
  onInsert: (kind: 'name' | 'realName' | 'form') => void;
}) {
  const c = useColors();
  return (
    <View style={styles.panel} accessibilityLabel="送るものを選ぶ">
      <View style={styles.row}>
        <Tile icon="document-text-outline" label="テンプレート" bg={c.inputBackground} fg={c.text} disabled={disabled} onPress={onTemplate} />
      </View>
      <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 10, marginBottom: 2 }}>入力欄に入れる</Text>
      <View style={styles.row}>
        <InsertTile icon="person-outline" label="LINE名" tone="name" disabled={disabled} onPress={() => onInsert('name')} />
        <InsertTile icon="id-card-outline" label="本名" tone="realName" disabled={disabled} onPress={() => onInsert('realName')} />
        <InsertTile icon="clipboard-outline" label="回答フォーム" tone="form" disabled={disabled} onPress={() => onInsert('form')} />
      </View>
    </View>
  );
}

function Tile({ icon, label, bg, fg, disabled, onPress }: { icon: IconName; label: string; bg: string; fg: string; disabled: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <View style={[styles.circle, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={26} color={fg} />
      </View>
      <Text style={{ color: c.text, fontSize: 12, textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function InsertTile({ icon, label, tone, disabled, onPress }: { icon: IconName; label: string; tone: TagTone; disabled: boolean; onPress: () => void }) {
  const t = CHIP[tone];
  return <Tile icon={icon} label={label} bg={t.bg} fg={t.fg} disabled={disabled} onPress={onPress} />;
}

const styles = StyleSheet.create({
  panel: { paddingTop: 12, paddingHorizontal: 4, paddingBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '25%', alignItems: 'center', gap: 6, paddingVertical: 6 },
  circle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
