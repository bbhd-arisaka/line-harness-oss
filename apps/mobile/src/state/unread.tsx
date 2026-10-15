import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { api } from './services';
import { useAccounts } from './session';
import { useInterval } from './hooks';
import { ACTIVITY_RETRY_MS, subscribeChatActivity } from '../lib/chat-activity';
import { shouldReloadUnread } from '../lib/unread-badge';

interface UnreadValue {
  /** いま見ている公式アカウントの「未対応」のトーク数。まだ取れていないときは null */
  count: number | null;
  /** すぐ数え直す(対応状態を変えた・返信したあと) */
  refresh: () => void;
}

const UnreadContext = createContext<UnreadValue>({ count: null, refresh: () => {} });

/** 確認の間隔(ms)。「新着の時刻」を1行だけ読む軽い確認で、変わったときだけ未対応数を数え直す */
const CHECK_MS = 30_000;

/**
 * 下バー「トーク」の数字(未対応のトーク数)を持つ。トークが増えても、未対応を見落とさないため。
 * - 数え方は、トーク一覧の「未対応」と同じ(サーバーが数える)
 * - 取り直すタイミング: アカウントを切り替えたとき・アプリを開き直したとき・通知が届いたとき・新着の時刻が変わったとき・
 *   対応状態を変えたり返信したあと・念のため数回に1回
 */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { selected } = useAccounts();
  const accountId = selected?.id ?? null;
  const [count, setCount] = useState<number | null>(null);
  const seq = useRef(0);
  const lastLatest = useRef<string | null>(null);
  const tick = useRef(0);

  const load = useCallback(async () => {
    if (!accountId) return;
    const mine = ++seq.current;
    try {
      const p = await api.getChatPulse({ lineAccountId: accountId, unread: true });
      if (mine !== seq.current) return; // 途中でアカウントが変わった・新しい取得が始まった
      setCount(p.unreadCount ?? 0);
      lastLatest.current = p.latest ?? '';
    } catch {
      // 失敗したときは、いまの数字のまま。次の確認で取り直す
    }
  }, [accountId]);

  // アカウントが変わったら、前のアカウントの数字を出さず、最初から
  useEffect(() => {
    seq.current++;
    lastLatest.current = null;
    tick.current = 0;
    queueMicrotask(() => {
      setCount(null);
      void load();
    });
  }, [accountId, load]);

  // アプリを開き直したとき
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void load();
    });
    return () => sub.remove();
  }, [load]);

  // 通知が届いたとき(保存が少し遅れて見えることがあるので、少し後にもう一度)
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | null = null;
    const off = subscribeChatActivity(() => {
      void load();
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => void load(), ACTIVITY_RETRY_MS);
    });
    return () => {
      off();
      if (retry) clearTimeout(retry);
    };
  }, [load]);

  // 定期の確認(新着の時刻だけ。変わったときだけ数え直す)
  useInterval(
    () => {
      void (async () => {
        try {
          tick.current += 1;
          const p = await api.getChatPulse();
          if (shouldReloadUnread(lastLatest.current, p.latest ?? '', tick.current)) await load();
        } catch {
          // 確認に失敗したときは、次の確認まで待つ
        }
      })();
    },
    CHECK_MS,
    accountId !== null,
  );

  const value = useMemo<UnreadValue>(() => ({ count, refresh: () => void load() }), [count, load]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnread(): UnreadValue {
  return useContext(UnreadContext);
}
