// アプリ全体で1つだけの API クライアント・認証ストア・保存先。
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import { createApiClient } from '../lib/api';
import { createAuthStore, type KeyValueStorage } from '../lib/auth';

/** 実機: Keychain(expo-secure-store)。Web での画面確認用だけ localStorage。 */
function createStorage(): KeyValueStorage {
  if (Platform.OS === 'web') {
    return {
      get: async (k) => {
        try {
          return globalThis.localStorage?.getItem(k) ?? null;
        } catch {
          return null;
        }
      },
      set: async (k, v) => {
        globalThis.localStorage?.setItem(k, v);
      },
      remove: async (k) => {
        globalThis.localStorage?.removeItem(k);
      },
    };
  }
  return {
    get: (k) => SecureStore.getItemAsync(k),
    set: (k, v) => SecureStore.setItemAsync(k, v),
    remove: (k) => SecureStore.deleteItemAsync(k),
  };
}

export const storage = createStorage();

/** ログイン一覧(「ログイン中の端末」)に出る名前 */
const deviceName = Device.deviceName || Device.modelName || (Platform.OS === 'web' ? 'Web' : 'iPhone');

export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL || undefined,
  getToken: () => authStore.getToken(),
  onUnauthorized: () => {
    void authStore.handleUnauthorized();
  },
});

export const authStore = createAuthStore({
  storage,
  login: (email, password, name) => api.login(email, password, name),
  logout: async () => {
    // プッシュ通知の送り先を先に解除する(失敗しても、ログアウト自体は続ける)
    if (Platform.OS === 'ios') {
      try {
        await api.setApnsToken(null);
      } catch {
        // 通信できなくても端末側は必ずログアウトする
      }
    }
    return api.logout();
  },
  deviceName,
});
