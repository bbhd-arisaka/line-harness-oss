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
