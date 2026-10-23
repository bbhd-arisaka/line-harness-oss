import { UNDO_SEND_MS } from '../lib/pending-send';

/**
 * 「送信の取り消し」がオンのとき、送信ボタンを押してから10秒のあいだ、送信を待たせておく置き場。
 * 画面(トークを開いている部品)とは別に持つので、待っている間に別の画面へ移っても、10秒たてば送られる。
 * アプリが裏に回ったときは、待たずにすぐ送る(裏では、タイマーが止まって、送られないことがあるため)。
 */
export interface PendingSend {
  chatId: string;
  text: string;
  imageUrl: string | null;
  /** 送る時刻(ミリ秒) */
  deadline: number;
}

export type PendingEvent = { kind: 'queued' | 'cancelled' | 'flushed' | 'sent'; chatId: string } | { kind: 'failed'; chatId: string; message: string };

interface Entry {
  info: PendingSend;
  timer: ReturnType<typeof setTimeout>;
  /** 実際に送る処理。失敗したときの後始末(入力欄に戻す)も、この中で行う */
  run: () => Promise<void>;
}

const entries = new Map<string, Entry>();
const listeners = new Set<(e: PendingEvent) => void>();

function emit(e: PendingEvent) {
  for (const l of listeners) l(e);
}

export function subscribePending(fn: (e: PendingEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getPending(chatId: string): PendingSend | null {
  return entries.get(chatId)?.info ?? null;
}

/** 待っている送信を、いますぐ送る */
export function flushPending(chatId: string): Promise<void> {
  const entry = entries.get(chatId);
  if (!entry) return Promise.resolve();
  clearTimeout(entry.timer);
  entries.delete(chatId);
  emit({ kind: 'flushed', chatId });
  return entry.run();
}

export function flushAllPending(): void {
  for (const chatId of [...entries.keys()]) void flushPending(chatId);
}

/** 取り消す。待っていた送信の内容を返す(入力欄に戻すため)。待っていなければ null */
export function cancelPending(chatId: string): PendingSend | null {
  const entry = entries.get(chatId);
  if (!entry) return null;
  clearTimeout(entry.timer);
  entries.delete(chatId);
  emit({ kind: 'cancelled', chatId });
  return entry.info;
}

/** 10秒待ってから送る。同じトークで続けて送ったときは、前のものをすぐ送ってから、新しく待たせる */
export function startPending(info: Omit<PendingSend, 'deadline'>, run: () => Promise<void>, delayMs = UNDO_SEND_MS): PendingSend {
  void flushPending(info.chatId);
  const full: PendingSend = { ...info, deadline: Date.now() + delayMs };
  const timer = setTimeout(() => void flushPending(info.chatId), delayMs);
  entries.set(info.chatId, { info: full, timer, run });
  emit({ kind: 'queued', chatId: info.chatId });
  return full;
}

export function notifyPending(e: PendingEvent): void {
  emit(e);
}

let hooked = false;
/** アプリが裏に回ったら、待っている送信を、すぐ送る(1回だけ登録) */
export function hookAppStateFlush(): void {
  if (hooked) return;
  hooked = true;
  // react-native は、使うときに読み込む(ここ以外の送信の待ち処理は、アプリの外(テスト)でも動く)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppState } = require('react-native') as typeof import('react-native');
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') flushAllPending();
  });
}
