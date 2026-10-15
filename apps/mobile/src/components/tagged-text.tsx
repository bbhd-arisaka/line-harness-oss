import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { splitTags } from '../lib/broadcast';
import { useColors } from '../theme/theme';

/**
 * 本文の中の差し込み語・フォームのタグを、{{…}} の文字ではなく、色付きの枠の日本語名で見せる(読み取り専用)。
 *   - 名前 → 水色の枠「名前」
 *   - フォーム → 青い枠「フォーム：○○」(名前が分からないときは「フォーム」)
 *   - ほかの差し込み語 → 紫の枠
 * 保存される本文は、タグコードのまま(Web版と同じ)。
 */
export function TaggedText({
  text,
  formNames,
  style,
}: {
  text: string;
  /** フォームID → フォーム名 */
  formNames?: ReadonlyMap<string, string>;
  style?: StyleProp<TextStyle>;
}) {
  const c = useColors();
  if (!text.includes('{{')) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      {splitTags(text).map((p, i) => {
        if (p.kind === 'text') return <Text key={i}>{p.text}</Text>;
        if (p.kind === 'name') return <Text key={i} style={[styles.chip, { color: '#075985', backgroundColor: '#e0f2fe' }]}> 名前 </Text>;
        if (p.kind === 'form') {
          const name = formNames?.get(p.formId);
          return (
            <Text key={i} style={[styles.chip, { color: '#1d5f92', backgroundColor: '#e3f0fb' }]}>
              {name ? ` フォーム：${name} ` : ' フォーム '}
            </Text>
          );
        }
        return <Text key={i} style={[styles.chip, { color: '#5b21b6', backgroundColor: '#ede9fe' }]}> {p.code} </Text>;
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  chip: { fontSize: 14, fontWeight: '700', overflow: 'hidden', borderRadius: 4 },
});
