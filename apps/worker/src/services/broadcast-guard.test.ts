import { describe, expect, it } from 'vitest';
import { appBroadcastDenied } from './broadcast-guard.js';

describe('appBroadcastDenied(アプリからの一斉配信)', () => {
  const base = { viaApp: true, role: 'owner', allowedAccountIds: null, accountId: 'A' };
  it('オーナー・管理者は、見られるアカウントなら許す', () => {
    expect(appBroadcastDenied(base)).toBeNull();
    expect(appBroadcastDenied({ ...base, role: 'admin', allowedAccountIds: ['A', 'B'] })).toBeNull();
  });
  it('「スタッフ」の役割は許さない', () => {
    expect(appBroadcastDenied({ ...base, role: 'staff' })).toMatch(/オーナーまたは管理者/);
    expect(appBroadcastDenied({ ...base, role: undefined })).toMatch(/オーナーまたは管理者/);
  });
  it('公式アカウントの指定が無い配信・見られないアカウントは許さない', () => {
    expect(appBroadcastDenied({ ...base, accountId: null })).toMatch(/公式アカウントを指定/);
    expect(appBroadcastDenied({ ...base, role: 'admin', allowedAccountIds: ['B'] })).toMatch(/権限/);
    expect(appBroadcastDenied({ ...base, role: 'admin', allowedAccountIds: [] })).toMatch(/権限/);
  });
  it('アプリ以外(Web・API キー)には、この制限をかけない', () => {
    expect(appBroadcastDenied({ viaApp: false, role: 'staff', allowedAccountIds: ['B'], accountId: null })).toBeNull();
  });
});

