import { Platform } from 'react-native';
import { documentDirectory, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { parseDrafts, withDraft, type DraftMap } from '../lib/chat-draft';

/**
 * トークの入力途中の文章を、アプリを閉じても残す(トークごと)。
 * 画面を閉じる・別の画面へ移る・アプリを終了する、のどれでも、開き直したら続きから打てる。
 * 保存先はアプリの文書フォルダ(Keychain は容量が小さいので使わない)。保存できないときは、アプリを開いている間だけ覚える。
 */
const FILE = Platform.OS === 'web' || !documentDirectory ? null : `${documentDirectory}chat-drafts.json`;

let drafts: DraftMap = {};
let loading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** 保存してある下書きを読み込む(最初の1回だけ) */
export function loadDrafts(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      if (!FILE) return;
      try {
        // 読み込み中に打った分(メモリ)を、ディスクの内容より優先する
        drafts = { ...parseDrafts(await readAsStringAsync(FILE)), ...drafts };
      } catch {
        // まだ保存したことがない
      }
    })();
  }
  return loading;
}

export function getDraft(chatId: string): string {
  return drafts[chatId] ?? '';
}

/** 入力のたびに呼ぶ。ディスクへの保存は、入力が止まって少ししてから(まとめて) */
export function setDraft(chatId: string, text: string): void {
  drafts = withDraft(drafts, chatId, text);
  if (!FILE) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void writeAsStringAsync(FILE, JSON.stringify(drafts)).catch(() => undefined);
  }, 400);
}
