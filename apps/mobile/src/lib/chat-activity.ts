// 通知が届いたことを、いま開いている画面(トーク・トーク一覧)に知らせる小さな仕組み。
// React Native / expo-notifications に依存しない純粋なコードだけ。
export interface ChatActivity {
  /** どのトークに新着があったか。分からないとき(通知にトーク情報がない)は null = 全部更新する */
  chatId: string | null;
}

type Listener = (e: ChatActivity) => void;

const listeners = new Set<Listener>();

/** 通知が届いたときに呼ぶ。購読中の画面が、それぞれ最新を取りに行く */
export function emitChatActivity(chatId: string | null): void {
  for (const l of [...listeners]) {
    try {
      l({ chatId });
    } catch {
      // 1つの画面の失敗で、ほかの画面の更新を止めない
    }
  }
}

/** 通知の到着を購読する。戻り値で購読をやめる */
export function subscribeChatActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** このトークに関係する通知か(トークが分からない通知は、全トークに関係あるとみなす) */
export function isActivityForChat(e: ChatActivity, chatId: string): boolean {
  return e.chatId === null || e.chatId === chatId;
}

/** 通知が届いた直後は、サーバー側の保存が少し遅れて見えることがあるので、少し後にもう一度取りに行く時間(ms) */
export const ACTIVITY_RETRY_MS = 2500;
