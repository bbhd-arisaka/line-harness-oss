import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../state/services';
import { pickAndUploadImage } from '../state/image-upload';
import { TagTextInput } from './tag-text-input';
import { ChatAttachPanel } from './chat-attach-panel';
import { PickModal, type PickItem } from './pick-modal';
import { appendTag, insertTag, segsToText, toSegs } from '../lib/tag-editor';
import { findUnsupportedTag, formTag, NAME_TAG, REAL_NAME_TAG } from '../lib/broadcast';
import { appendTemplateText, imageContent, planCompose, templateNote } from '../lib/chat-compose';
import { useInterval } from '../state/hooks';
import { buildChatItems, sameEvents, sameMessages, type Bubble, type ChatListItem, type EventRow, type FormAnswerCard } from '../lib/format';
import { STATUS_LABEL } from '../lib/format';
import type { ChatDetail, ChatStatus, FormOption, TemplateOption } from '../lib/types';
import { ImageViewer } from '../components/image-viewer';
import { ErrorView, LoadingView } from '../components/ui';
import { MIN_TAP, useColors } from '../theme/theme';
import { describeError } from '../lib/errors';
import { ACTIVITY_RETRY_MS, isActivityForChat, subscribeChatActivity } from '../lib/chat-activity';
import { useUnread } from '../state/unread';

const POLL_MS = 10_000;
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

/** お客様から届いた、フォームの回答カード。ボタンで、回答結果の画面を開く */
function FormAnswerCardView({ card, time, avatar, onOpen }: { card: FormAnswerCard; time: string; avatar: { uri: string | null; name: string; onPress: () => void }; onOpen: (card: FormAnswerCard) => void }) {
  const c = useColors();
  return (
    <View style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
      <Avatar uri={avatar.uri} name={avatar.name} onPress={avatar.onPress} />
      <View style={[styles.answerCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text selectable style={{ color: c.text, fontSize: 15, fontWeight: '700', lineHeight: 21 }}>
          {card.title}
        </Text>
        {card.body ? (
          <Text selectable style={{ color: c.textSub, fontSize: 13, lineHeight: 19, marginTop: 4 }}>
            {card.body}
          </Text>
        ) : null}
        <Pressable
          onPress={() => onOpen(card)}
          accessibilityRole="button"
          accessibilityLabel={card.buttonLabel}
          style={({ pressed }) => [styles.answerButton, { backgroundColor: c.primaryButton, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '700' }}>{card.buttonLabel}</Text>
        </Pressable>
      </View>
      <Text style={[styles.time, { color: c.textMuted }]}>{time}</Text>
    </View>
  );
}

const BubbleView = memo(function BubbleView({
  bubble,
  onImagePress,
  onOpenAnswer,
  avatar,
}: {
  bubble: Bubble;
  onImagePress: (url: string) => void;
  onOpenAnswer: (card: FormAnswerCard) => void;
  /** 相手のアイコンの表示に使う情報(受信の吹き出しだけに付ける) */
  avatar: { uri: string | null; name: string; onPress: () => void };
}) {
  const c = useColors();
  const out = bubble.side === 'outgoing';
  const alt = bubble.kind !== 'text';
  if (bubble.kind === 'formAnswer' && bubble.formAnswer) {
    return <FormAnswerCardView card={bubble.formAnswer} time={bubble.time} avatar={avatar} onOpen={onOpenAnswer} />;
  }
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

/**
 * トーク画面の本体。
 * - 通常(iPhone・iPad の縦): 画面として開く(上のヘッダーは Stack が出す)
 * - embedded(iPad の横など、2列表示の右側): 右側の枠の中に出す。ヘッダーは自前の細い帯
 */
export function ChatView({ id, embedded = false, onChanged }: { id: string; embedded?: boolean; onChanged?: () => void }) {
  const { refresh: refreshUnread } = useUnread();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

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
  const openAnswer = useCallback(
    (card: FormAnswerCard) => router.push({ pathname: '/form-answer/[submissionId]', params: { submissionId: card.submissionId, chat: id } }),
    [router, id],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // 入力欄の道具: 色付きボックス(LINE名・本名・フォーム)・テンプレート・写真
  const [forms, setForms] = useState<FormOption[] | null>(null);
  const [pickForm, setPickForm] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  const [pickTemplate, setPickTemplate] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // 左の「＋」で開く、選択のパネル(普通のLINEと同じ)
  const [panelOpen, setPanelOpen] = useState(false);
  // 入力欄のカーソル位置(まだ一度も触っていないときは null → ボックスは最後に足す)
  const selection = useRef<{ start: number; end: number } | null>(null);
  const [forcedPos, setForcedPos] = useState<number | null>(null);
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
        if (!prev || !sameMessages(prev.messages, next.messages) || !sameEvents(prev.events, next.events) || prev.status !== next.status || prev.friendName !== next.friendName || prev.friendPictureUrl !== next.friendPictureUrl) {
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

  // 新着の取得(開いている間は10秒ごとに確認。通知が届いたら、待たずにすぐ確認)
  // 定期の確認は「新着の有無」だけ(1行しか読まない)。変わっていた(または最初の)ときだけ、このトークを取り直す
  const lastPulse = useRef<string | null>(null);
  useInterval(
    () => {
      void (async () => {
        try {
          const p = await api.getChatPulse();
          if (lastPulse.current === null || p.latest !== lastPulse.current) await load(true);
          if (p.latest) lastPulse.current = p.latest;
        } catch {
          // 確認に失敗したときは、次の確認まで待つ
        }
      })();
    },
    POLL_MS,
    !!chat && !error,
  );
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | null = null;
    const off = subscribeChatActivity((e) => {
      if (!isActivityForChat(e, id)) return;
      void load(true);
      // 通知の直後は、サーバーの保存が少し遅れて見えることがあるので、もう一度確認する
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => void load(true), ACTIVITY_RETRY_MS);
    });
    return () => {
      off();
      if (retry) clearTimeout(retry);
    };
  }, [id, load]);

  const formNames = useMemo(() => new Map((forms ?? []).map((f) => [f.id, f.name])), [forms]);
  const formItems: PickItem[] = useMemo(() => (forms ?? []).map((f) => ({ id: f.id, label: f.name })), [forms]);
  const templateItems: PickItem[] = useMemo(() => (templates ?? []).map((t) => ({ id: t.id, label: t.name, note: templateNote(t) })), [templates]);

  const loadForms = useCallback(async () => {
    if (forms) return;
    try {
      setForms((await api.listForms()).filter((f) => f.isActive !== false));
    } catch (e) {
      setSendError(describeError(e, 'フォームの一覧を読み込めませんでした'));
    }
  }, [forms]);
  const loadTemplates = useCallback(async () => {
    if (templates) return;
    try {
      setTemplates(await api.listTemplates());
    } catch (e) {
      setSendError(describeError(e, 'テンプレートの一覧を読み込めませんでした'));
    }
  }, [templates]);
  // 本文にフォームのボックスがあるときは、ボックスに出す名前のために、フォーム一覧を読む
  const needForms = text.includes('{{form_url:');
  useEffect(() => {
    if (needForms) queueMicrotask(() => void loadForms());
  }, [needForms, loadForms]);

  /** カーソル位置に、ボックスを入れる(選択範囲があれば置き換える)。カーソルが分からないときは、最後に足す */
  function insertCode(code: string) {
    const segs = toSegs(text);
    const sel = selection.current;
    const r = sel ? insertTag(segs, sel.start, sel.end, code, formNames) : appendTag(segs, code, formNames);
    setText(segsToText(r.segs));
    selection.current = { start: r.cursor, end: r.cursor };
    setForcedPos(r.cursor);
  }

  async function choosePhoto() {
    if (uploading || sending) return;
    setUploading(true);
    setSendError(null);
    try {
      const url = await pickAndUploadImage();
      if (url) setPendingImage(url);
    } catch (e) {
      setSendError(describeError(e, '画像を送れませんでした'));
    } finally {
      setUploading(false);
    }
  }

  function onTemplatePicked(item: PickItem) {
    const t = (templates ?? []).find((x) => x.id === item.id);
    setPickTemplate(false);
    if (!t) return;
    if (t.messageType === 'text') {
      // テキストは入力欄に入れる(直してから送れる)
      setText((prev) => appendTemplateText(prev, t.messageContent));
      setForcedPos(null);
      return;
    }
    // 画像・Flex は、すぐ送ることになるので、送る前に確認する
    Alert.alert('このテンプレートを送りますか?', `「${t.name}」を、${chat?.friendName || 'この相手'}に送ります。送ったあとは取り消せません。`, [
      { text: 'やめる', style: 'cancel' },
      { text: '送る', onPress: () => void sendTemplateNow(t) },
    ]);
  }

  async function sendTemplateNow(t: TemplateOption) {
    if (!id || sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setSendError(null);
    try {
      await api.sendChatMessage(id, t.messageType === 'image' ? 'image' : 'flex', t.messageContent);
      refreshUnread();
      await load(true);
      onChanged?.();
    } catch (e) {
      setSendError(describeError(e, '送信できませんでした'));
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function send() {
    if (!id || sendLock.current) return;
    const plan = planCompose({ text, imageUrl: pendingImage, unsupportedTag: findUnsupportedTag(text) });
    if (!plan.ok) {
      if (text.trim() || pendingImage) setSendError(plan.reason);
      return;
    }
    sendLock.current = true;
    setSending(true);
    setSendError(null);
    try {
      // 画像が先、テキストが後(両方あるとき)。画像を送れたら、すぐ添付を外す(やり直しで二重に送らない)
      if (plan.image) {
        await api.sendChatMessage(id, 'image', imageContent(plan.image));
        setPendingImage(null);
      }
      if (plan.text) {
        await api.sendChatText(id, plan.text);
        setText('');
        selection.current = null;
      }
      refreshUnread();
      await load(true);
      onChanged?.();
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
      onChanged?.();
      refreshUnread(); // 下バーの数字を、すぐ最新にする
    } catch (e) {
      setChat((c) => (c ? { ...c, status: prev } : c));
      setStatusError(describeError(e, '対応状態を変更できませんでした'));
    } finally {
      setStatusBusy(false);
    }
  }

  // 一覧は新しい順に並べて inverted で表示する(開いたとき自動で一番下=最新が見える)
  const items: ChatListItem[] = useMemo(() => (chat ? buildChatItems(chat.messages, chat.events).reverse() : []), [chat]);
  const canSend = (text.trim().length > 0 || !!pendingImage) && !sending && !uploading;

  return (
    <View style={{ flex: 1, backgroundColor: c.chatBackground }}>
      {embedded ? (
        <View style={[styles.paneHeader, { backgroundColor: c.card, borderBottomColor: c.border }]}>
          <Text style={[styles.paneTitle, { color: c.text }]} numberOfLines={1}>
            {chat?.friendName ?? 'トーク'}
          </Text>
          {chat ? (
            <Pressable
              onPress={() => router.push({ pathname: '/friend/[id]', params: { id: chat.friendId, from: 'chat' } })}
              accessibilityRole="button"
              accessibilityLabel="友だち詳細を開く"
              style={styles.headerButton}
            >
              <Ionicons name="person-circle-outline" size={28} color={c.text} />
            </Pressable>
          ) : null}
        </View>
      ) : (
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
      )}
      {loading && !chat ? (
        <LoadingView />
      ) : error && !chat ? (
        <ErrorView message={error} onRetry={() => void load(false)} />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 + (embedded ? 44 : 0) : 0}
        >
          {chat ? (
            <View style={[styles.statusBar, { backgroundColor: c.card, borderBottomColor: c.border }]}>
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
                <BubbleView bubble={item.bubble} onImagePress={setViewerUri} onOpenAnswer={openAnswer} avatar={avatar} />
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
            {pendingImage ? (
              <View style={styles.pendingRow}>
                <Image source={{ uri: pendingImage }} style={[styles.pendingThumb, { backgroundColor: c.border }]} resizeMode="cover" accessibilityLabel="送る写真" />
                {/* 写真を消す(✕)。消したあとは、また選べる */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="送る写真を削除"
                  disabled={sending}
                  onPress={() => setPendingImage(null)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.pendingX, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Ionicons name="close" size={16} color="#ffffff" />
                </Pressable>
              </View>
            ) : null}
            {/* 普通のLINEと同じ並び: 「＋」(開くと×)・写真・入力欄・送信。道具は、入力欄の上に並べない */}
            <View style={styles.composerRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={panelOpen ? '選ぶパネルを閉じる' : 'テンプレートなどを選ぶ'}
                accessibilityState={{ expanded: panelOpen, disabled: sending }}
                disabled={sending}
                onPress={() => {
                  if (!panelOpen) Keyboard.dismiss();
                  setPanelOpen((v) => !v);
                }}
                hitSlop={4}
                style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name={panelOpen ? 'close' : 'add'} size={30} color={c.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={pendingImage ? '写真を選び直す' : '写真を選ぶ'}
                disabled={sending || uploading}
                onPress={() => void choosePhoto()}
                hitSlop={4}
                style={({ pressed }) => [styles.iconBtn, { opacity: sending || uploading ? 0.4 : pressed ? 0.6 : 1 }]}
              >
                {uploading ? <ActivityIndicator color={c.primary} /> : <Ionicons name="image-outline" size={26} color={c.text} />}
              </Pressable>
              <TagTextInput
                text={text}
                formNames={formNames}
                disabled={sending}
                label="メッセージ"
                placeholder="Aa"
                forcedPos={forcedPos}
                scrollEnabled
                onFocus={() => setPanelOpen(false)}
                onChangeText={setText}
                onSelection={(sel) => {
                  selection.current = sel;
                  setForcedPos(null);
                }}
                style={[styles.input, { backgroundColor: c.inputBackground }]}
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
            {panelOpen ? (
              <ChatAttachPanel
                disabled={sending}
                onTemplate={() => {
                  setPanelOpen(false);
                  setPickTemplate(true);
                  void loadTemplates();
                }}
                onInsert={(kind) => {
                  setPanelOpen(false);
                  if (kind === 'form') {
                    setPickForm(true);
                    void loadForms();
                  } else {
                    insertCode(kind === 'name' ? NAME_TAG : REAL_NAME_TAG);
                  }
                }}
              />
            ) : null}
          </View>
          <PickModal
            visible={pickForm}
            title={forms === null ? '回答フォームを選ぶ(読み込み中…)' : '回答フォームを選ぶ'}
            items={formItems}
            onPick={(item) => {
              setPickForm(false);
              insertCode(formTag(item.id));
            }}
            onClose={() => setPickForm(false)}
          />
          <PickModal
            visible={pickTemplate}
            title={templates === null ? 'テンプレートから送る(読み込み中…)' : 'テンプレートから送る'}
            items={templateItems}
            onPick={onTemplatePicked}
            onClose={() => setPickTemplate(false)}
          />
        </KeyboardAvoidingView>
      )}
      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  answerCard: { width: 260, maxWidth: '78%', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginHorizontal: 6 },
  answerButton: { minHeight: MIN_TAP, marginTop: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  paneHeader: { minHeight: MIN_TAP + 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  paneTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  headerButton: { width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  statusBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
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
  composer: { gap: 6, paddingHorizontal: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  input: { flex: 1, minHeight: MIN_TAP, maxHeight: 140, borderRadius: 22, borderWidth: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 16, lineHeight: 22 },
  iconBtn: { width: 40, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  pendingRow: { alignSelf: 'flex-start' },
  pendingThumb: { width: 72, height: 72, borderRadius: 10 },
  pendingX: { position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  sendButton: { width: MIN_TAP, height: MIN_TAP, borderRadius: MIN_TAP / 2, alignItems: 'center', justifyContent: 'center' },
  sendError: { paddingHorizontal: 12, paddingVertical: 8 },
});
