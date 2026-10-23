import { useEffect, useState } from 'react';
import { storage } from './services';

/** 「送信の取り消し」(送信を10秒待たせて、そのあいだ取り消せる)のオン・オフ。この端末の設定 */
const KEY = 'chat_undo_send';

let value = false;
let loaded: Promise<void> | null = null;
const listeners = new Set<(v: boolean) => void>();

function load(): Promise<void> {
  if (!loaded) {
    loaded = storage
      .get(KEY)
      .then((raw) => {
        value = raw === '1';
        for (const l of listeners) l(value);
      })
      .catch(() => undefined);
  }
  return loaded;
}

/** 送信ボタンを押した時点の設定(まだ読み込んでいなければ、読み込みを待つ) */
export async function readUndoSendEnabled(): Promise<boolean> {
  await load();
  return value;
}

export async function setUndoSendEnabled(next: boolean): Promise<void> {
  value = next;
  for (const l of listeners) l(next);
  try {
    if (next) await storage.set(KEY, '1');
    else await storage.remove(KEY);
  } catch {
    // 保存できなくても、アプリを開いている間は効く
  }
}

export function useUndoSend(): [boolean, (next: boolean) => void] {
  const [v, setV] = useState(value);
  useEffect(() => {
    listeners.add(setV);
    void load().then(() => setV(value));
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return [v, (next) => void setUndoSendEnabled(next)];
}
