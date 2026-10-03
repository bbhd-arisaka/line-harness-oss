import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { describeError } from '../lib/errors';

export interface Loader<T> {
  data: T | null;
  /** 初回の読み込み中(データがまだ無い) */
  loading: boolean;
  /** 引っ張って更新中 */
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** 引っ張って更新(画面は消さず、上にインジケーターを出す) */
  refresh: () => Promise<void>;
  setData: (data: T | null) => void;
}

/** 非同期の取得を、読み込み中・エラー・再取得つきで扱う。deps が変わると取り直す。 */
export function useLoader<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): Loader<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  /** 実行中の取得の結果を捨てる(画面を離れた・条件が変わった) */
  const invalidate = useCallback(() => {
    seq.current++;
  }, []);

  const run = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    const id = ++seq.current;
    if (mode === 'initial') {
      setLoading(true);
      setData(null);
    }
    if (mode === 'refresh') setRefreshing(true);
    try {
      const result = await fnRef.current();
      if (id !== seq.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(describeError(e, '読み込めませんでした'));
    } finally {
      if (id === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // 取得の開始は非同期に(effect の中で同期的に state を更新しない)
    queueMicrotask(() => void run('initial'));
    return invalidate;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return {
    data,
    loading,
    refreshing,
    error,
    reload: () => run('initial'),
    refresh: () => run('refresh'),
    setData,
  };
}

/** アプリが前面にあり、enabled の間だけ、一定間隔で callback を呼ぶ(トークのポーリング用) */
export function useInterval(callback: () => void, ms: number, enabled: boolean) {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => saved.current(), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        saved.current();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [ms, enabled]);
}

/** 入力が止まってから value を確定させる(検索用) */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
