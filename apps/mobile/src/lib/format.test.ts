import { describe, expect, it } from 'vitest';
import {
  buildChatItems,
  buildInfoRows,
  describeRichMenu,
  extractFlexText,
  formatDateSeparator,
  formatDateTime,
  formatListTime,
  formatTime,
  messagePreview,
  nameInitial,
  parseApiDate,
  resolveFriendName,
  sameEvents,
  sameMessages,
  statusLabel,
  toBubble,
} from './format';
import type { ChatEvent, ChatMessage } from './types';

describe('resolveFriendName(本名 > システム表示名 > LINE名)', () => {
  it('優先順位どおり', () => {
    expect(resolveFriendName({ realName: '山田太郎', systemDisplayName: 'タロ', displayName: 'taro' })).toBe('山田太郎');
    expect(resolveFriendName({ realName: '', systemDisplayName: 'タロ', displayName: 'taro' })).toBe('タロ');
    expect(resolveFriendName({ realName: '  ', systemDisplayName: null, displayName: 'taro' })).toBe('taro');
    expect(resolveFriendName({ realName: null, systemDisplayName: null, displayName: null })).toBe('名前なし');
  });
  it('頭文字', () => {
    expect(nameInitial('山田')).toBe('山');
    expect(nameInitial('  ')).toBe('?');
    expect(nameInitial('😀a')).toBe('😀');
  });
});

describe('日時(日本時間)', () => {
  const now = new Date('2026-10-03T12:00:00+09:00');
  it('+09:00 付きと UTC のどちらも日本時間で表示', () => {
    expect(formatTime('2026-10-03T18:05:00.000+09:00')).toBe('18:05');
    expect(formatTime('2026-10-03T09:05:00Z')).toBe('18:05');
    expect(formatTime(null)).toBe('');
    expect(formatTime('ばなな')).toBe('');
  });
  it('タイムゾーン指定がなければ日本時間とみなす', () => {
    expect(parseApiDate('2026-10-03 18:05:00')?.toISOString()).toBe('2026-10-03T09:05:00.000Z');
  });
  it('一覧: 今日=時刻 / 昨日 / 今年=月/日 / 前年=年/月/日', () => {
    expect(formatListTime('2026-10-03T08:03:00+09:00', now)).toBe('08:03');
    expect(formatListTime('2026-10-02T23:59:00+09:00', now)).toBe('昨日');
    expect(formatListTime('2026-09-30T10:00:00+09:00', now)).toBe('9/30');
    expect(formatListTime('2025-12-31T10:00:00+09:00', now)).toBe('2025/12/31');
    expect(formatListTime(null, now)).toBe('');
  });
  it('日付の境目は日本時間で判定する(UTC では前日でも JST では今日)', () => {
    expect(formatListTime('2026-10-02T16:00:00Z', now)).toBe('01:00');
  });
  it('日付の区切り・詳細の日時', () => {
    expect(formatDateSeparator('2026-10-03T10:00:00+09:00')).toBe('2026年10月3日(土)');
    expect(formatDateTime('2026-10-03T18:05:00+09:00')).toBe('2026/10/03 18:05');
    expect(formatDateTime(null)).toBe('-');
  });
});

describe('トーク一覧のプレビュー', () => {
  it('テキストは空白をまとめ、自分の送信には「あなた: 」', () => {
    expect(messagePreview({ lastMessageContent: 'こんにちは\n  よろしく', lastMessageType: 'text', lastMessageDirection: 'incoming' })).toBe('こんにちは よろしく');
    expect(messagePreview({ lastMessageContent: 'ありがとう', lastMessageType: 'text', lastMessageDirection: 'outgoing' })).toBe('あなた: ありがとう');
  });
  it('テキスト以外は種別のラベル', () => {
    expect(messagePreview({ lastMessageContent: null, lastMessageType: 'image', lastMessageDirection: 'incoming' })).toBe('[画像]');
    expect(messagePreview({ lastMessageContent: null, lastMessageType: 'flex', lastMessageDirection: 'outgoing' })).toBe('あなた: [カード]');
    expect(messagePreview({ lastMessageContent: null, lastMessageType: 'sticker', lastMessageDirection: 'incoming' })).toBe('[スタンプ]');
  });
  it('メッセージが無ければ空', () => {
    expect(messagePreview({ lastMessageContent: null, lastMessageType: null, lastMessageDirection: null })).toBe('');
  });
  it('状態の名前', () => {
    expect(statusLabel('unread')).toBe('未対応');
    expect(statusLabel('in_progress')).toBe('対応中');
    expect(statusLabel('resolved')).toBe('対応済み');
  });
});

const ev = (over: Partial<ChatEvent>): ChatEvent => ({
  id: 'e1',
  type: 'tag_added',
  text: 'タグ「SNS流入」を追加しました',
  actor: null,
  createdAt: '2026-10-03T10:30:00+09:00',
  ...over,
});

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1',
  direction: 'incoming',
  messageType: 'text',
  content: 'こんにちは',
  createdAt: '2026-10-03T10:00:00+09:00',
  ...over,
});

describe('吹き出し', () => {
  it('テキスト', () => {
    expect(toBubble(msg({}))).toMatchObject({ side: 'incoming', kind: 'text', text: 'こんにちは', time: '10:00' });
    expect(toBubble(msg({ direction: 'outgoing' })).side).toBe('outgoing');
  });
  it('画像: URL が取れれば表示、取れなければ代替表示', () => {
    const json = JSON.stringify({ originalContentUrl: 'https://x.test/o.jpg', previewImageUrl: 'https://x.test/p.jpg' });
    expect(toBubble(msg({ messageType: 'image', content: json }))).toMatchObject({ kind: 'image', imageUrl: 'https://x.test/p.jpg', fullImageUrl: 'https://x.test/o.jpg' });
    // 元画像が無ければ、拡大表示にも preview を使う
    expect(toBubble(msg({ messageType: 'image', content: JSON.stringify({ previewImageUrl: 'https://x.test/p.jpg' }) }))).toMatchObject({ imageUrl: 'https://x.test/p.jpg', fullImageUrl: 'https://x.test/p.jpg' });
    expect(toBubble(msg({ messageType: 'image', content: '[画像]' }))).toMatchObject({ kind: 'image', imageUrl: null, text: '[画像]' });
    expect(toBubble(msg({ messageType: 'image', content: JSON.stringify({ originalContentUrl: 'javascript:alert(1)' }) })).imageUrl).toBeNull();
  });
  it('スタンプ・その他は代替表示', () => {
    expect(toBubble(msg({ messageType: 'sticker', content: '{"packageId":"1"}' })).text).toBe('[スタンプ]');
    expect(toBubble(msg({ messageType: 'audio', content: '[音声]' })).text).toBe('[音声]');
    expect(toBubble(msg({ messageType: 'unknown-x', content: '' })).text).toBe('[unknown-x]');
  });
  it('Flex は中の文字を拾って示す', () => {
    const flex = JSON.stringify({
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'ご予約確認' }, { type: 'text', text: '10/5 14:00' }] },
    });
    expect(extractFlexText(flex)).toBe('ご予約確認 10/5 14:00');
    expect(toBubble(msg({ messageType: 'flex', content: flex })).text).toBe('[カード] ご予約確認 10/5 14:00');
    expect(toBubble(msg({ messageType: 'flex', content: 'broken' })).text).toBe('[カード]');
    expect(extractFlexText(JSON.stringify({ type: 'text', text: 'あ'.repeat(200) }), 10)).toBe(`${'あ'.repeat(10)}…`);
  });
  it('日付の区切りを差し込む', () => {
    const items = buildChatItems([
      msg({ id: 'a', createdAt: '2026-10-02T23:00:00+09:00' }),
      msg({ id: 'b', createdAt: '2026-10-03T00:10:00+09:00' }),
      msg({ id: 'c', createdAt: '2026-10-03T09:00:00+09:00' }),
    ]);
    expect(items.map((i) => (i.type === 'date' ? `D:${i.label}` : `B:${i.key}`))).toEqual([
      'D:2026年10月2日(金)',
      'B:a',
      'D:2026年10月3日(土)',
      'B:b',
      'B:c',
    ]);
  });
  it('出来事のログを時刻順に混ぜ、日付の区切りの中に入れる', () => {
    const items = buildChatItems(
      [msg({ id: 'a', createdAt: '2026-10-03T10:00:00+09:00' }), msg({ id: 'b', createdAt: '2026-10-04T09:00:00+09:00' })],
      [
        ev({ id: 'e2', createdAt: '2026-10-04T08:00:00+09:00', text: 'ブロックされました', type: 'blocked' }),
        ev({ id: 'e1', createdAt: '2026-10-03T11:00:00+09:00', actor: '山田' }),
      ],
    );
    expect(items.map((i) => (i.type === 'date' ? `D:${i.label}` : i.key))).toEqual([
      'D:2026年10月3日(土)',
      'a',
      'event-e1',
      'D:2026年10月4日(日)',
      'event-e2',
      'b',
    ]);
    const e1 = items.find((i) => i.key === 'event-e1');
    expect(e1?.type === 'event' && e1.event.text).toBe('タグ「SNS流入」を追加しました ・ 山田');
    expect(e1?.type === 'event' && e1.event.time).toBe('11:00');
  });
  it('同時刻はメッセージが先。actor が無ければ本文だけ', () => {
    const t = '2026-10-03T10:00:00+09:00';
    const items = buildChatItems([msg({ id: 'a', createdAt: t })], [ev({ id: 'e', createdAt: t })]);
    expect(items.map((i) => i.key)).toEqual(['date-2026-10-03', 'a', 'event-e']);
    const e = items[2];
    expect(e.type === 'event' && e.event.text).toBe('タグ「SNS流入」を追加しました');
  });
  it('出来事だけのトーク・events が undefined のトーク・未知の type', () => {
    const only = buildChatItems([], [ev({ id: 'e', type: 'brand_new_type', text: '新しい出来事' })]);
    expect(only.map((i) => i.type)).toEqual(['date', 'event']);
    expect(only[1].type === 'event' && only[1].event.type).toBe('brand_new_type');
    expect(buildChatItems([msg({ id: 'a' })], undefined).map((i) => i.key)).toEqual(['date-2026-10-03', 'a']);
    expect(buildChatItems([], undefined)).toEqual([]);
  });
  it('出来事の変化をポーリングで検知する', () => {
    const e1 = ev({ id: 'e1' });
    expect(sameEvents(undefined, [])).toBe(true);
    expect(sameEvents([e1], [ev({ id: 'e1' })])).toBe(true);
    expect(sameEvents(undefined, [e1])).toBe(false);
    expect(sameEvents([e1], [e1, ev({ id: 'e2' })])).toBe(false);
    expect(sameEvents([e1], [ev({ id: 'e1', text: '別の文言' })])).toBe(false);
  });
  it('ポーリング結果の比較', () => {
    const a = [msg({ id: '1' }), msg({ id: '2' })];
    expect(sameMessages(a, [msg({ id: '1' }), msg({ id: '2' })])).toBe(true);
    expect(sameMessages(a, [...a, msg({ id: '3' })])).toBe(false);
    expect(sameMessages([], [])).toBe(true);
  });
});

describe('友だち情報・リッチメニュー', () => {
  const defs = [
    { id: '2', folderId: null, fieldKey: 'birthday', label: '誕生日', fieldType: 'date', options: [], displayOrder: 2 },
    { id: '1', folderId: null, fieldKey: 'plan', label: 'プラン', fieldType: 'select', options: [], displayOrder: 1 },
    { id: '3', folderId: null, fieldKey: 'empty', label: '空欄', fieldType: 'text', options: [], displayOrder: 3 },
    { id: '4', folderId: null, fieldKey: 'photo', label: '写真', fieldType: 'image', options: [], displayOrder: 4 },
    { id: '5', folderId: null, fieldKey: 'tags', label: '希望', fieldType: 'checkbox', options: [], displayOrder: 5 },
  ];
  it('値が入っている項目だけを、並び順どおりに', () => {
    const rows = buildInfoRows(
      { birthday: '1990-01-02', plan: 'ゴールド', empty: '', photo: 'https://x.test/api/form-uploads/a.png', tags: ['A', 'B'], unknown: 'x' },
      defs,
    );
    expect(rows).toEqual([
      { key: 'plan', label: 'プラン', value: 'ゴールド' },
      { key: 'birthday', label: '誕生日', value: '1990-01-02' },
      { key: 'photo', label: '写真', value: '(添付ファイルあり)' },
      { key: 'tags', label: '希望', value: 'A, B' },
    ]);
    expect(buildInfoRows(null, defs)).toEqual([]);
  });
  it('リッチメニュー: 未設定 / 個別 / デフォルト', () => {
    expect(describeRichMenu({ id: null, name: null, isDefault: false, chatBarText: null, groupName: null, pageName: null, accountId: null })).toMatchObject({ state: 'none', title: 'リッチメニューは設定されていません' });
    expect(describeRichMenu({ id: 'r1', name: 'メイン', isDefault: false, chatBarText: 'メニュー', groupName: 'G', pageName: 'P1', accountId: 'a' })).toEqual({
      state: 'set',
      title: 'メイン',
      badge: '個別に設定',
      details: ['グループ: G', 'ページ: P1', 'メニューバー: メニュー'],
    });
    expect(describeRichMenu({ id: 'r1', name: null, isDefault: true, chatBarText: null, groupName: null, pageName: null, accountId: null })).toMatchObject({ title: '(名前なし)', badge: 'デフォルト', details: [] });
  });
});
