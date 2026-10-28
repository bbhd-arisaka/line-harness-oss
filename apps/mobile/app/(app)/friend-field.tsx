import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/state/services';
import { useLoader } from '../../src/state/hooks';
import { Button, Card, ErrorView, LoadingView } from '../../src/components/ui';
import { withReadableWidth } from '../../src/components/readable-width';
import { describeError } from '../../src/lib/errors';
import { initialInputText, inputKindOf, parseFieldInput, toggleChoice } from '../../src/lib/friend-fields';
import { MIN_TAP, useColors } from '../../src/theme/theme';
import { fs } from '../../src/theme/scale';

const HINT: Record<string, string> = {
  date: '2026-10-20',
  datetime: '2026-10-20 15:30',
};

/** 友だち情報欄の1項目の編集(友だち詳細で、項目をタップして開く) */
function FriendFieldScreen() {
  const c = useColors();
  const router = useRouter();
  const { friendId, key } = useLocalSearchParams<{ friendId: string; key: string }>();
  const friend = useLoader(() => api.getFriend(friendId), [friendId]);
  const defs = useLoader(() => api.listFriendFieldDefinitions(), []);
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const def = defs.data?.find((d) => d.fieldKey === key) ?? null;
  const kind = def ? inputKindOf(def.fieldType) : null;

  // 読み込めたら、いまの値を入れる(1回だけ)
  useEffect(() => {
    if (ready || !friend.data || !def || !kind) return;
    queueMicrotask(() => {
      setText(initialInputText(kind, friend.data?.metadata?.[def.fieldKey]));
      setReady(true);
    });
  }, [ready, friend.data, def, kind]);

  if (friend.loading || defs.loading) return <LoadingView />;
  if (friend.error || defs.error) {
    return <ErrorView message={friend.error ?? defs.error ?? '読み込めませんでした'} onRetry={() => { void friend.reload(); void defs.reload(); }} />;
  }
  if (!def || !kind) return <ErrorView message="この項目は、アプリでは編集できません" />;

  async function save(next: string | null) {
    if (!def || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateFriendMetadata(friendId, { [def.fieldKey]: next });
      router.back();
    } catch (e) {
      setError(describeError(e, '保存できませんでした'));
      setSaving(false);
    }
  }

  function submit() {
    if (!kind) return;
    const r = parseFieldInput(kind, text);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    void save(r.value);
  }

  const options = def.options ?? [];
  const input = [
    styles.input,
    { backgroundColor: c.inputBackground, color: c.text, fontSize: fs(17) },
  ];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior="padding">
      <Stack.Screen options={{ title: def.label }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={{ color: c.textMuted, fontSize: fs(13), marginBottom: 6 }}>{def.label}</Text>

        {kind === 'select' ? (
          <Card style={{ padding: 0 }}>
            {options.map((o, i) => {
              const on = text === o;
              return (
                <Pressable
                  key={o}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setText(on ? '' : o)}
                  style={[styles.option, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null]}
                >
                  <Text style={{ color: c.text, fontSize: fs(17), flex: 1 }}>{o}</Text>
                  {on ? <Ionicons name="checkmark" size={fs(22)} color={c.primary} /> : null}
                </Pressable>
              );
            })}
            {options.length === 0 ? <Text style={{ color: c.textMuted, fontSize: fs(15), padding: 16 }}>選択肢がありません</Text> : null}
          </Card>
        ) : kind === 'checkbox' ? (
          <Card style={{ padding: 0 }}>
            {options.map((o, i) => {
              const on = text.split(',').map((v) => v.trim()).includes(o);
              return (
                <Pressable
                  key={o}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setText(toggleChoice(text, o))}
                  style={[styles.option, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null]}
                >
                  <Text style={{ color: c.text, fontSize: fs(17), flex: 1 }}>{o}</Text>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={fs(24)} color={on ? c.primary : c.textMuted} />
                </Pressable>
              );
            })}
          </Card>
        ) : (
          <TextInput
            value={text}
            onChangeText={(v) => { setText(v); setError(null); }}
            multiline={kind === 'textarea'}
            keyboardType={kind === 'number' ? 'numbers-and-punctuation' : kind === 'date' || kind === 'datetime' ? 'numbers-and-punctuation' : 'default'}
            placeholder={HINT[kind] ?? '未入力'}
            placeholderTextColor={c.textMuted}
            accessibilityLabel={def.label}
            autoFocus
            autoCorrect={false}
            style={[input, kind === 'textarea' ? styles.inputMultiline : null]}
          />
        )}

        {error ? <Text style={{ color: c.danger, fontSize: fs(14), marginTop: 10 }}>{error}</Text> : null}

        <View style={{ marginTop: 20, gap: 10 }}>
          <Button title="保存" onPress={submit} loading={saving} disabled={!ready} />
          {text !== '' ? <Button title="値を消す" variant="secondary" onPress={() => void save(null)} disabled={saving} /> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  input: { minHeight: MIN_TAP, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  inputMultiline: { minHeight: 140, textAlignVertical: 'top' },
  option: { minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
});

export default withReadableWidth(FriendFieldScreen);
