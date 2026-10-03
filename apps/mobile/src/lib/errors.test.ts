import { describe, expect, it } from 'vitest';
import {
  describeError,
  FORBIDDEN_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  NOT_FOUND_MESSAGE,
  SERVER_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  toJapaneseError,
  UNAUTHORIZED_MESSAGE,
  UNKNOWN_ERROR_MESSAGE,
} from './errors';
import { ApiError } from './api';

describe('toJapaneseError', () => {
  it('日本語はそのまま出す', () => {
    expect(toJapaneseError('メールアドレスまたはパスワードが違います', 401)).toBe('メールアドレスまたはパスワードが違います');
    expect(toJapaneseError('このアカウントを操作する権限がありません。管理者に依頼してください。', 403)).toBe(
      'このアカウントを操作する権限がありません。管理者に依頼してください。',
    );
  });

  it('API が実際に返す英語を変換する', () => {
    expect(toJapaneseError('LINE account credentials are unavailable', 500)).toContain('LINE と接続できない');
    expect(toJapaneseError('Internal server error', 500)).toBe(SERVER_ERROR_MESSAGE);
    expect(toJapaneseError('Unauthorized', 401)).toBe(UNAUTHORIZED_MESSAGE);
    expect(toJapaneseError('Forbidden', 403)).toBe(FORBIDDEN_MESSAGE);
    expect(toJapaneseError('Not found', 404)).toBe(NOT_FOUND_MESSAGE);
    expect(toJapaneseError('Chat not found', 404)).toBe('トークが見つかりませんでした');
    expect(toJapaneseError('Friend not found', 404)).toBe('友だちが見つかりませんでした');
    expect(toJapaneseError('content is required', 400)).toBe('メッセージを入力してください');
    expect(toJapaneseError('Too many requests. Please try again later.', 429)).toContain('しばらく待って');
    expect(toJapaneseError('missing_account_id', 400)).toContain('公式アカウント');
  });

  it('Failed to ... や LINE API error は内部事情を出さずに日本語にする', () => {
    expect(toJapaneseError('Failed to create rich menu: boom', 500)).toBe(SERVER_ERROR_MESSAGE);
    expect(toJapaneseError('LINE API error: 429 - {"message":"x"}', 500)).toContain('LINE への送信に失敗');
  });

  it('通信失敗・タイムアウト', () => {
    expect(toJapaneseError('Network request failed')).toBe(NETWORK_ERROR_MESSAGE);
    expect(toJapaneseError('Failed to fetch')).toBe(NETWORK_ERROR_MESSAGE);
    expect(toJapaneseError('Load failed')).toBe(NETWORK_ERROR_MESSAGE);
    expect(toJapaneseError('Request timed out')).toBe(TIMEOUT_ERROR_MESSAGE);
    expect(toJapaneseError('The operation was aborted')).toBe(TIMEOUT_ERROR_MESSAGE);
    expect(toJapaneseError('', 0)).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('知らない英語は、ステータスの目安で日本語にする', () => {
    expect(toJapaneseError('weird_code', 404)).toBe(NOT_FOUND_MESSAGE);
    expect(toJapaneseError('weird_code', 503)).toBe(SERVER_ERROR_MESSAGE);
    expect(toJapaneseError('weird_code', 418)).toBe(UNKNOWN_ERROR_MESSAGE);
    expect(toJapaneseError(null, 502)).toBe(SERVER_ERROR_MESSAGE);
    expect(toJapaneseError(undefined)).toBe(UNKNOWN_ERROR_MESSAGE);
  });

  it('英語のまま画面に出ない(日本語を含む文言が返る)', () => {
    for (const m of ['Internal server error', 'Unauthorized', 'weird', 'Failed to x', 'LINE account not found', 'staff_not_found_in_account']) {
      expect(toJapaneseError(m, 500)).toMatch(/[぀-ヿ㐀-鿿]/);
    }
  });
});

describe('describeError', () => {
  it('ApiError は status も見る', () => {
    expect(describeError(new ApiError('Not found', 404))).toBe(NOT_FOUND_MESSAGE);
    expect(describeError(new ApiError('', 500))).toBe(SERVER_ERROR_MESSAGE);
  });
  it('通常の Error(fetch の TypeError など)も日本語にする', () => {
    expect(describeError(new TypeError('Network request failed'))).toBe(NETWORK_ERROR_MESSAGE);
  });
  it('分からないものは fallback', () => {
    expect(describeError(null, '保存できませんでした')).toBe('保存できませんでした');
    expect(describeError(new Error('???'), '保存できませんでした')).toBe('保存できませんでした');
  });
});
