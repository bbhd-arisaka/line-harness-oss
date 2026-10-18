import { useState } from 'react';
import { Modal, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button } from './ui';
import { MIN_TAP, useColors } from '../theme/theme';

/**
 * トークの文章の「一部を選んでコピー」画面。
 * 文章を、読み取り専用の入力欄に出す。長押し・ハンドルのドラッグで好きな範囲を選ぶと、iPhone 標準の「コピー」が出る
 * (吹き出しの文字(Text)は、iPhone では全文しか選べないため、選べる入力欄に出している)。
 */
export function TextSelectModal({ text, onClose }: { text: string | null; onClose: () => void }) {
  const c = useColors();
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Modal visible={text !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '700', flex: 1 }}>コピーする範囲を選ぶ</Text>
          <Button title="閉じる" variant="secondary" onPress={onClose} style={{ minHeight: MIN_TAP, paddingHorizontal: 12 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <TextInput
            value={text ?? ''}
            multiline
            editable={false}
            scrollEnabled={false}
            contextMenuHidden={false}
            accessibilityLabel="コピーする文章"
            style={{ color: c.text, fontSize: 17, lineHeight: 26, padding: 0 }}
          />
        </ScrollView>
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          <Button title={copied ? 'コピーしました' : 'すべてコピー'} onPress={() => void copyAll()} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  footer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
