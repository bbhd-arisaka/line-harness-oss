import { afterEach, describe, expect, it, vi } from 'vitest';
import { appVersionHeaders, DEFAULT_STORE_URL, getUpdateState, markUpdateRequired, resetUpdateState, subscribeUpdateState } from './app-update';

afterEach(() => resetUpdateState());

describe('更新が必要な状態', () => {
  it('最初は不要。サーバーに言われたら必要になり、購読中の画面に知らせる', () => {
    const l = vi.fn();
    subscribeUpdateState(l);
    expect(getUpdateState()).toEqual({ required: false, storeUrl: DEFAULT_STORE_URL });
    markUpdateRequired('https://apps.apple.com/jp/app/beyond-line/id6820799381');
    expect(getUpdateState().required).toBe(true);
    expect(l).toHaveBeenCalledTimes(1);
    markUpdateRequired(); // 同じ内容なら、何度言われても通知しない
    expect(l).toHaveBeenCalledTimes(1);
  });
  it('App Store 以外の URL は受け付けない(開く先を、サーバーの言いなりにしない)', () => {
    markUpdateRequired('https://evil.example/phish');
    expect(getUpdateState().storeUrl).toBe(DEFAULT_STORE_URL);
    resetUpdateState();
    markUpdateRequired('http://apps.apple.com/jp/app/x');
    expect(getUpdateState().storeUrl).toBe(DEFAULT_STORE_URL);
  });
  it('サーバーに伝える版のヘッダー(版とビルド番号。ビルド番号は数字だけ)', () => {
    expect(appVersionHeaders('1.1.2', '13')).toEqual({ 'X-App-Version': '1.1.2', 'X-App-Build': '13' });
    expect(appVersionHeaders('1.1.2', null)).toEqual({ 'X-App-Version': '1.1.2' });
    expect(appVersionHeaders(undefined, 'abc')).toEqual({});
  });
});
