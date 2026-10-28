import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 対応するiOSの最低バージョンは 16.4 に固定(オーナー指示)。勝手に上げない。iPad にも対応する。
const config = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')) as {
  expo: { ios: { supportsTablet: boolean }; plugins: Array<string | [string, Record<string, unknown>]> };
};

describe('app.json の方針', () => {
  it('iOS の最低バージョンは 16.4 のまま(上げない)', () => {
    const entry = config.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-build-properties') as [string, { ios?: { deploymentTarget?: string } }] | undefined;
    expect(entry?.[1].ios?.deploymentTarget).toBe('16.4');
  });
  it('iPad に対応している', () => {
    expect(config.expo.ios.supportsTablet).toBe(true);
  });
});

describe('Android の設定', () => {
  const a = (config.expo as unknown as { android?: { package?: string; permissions?: string[]; googleServicesFile?: string } }).android;
  it('パッケージ名・通知の許可・Firebase の設定ファイルを指定している', () => {
    expect(a?.package).toBe('jp.cms_manager.beyondline');
    expect(a?.permissions).toContain('POST_NOTIFICATIONS');
    expect(a?.googleServicesFile).toBe('./google-services.json');
  });
  it('Google Play で審査に引っかかりやすい権限(写真・動画の読み取り・画面の重ね表示など)は入れない', () => {
    const blocked = (config.expo as unknown as { android?: { blockedPermissions?: string[] } }).android?.blockedPermissions ?? [];
    for (const p of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'READ_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW', 'CAMERA', 'RECORD_AUDIO']) {
      expect(blocked).toContain(`android.permission.${p}`);
    }
  });
});
