import { useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle, Pressable, Text, TextInput, type StyleProp, type TextStyle } from 'react-native';
import { hapticLongPress } from '../lib/haptics';
import { splitByQuery } from '../lib/search-highlight';
import { beginSelection, endSelectionOf, setSelectionTag } from '../state/text-selection';

/**
 * トークの文章(吹き出し・フォームの回答カードなど、メッセージの文字は、すべてこれで出す)。
 *
 * 【ふだん】ふつうの Text で出す。大きさ・折り返し・高さは、どの吹き出しも同じ決まり(React Native の Text)で決まるので、そろう。
 * 【範囲を選ぶとき】長押しすると、その場で、同じ大きさの入力欄(読み取り専用の動き)に切り替わり、全文が選ばれた状態になる。
 *   ハンドルをドラッグして範囲を変えて、iPhone 標準の「コピー」を押す。ほかをタップすると、ふつうの表示に戻る。
 *
 * 【なぜ、常に入力欄にしないのか】iPhone の入力欄は、日本語の折り返し(句読点を行頭に出さない処理)が Text と違い、
 *  最後の行がはみ出したり、吹き出しが伸びたりした。範囲を選ぶあいだだけ入力欄にすれば、ふだんの表示はずれない。
 */
export function MessageText({
  text,
  style,
  selectable = true,
  highlight,
}: {
  text: string;
  /** 文字の書式。fontSize・lineHeight・color などをここで決める(Text と入力欄で同じものを使う) */
  style: StyleProp<TextStyle>;
  selectable?: boolean;
  /** 検索から開いたとき、検索語の部分を黄色で目立たせる */
  highlight?: string;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // ふだんの表示の行数(範囲選択の入力欄の行の高さを、ふだんの表示の高さにそろえるために使う)
  const [lineCount, setLineCount] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // 範囲選択をやめる(ほかをタップ・スクロールしたとき、画面側から呼ばれる)
  const endSelecting = useCallback(() => setSelecting(false), []);

  useEffect(() => {
    if (!selecting) return;
    beginSelection(endSelecting, null);
    // 入力欄が出てから、選ぶ(focus すると、全文が選ばれる)
    const t = setTimeout(() => {
      inputRef.current?.focus();
      setSelectionTag(endSelecting, inputRef.current ? findNodeHandle(inputRef.current) : null);
    }, 60);
    return () => {
      clearTimeout(t);
      endSelectionOf(endSelecting);
    };
  }, [selecting, endSelecting]);

  if (selecting && size) {
    return (
      <TextInput
        ref={inputRef}
        value={text}
        multiline
        // 入力はできない(キーボードも出さない・文字は変わらない)。選んで、コピーするだけ
        showSoftInputOnFocus={false}
        caretHidden
        selectTextOnFocus
        onChangeText={() => {}}
        onBlur={() => setSelecting(false)}
        accessibilityLabel="メッセージ(範囲を選んでコピーできます)"
        // 全体の高さは、ふだんの表示と同じ。行の高さは、ふだんの表示の「全体の高さ ÷ 行数」にそろえる
        // (①や全角数字などの文字を含む行は、ふだんの表示のほうが少し高く出るので、一定の高さだと、下の行ほどずれていく)
        style={[style, { width: size.w, height: size.h, padding: 0 }, lineCount > 0 ? { lineHeight: size.h / lineCount } : null]}
      />
    );
  }

  const body = (
    <Text
      style={style}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      onTextLayout={(e) => setLineCount(e.nativeEvent.lines.length)}
    >
      {highlight
        ? splitByQuery(text, highlight).map((p, i) =>
            p.hit ? (
              <Text key={i} style={{ backgroundColor: '#fff200', color: '#111111' }}>
                {p.text}
              </Text>
            ) : (
              p.text
            ),
          )
        : text}
    </Text>
  );
  if (!selectable || !text) return body;
  return (
    <Pressable onLongPress={() => { hapticLongPress(); setSelecting(true); }} delayLongPress={350} accessibilityRole="text">
      {body}
    </Pressable>
  );
}
