import { Text, type StyleProp, type TextStyle } from 'react-native';
import { splitByQuery } from '../lib/search-highlight';

/** 検索語の部分だけ、色(または背景)を変えて出す文字 */
export function HighlightedText({
  text,
  query,
  style,
  hitStyle,
  numberOfLines,
}: {
  text: string;
  query: string;
  style?: StyleProp<TextStyle>;
  hitStyle: TextStyle;
  numberOfLines?: number;
}) {
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {splitByQuery(text, query).map((p, i) =>
        p.hit ? (
          <Text key={i} style={hitStyle}>
            {p.text}
          </Text>
        ) : (
          p.text
        ),
      )}
    </Text>
  );
}
