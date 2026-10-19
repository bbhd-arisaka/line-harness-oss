import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, type StyleProp, type TextStyle } from 'react-native';

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
}: {
  text: string;
  /** 文字の書式。fontSize・lineHeight・color などをここで決める(Text と入力欄で同じものを使う) */
  style: StyleProp<TextStyle>;
  selectable?: boolean;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!selecting) return;
    // 入力欄が出てから、選ぶ(focus すると、全文が選ばれる)
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [selecting]);

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
        // 文字の高さは Text と同じ。選んでいるあいだに折り返しがずれても、切れないよう、スクロールは許す
        style={[style, { width: size.w, height: size.h, padding: 0 }]}
      />
    );
  }

  const body = (
    <Text style={style} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {text}
    </Text>
  );
  if (!selectable || !text) return body;
  return (
    <Pressable onLongPress={() => setSelecting(true)} delayLongPress={350} accessibilityRole="text">
      {body}
    </Pressable>
  );
}
