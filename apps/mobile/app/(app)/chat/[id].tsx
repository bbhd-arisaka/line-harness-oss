import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../src/state/services';
import { useInterval } from '../../../src/state/hooks';
import { buildChatItems, sameMessages, type Bubble, type ChatListItem } from '../../../src/lib/format';
import type { ChatDetail } from '../../../src/lib/types';
import { ErrorView, LoadingView, StatusBadge } from '../../../src/components/ui';
import { MIN_TAP, useColors } from '../../../src/theme/theme';

const POLL_MS = 10_000;
const MAX_LENGTH = 5000; // LINE のテキストメッセージの上限

const BubbleView = memo(function BubbleView({ bubble }: { bubble: Bubble }) {
  const c = useColors();
  const out = bubble.side === 'outgoing';
  const alt = bubble.kind !== 'text';
  return (
    <View style={[styles.bubbleRow, { justifyContent: out ? 'flex-end' : 'flex-start' }]}>
      {out ? <Text style={[styles.time, { color: c.textMuted }]}>{bubble.time}</Text> : null}
      <View
        style={[
          styles.bubble,
          { backgroundColor: out ? c.bubbleOutgoing : c.bubbleIncoming },
          out ? styles.bubbleOut : styles.bubbleIn,
        ]}
      >
        {bubble.kind === 'image' && bubble.imageUrl ? (
          <Image source={{ uri: bubble.imageUrl }} style={styles.image} resizeMode="cover" accessibilityLabel="画像" accessibilityIgnoresInvertColors />
        ) : (
          <Text
            selectable
            style={{
              color: out ? c.bubbleOutgoingText : c.bubbleIncomingText,
              fontSize: 16,
              lineHeight: 22,
              fontStyle: alt ? 'italic' : 'normal',
            }}
          >
            {bubble.text}
          </Text>
        )}
      </View>
      {!out ? <Text style={[styles.time, { color: c.textMuted }]}>{bubble.time}</Text> : null}
    </View>
  );
});

export default function ChatScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendLock = useRef(false);
  const seq = useRef(0);
  const chatRef = useRef<ChatDetail | null>(null);
  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  const load = useCallback(
    async (silent: boolean) => {
      if (!id) return;
      const mine = ++seq.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const next = await api.getChat(id);
        if (mine !== seq.current) return;
        const prev = chatRef.current;
        // 新着が無ければ再描画しない(10秒ごとのポーリングで画面がちらつかないように)
        if (!prev || !sameMessages(prev.messages, next.messages) || prev.status !== next.status || prev.friendName !== next.friendName) {
          setChat(next);
        }
        setError(null);
      } catch (e) {
        if (mine !== seq.current) return;
        if (!silent || !chatRef.current) setError(e instanceof Error ? e.message : '読み込めませんでした');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [id],
  );

  const invalidate = useCallback(() => {
    seq.current++;
  }, []);
  useEffect(() => {
    queueMicrotask(() => void load(false));
    return invalidate;
  }, [load, invalidate]);

  // 新着の取得(プッシュ通知ができるまでは10秒ごとに確認)
  useInterval(() => void load(true), POLL_MS, !!chat && !error);

  async function send() {
    const body = text.trim();
    if (!body || !id || sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setSendError(null);
    try {
      await api.sendChatText(id, body);
      setText('');
      await load(true);
    } catch (e) {
      // 送れなかった本文は消さない。理由を表示して、もう一度押せるようにする
      setSendError(e instanceof Error ? e.message : '送信できませんでした');
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  // 一覧は新しい順に並べて inverted で表示する(開いたとき自動で一番下=最新が見える)
  const items: ChatListItem[] = useMemo(() => (chat ? buildChatItems(chat.messages).reverse() : []), [chat]);
  const canSend = text.trim().length > 0 && !sending;

  return (
    <View style={{ flex: 1, backgroundColor: c.chatBackground }}>
      <Stack.Screen
        options={{
          title: chat?.friendName ?? 'トーク',
          headerRight: () =>
            chat ? (
              <Pressable
                onPress={() => router.push({ pathname: '/friend/[id]', params: { id: chat.friendId, from: 'chat' } })}
                accessibilityRole="button"
                accessibilityLabel="友だち詳細を開く"
                style={styles.headerButton}
              >
                <Ionicons name="person-circle-outline" size={28} color={c.text} />
              </Pressable>
            ) : null,
        }}
      />
      {loading && !chat ? (
        <LoadingView />
      ) : error && !chat ? (
        <ErrorView message={error} onRetry={() => void load(false)} />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
        >
          {chat && chat.status !== 'resolved' ? (
            <View style={[styles.statusBar, { backgroundColor: c.card, borderBottomColor: c.border }]}>
              <StatusBadge status={chat.status} />
              <Text style={{ color: c.textMuted, fontSize: 12 }}>返信すると「対応中」になります</Text>
            </View>
          ) : null}
          <FlatList
            data={items}
            inverted
            keyExtractor={(it) => it.key}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 10 }}
            renderItem={({ item }) =>
              item.type === 'date' ? (
                <View style={styles.dateWrap}>
                  <Text style={[styles.dateLabel, { color: c.textSub, backgroundColor: c.card }]}>{item.label}</Text>
                </View>
              ) : (
                <BubbleView bubble={item.bubble} />
              )
            }
            ListEmptyComponent={
              <View style={{ transform: [{ scaleY: -1 }], padding: 40 }}>
                <Text style={{ color: c.textMuted, textAlign: 'center' }}>メッセージはまだありません</Text>
              </View>
            }
          />

          {sendError ? (
            <View style={[styles.sendError, { backgroundColor: c.dangerSoft }]} accessibilityRole="alert">
              <Text style={{ color: c.danger, fontSize: 13 }}>{sendError}</Text>
            </View>
          ) : null}
          <View style={[styles.composer, { backgroundColor: c.card, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="メッセージを入力"
              placeholderTextColor={c.textMuted}
              multiline
              maxLength={MAX_LENGTH}
              editable={!sending}
              accessibilityLabel="メッセージ"
              style={[styles.input, { backgroundColor: c.inputBackground, color: c.text }]}
            />
            <Pressable
              onPress={() => void send()}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="送信"
              accessibilityState={{ disabled: !canSend, busy: sending }}
              style={[styles.sendButton, { backgroundColor: canSend ? c.primaryButton : c.border }]}
            >
              <Ionicons name={sending ? 'hourglass-outline' : 'arrow-up'} size={22} color="#ffffff" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerButton: { width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 3, gap: 6 },
  bubble: { maxWidth: '75%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleIn: { borderTopLeftRadius: 4 },
  bubbleOut: { borderTopRightRadius: 4 },
  image: { width: 200, height: 200, borderRadius: 10 },
  time: { fontSize: 11, marginBottom: 2 },
  dateWrap: { alignItems: 'center', marginVertical: 10 },
  dateLabel: { fontSize: 12, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: MIN_TAP, maxHeight: 140, borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 16 },
  sendButton: { width: MIN_TAP, height: MIN_TAP, borderRadius: MIN_TAP / 2, alignItems: 'center', justifyContent: 'center' },
  sendError: { paddingHorizontal: 12, paddingVertical: 8 },
});
