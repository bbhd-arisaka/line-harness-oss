import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../src/state/services';
import { useInterval } from '../../../src/state/hooks';
import { buildChatItems, sameEvents, sameMessages, type Bubble, type ChatListItem, type EventRow } from '../../../src/lib/format';
import { STATUS_LABEL } from '../../../src/lib/format';
import type { ChatDetail, ChatStatus } from '../../../src/lib/types';
import { ImageViewer } from '../../../src/components/image-viewer';
import { ErrorView, LoadingView } from '../../../src/components/ui';
import { MIN_TAP, useColors } from '../../../src/theme/theme';
import { describeError } from '../../../src/lib/errors';

const POLL_MS = 10_000;
const MAX_LENGTH = 5000; // LINE のテキストメッセージの上限
/** API は新しい順に 1000 件までしか返さない(それより古い履歴は表示できない) */
const HISTORY_LIMIT = 1000;

const STATUS_ORDER: ChatStatus[] = ['unread', 'in_progress', 'resolved'];

/** 相手のアイコン(丸)。タップすると友だち詳細へ。画像が無い・読めないときは名前の頭文字 */
function Avatar({ uri, name, onPress }: { uri: string | null; name: string; onPress: () => void }) {
  const c = useColors();
  const [failed, setFailed] = useState(false);
  const initial = (name || '?').trim().slice(0, 1) || '?';
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${name || '友だち'}の詳細を開く`}
      style={styles.avatar}
    >
      {uri && !failed ? (
        <Image source={{ uri }} style={styles.avatarImage} onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.avatarImage, styles.avatarFallback, { backgroundColor: c.border }]}>
          <Text style={{ color: c.textSub, fontSize: 15, fontWeight: '600' }}>{initial}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** 出来事のログ(タグ・ブロック・フォーム回答など)。中央の小さなグレーの行 */
const EventView = memo(function EventView({ event }: { event: EventRow }) {
  const c = useColors();
  const tone = event.type === 'blocked' ? c.danger : undefined;
  return (
    <View style={styles.eventWrap}>
      <Text style={[styles.eventLabel, { color: tone ?? c.textSub, backgroundColor: c.card }]}>
        {event.text}
        {event.time ? ` ・ ${event.time}` : ''}
      </Text>
    </View>
  );
});

const BubbleView = memo(function BubbleView({
  bubble,
  onImagePress,
  avatar,
}: {
  bubble: Bubble;
  onImagePress: (url: string) => void;
  /** 相手のアイコンの表示に使う情報(受信の吹き出しだけに付ける) */
  avatar: { uri: string | null; name: string; onPress: () => void };
}) {
  const c = useColors();
  const out = bubble.side === 'outgoing';
  const alt = bubble.kind !== 'text';
  return (
    <View style={[styles.bubbleRow, { justifyContent: out ? 'flex-end' : 'flex-start' }]}>
      {!out ? <Avatar uri={avatar.uri} name={avatar.name} onPress={avatar.onPress} /> : null}
      {out ? <Text style={[styles.time, { color: c.textMuted }]}>{bubble.time}</Text> : null}
      <View
        style={[
          styles.bubble,
          { backgroundColor: out ? c.bubbleOutgoing : c.bubbleIncoming },
          out ? styles.bubbleOut : styles.bubbleIn,
        ]}
      >
        {bubble.kind === 'image' && bubble.imageUrl ? (
          <Pressable
            onPress={() => onImagePress(bubble.fullImageUrl || bubble.imageUrl!)}
            accessibilityRole="imagebutton"
            accessibilityLabel="画像を拡大して見る"
          >
            <Image source={{ uri: bubble.imageUrl }} style={styles.image} resizeMode="cover" accessibilityIgnoresInvertColors />
          </Pressable>
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
  // 相手の吹き出しに付けるアイコン(タップで友だち詳細へ)
  const avatar = useMemo(
    () => ({
      uri: chat?.friendPictureUrl ?? null,
      name: chat?.friendName ?? '',
      onPress: () => {
        if (chat) router.push({ pathname: '/friend/[id]', params: { id: chat.friendId, from: 'chat' } });
      },
    }),
    [chat?.friendPictureUrl, chat?.friendName, chat?.friendId, router], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
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
        if (!prev || !sameMessages(prev.messages, next.messages) || !sameEvents(prev.events, next.events) || prev.status !== next.status || prev.friendName !== next.friendName) {
          setChat(next);
        }
        setError(null);
      } catch (e) {
        if (mine !== seq.current) return;
        if (!silent || !chatRef.current) setError(describeError(e, '読み込めませんでした'));
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

  // 友だち詳細で名前を直して戻ったときに、ヘッダーの名前を最新にする
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void load(true);
    }, [load]),
  );

  // 新着の取得(プッシュ通知に加えて、開いている間は10秒ごとにも確認)
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
      setSendError(describeError(e, '送信できませんでした'));
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  /** 対応状態の変更。先に画面へ反映し、失敗したら元に戻して理由を出す */
  async function changeStatus(next: ChatStatus) {
    const current = chatRef.current;
    if (!current || current.status === next || statusBusy) return;
    const prev = current.status;
    seq.current++; // 変更前の状態を持ってくる取得中のポーリングの結果は捨てる
    setStatusBusy(true);
    setStatusError(null);
    setChat({ ...current, status: next });
    try {
      await api.updateChatStatus(current.friendId, next);
    } catch (e) {
      setChat((c) => (c ? { ...c, status: prev } : c));
      setStatusError(describeError(e, '対応状態を変更できませんでした'));
    } finally {
      setStatusBusy(false);
    }
  }

  // 一覧は新しい順に並べて inverted で表示する(開いたとき自動で一番下=最新が見える)
  const items: ChatListItem[] = useMemo(() => (chat ? buildChatItems(chat.messages, chat.events).reverse() : []), [chat]);
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
          {chat ? (
            <View style={[styles.statusBar, { backgroundColor: c.card, borderBottomColor: c.border }]}>
              <Text style={{ color: c.textMuted, fontSize: 12, fontWeight: '700' }}>対応状態</Text>
              <View style={styles.segments} accessibilityRole="radiogroup">
                {STATUS_ORDER.map((s) => {
                  const active = chat.status === s;
                  const palette = s === 'unread' ? c.danger : s === 'in_progress' ? c.warning : c.primaryButton;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => void changeStatus(s)}
                      disabled={statusBusy}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, disabled: statusBusy }}
                      accessibilityLabel={STATUS_LABEL[s]}
                      style={[
                        styles.segment,
                        { backgroundColor: active ? palette : c.inputBackground, opacity: statusBusy && !active ? 0.5 : 1 },
                      ]}
                    >
                      <Text style={{ color: active ? '#ffffff' : c.textSub, fontSize: 13, fontWeight: '700' }}>{STATUS_LABEL[s]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {statusError ? (
            <View style={[styles.sendError, { backgroundColor: c.dangerSoft }]} accessibilityRole="alert">
              <Text style={{ color: c.danger, fontSize: 13 }}>{statusError}</Text>
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
              ) : item.type === 'event' ? (
                <EventView event={item.event} />
              ) : (
                <BubbleView bubble={item.bubble} onImagePress={setViewerUri} avatar={avatar} />
              )
            }
            // inverted の末尾 = 画面の一番上
            ListFooterComponent={
              chat && chat.messages.length >= HISTORY_LIMIT ? (
                <Text style={[styles.limitNote, { color: c.textMuted }]}>
                  新しい{HISTORY_LIMIT.toLocaleString('ja-JP')}件までを表示しています(これより古いメッセージは表示できません)
                </Text>
              ) : null
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
      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerButton: { width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  segments: { flex: 1, flexDirection: 'row', gap: 6 },
  segment: { flex: 1, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  limitNote: { fontSize: 11, textAlign: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 3, gap: 6 },
  avatar: { width: 36, height: 36, marginBottom: 2 },
  avatarImage: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '75%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleIn: { borderTopLeftRadius: 4 },
  bubbleOut: { borderTopRightRadius: 4 },
  image: { width: 200, height: 200, borderRadius: 10 },
  time: { fontSize: 11, marginBottom: 2 },
  dateWrap: { alignItems: 'center', marginVertical: 10 },
  dateLabel: { fontSize: 12, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  eventWrap: { alignItems: 'center', marginVertical: 6, paddingHorizontal: 16 },
  eventLabel: { fontSize: 11, textAlign: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: MIN_TAP, maxHeight: 140, borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 16 },
  sendButton: { width: MIN_TAP, height: MIN_TAP, borderRadius: MIN_TAP / 2, alignItems: 'center', justifyContent: 'center' },
  sendError: { paddingHorizontal: 12, paddingVertical: 8 },
});
